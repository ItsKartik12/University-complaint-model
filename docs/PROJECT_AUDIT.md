# ACICS — Project Audit

**System:** AICTE Complaint Intelligence and Coordination System (SIH26264)
**Audit date:** 2026-10-30
**Auditor scope:** repository inspection, runtime reproduction, automated tests, live API calls, and browser automation.
**Runtime audited:** `bun run dev` at `http://localhost:5173` (Cloudflare Workers + D1 via Miniflare, Vite 8.3.4, React 19, Hono).

---

## 1. Executive summary

ACICS currently runs as one Cloudflare Workers full-stack application: the worker serves `/api/*` and the built React SPA, with Cloudflare D1 (`DB`) and R2 (`FILES`) as runtime bindings. The inner application was exercised, not assumed:

- All four portals are explorable through a labelled, backend-gated local development session.
- Every portal page is reachable, refresh-safe, and protected by a server-side role check.
- Complaint creation, listing, detail, and status transition persist across requests and roles.
- Development/mock authentication is refused whenever `APP_ENV=production`; this is enforced in the worker, not in the UI.
- The source tree is split into `src/frontend`, `src/backend`, and `src/shared`; the split was done with `git mv` and verified after each build/test cycle.
- The earlier flat tree (`src/app`, `src/worker`, `src/main.tsx`, `src/styles.css`) is gone; no duplicate runtime paths remain.

### Verification snapshot

| Check | Result |
|---|---|
| `bun test` | **68 pass, 0 fail**, 411 assertions, 2 files, 4.58 s |
| `bun run typecheck` | clean (`tsc --noEmit`, exit 0) |
| `bun run build` | success; worker 265,859 B; client JS 513.13 kB (gzip 153.73 kB); CSS 51.44 kB (gzip 10.18 kB) |
| Browser UI audit (headless Chrome/CDP) | **43/43 checks**, 0 exceptions, 0 unexpected failed requests |
| Route sweep (all role/page combinations) | **39/39 checks**, 0 server errors |
| Live API lifecycle/authorization suite | **28/28 checks** |
| Google OAuth | unconfigured path live-verified (`501 GOOGLE_NOT_CONFIGURED`, no session); configured path not exercised |
| Production mock-auth refusal | automated tests only (worker imported with `APP_ENV=production`), not a live production deployment |

---

## 2. Repository layout

```
.
├── index.html                     Vite entry, loads /src/frontend/main.tsx
├── vite.config.ts                 React + Tailwind + Cloudflare plugin (one dev server)
├── wrangler.jsonc                 Worker entry src/backend/index.ts, D1 DB, R2 FILES, SPA assets
├── package.json                   dev / dev:frontend / dev:backend / seed / test / typecheck / build
├── .env.example                   public + local runtime placeholders
├── scripts/
│   ├── seed.mjs                   POST /api/dev/seed helper
│   ├── bootstrap-admin.mjs        out-of-band first administrator (local/remote D1)
│   └── postbuild.mjs
├── src/
│   ├── backend/
│   │   ├── index.ts               Hono app, auth routes, dev session/seed, /api wiring
│   │   ├── acics.ts               ACICS schema, seed, domain and admin routes
│   │   ├── authorization.ts       loadAccount → canAccessPortal → resolveActiveRole
│   │   ├── auth.ts                auth mode, sessions, password hashing
│   │   ├── crypto.ts, db.ts, env.ts, seed.ts
│   │   ├── .dev.vars.example      server-only local variables template
│   │   └── routes/                legacy CRM routes (mounted, not used by the ACICS SPA)
│   ├── frontend/
│   │   ├── App.tsx                gate: loading / signed-in / access flow / held / error
│   │   ├── main.tsx, styles.css
│   │   ├── lib/api.ts             single HTTP client, portal header, auth hooks
│   │   ├── components/ui.tsx      Button, Card, Badge, Modal, Drawer, Select, Field…
│   │   ├── pages/PortalAccess.tsx four-step public access flow
│   │   ├── pages/Acics.tsx        authenticated role workspaces and hash router
│   │   ├── .env.example           public Vite variables only
│   │   └── pages/, components/    legacy CRM screens (not imported by App.tsx)
│   └── shared/types.ts            safe cross-layer types
├── tests/                         bun test suites + D1 mock
├── docs/                          this audit, ROUTE_AUDIT.md, API_AUDIT.md
├── README.md
└── ARCHITECTURE_AUDIT.md
```

### Why the tree is not `apps/frontend` + `apps/backend`

The Cloudflare Vite plugin runs the Hono worker and the React client in one Vite process; D1 is only reachable as the internal `DB` binding, not as a network database URL. Splitting into two independently started services would require replacing D1 or adding a proxy, which the brief explicitly discourages. The chosen layout keeps one deployable worker while giving the frontend and backend separate source roots. `dev:frontend` and `dev:backend` exist as aliases of the unified server for command compatibility and are documented as such.

---

## 3. Runtime and request flow

1. Browser loads the SPA from Vite/Workers assets.
2. `App.tsx` calls `GET /api/auth/me`.
   - `401` → public portal access flow.
   - `403` with a status/role code → held/denied screen.
   - `200` → workspace for the effective role.
3. The workspace sends `x-acics-portal` on every API call. The worker re-resolves the account and narrows the session to a role the account actually holds.
4. `/api/acics/*` is mounted behind `requireDb`, `requireUser`, and the central authorization gate; every route additionally applies role and data scoping.
5. Portal selection never grants access. The grant is produced by `loadAccount` + `canAccessPortal` from `acics_users`, `acics_user_roles`, `acics_sessions`, and bureau assignment.

### Identity modes

| Mode | Trigger | Behaviour |
|---|---|---|
| Development | loopback request, no IdP, `APP_ENV` not `production` | email/password seeded accounts and a labelled synthetic `/api/auth/dev-session` |
| Freebuff OIDC | `FREEBUFF_CLIENT_ID` set | upstream OIDC session verification |
| Google OAuth | `GOOGLE_CLIENT_ID` + secret set | redirect flow, existing linked account only; `501` until configured |
| Disabled | `APP_ENV=production` with no IdP | no synthetic or demo sign-in is possible |

The development session is explicitly not a verified identity: it is labelled `LOCAL DEVELOPMENT MODE`, uses a `dev-` subject prefix, writes a `DEV_SESSION_ISSUED` audit row, and is refused with `403 DEV_AUTH_DISABLED` outside development mode.

---

## 4. Findings

### F1 — Local development access was blocked by real-account requirements

- **Observed:** the public flow only accepted seeded email/password accounts. An arbitrary non-empty ID could not be used, so exploring all portals required knowing several seeded credentials and could not switch roles freely.
- **Root cause:** no development-only session path existed; authentication was coupled to D1 password verification for every sign-in.
- **Fix:** added `POST /api/auth/dev-session` (backend) and the development sign-in panel (frontend). The endpoint accepts any non-blank identifier plus an optional display name, deterministically derives a `dev-<slug>-<hash>` subject, grants the synthetic account all four roles, and issues a normal server-side session. Blank identifiers return `400 DEV_ID_REQUIRED`; unknown portals return `400 PORTAL_UNKNOWN`; non-development mode returns `403 DEV_AUTH_DISABLED`.
- **Production safety:** `authMode()` returns `off` when `APP_ENV=production`, so the endpoint and dev seed are unreachable. There is no silent fallback when production auth is unavailable, and the normal login route has no demo-role selector.
- **Verified:** live API checks (blank rejection, unknown portal, 200 + cookie), browser flow (dev sign-in enters the workspace, all four portals listed in the switcher), automated tests (dev access works; production rejects mock mode).

### F2 — Portal-selection screen did not meet the institutional UI specification

- **Observed:** the public entry did not consistently provide the required full system name, restrained government-style header, uniform four-card layout, per-card descriptions, visible development indicator, and exact development supporting copy.
- **Fix:** rebuilt `PortalAccess.tsx` with a navy/white/saffron/green token system, a neutral institutional mark, full system name, Help/About dialogs, four equal cards with icons, descriptions, visible `Enter portal` actions, radio-style selection (`aria-pressed`), keyboard focus, responsive layout, and the exact required development copy.
- **Verified:** browser audit checks for heading, supporting copy, full name, development indicator, Help/About, all four card copies, four `Enter portal` actions, mobile layout, and absence of misleading Google-failure copy.

### F3 — Reported `500` responses on auth endpoints were not reproducible

- **Reported:** `GET /api/auth/me` and `GET /api/auth/onboarding/options` had returned `500` in an earlier state.
- **Observed now:** signed-out `/api/auth/me` returns `401` JSON; onboarding options returns `200` with designations and institutions; anonymous unknown `/api/*` returns `401`; signed-in unknown `/api/*` returns `404 {"error":"Not found."}`.
- **Remaining error paths:** a missing D1 binding returns JSON `503` on auth and ACICS routes; `onError` returns JSON `500` only for genuinely unexpected exceptions. No endpoint returns a fake success.
- **Verified:** live API suite (checks 1–7, 14) and Phase 12 automated tests.

### F4 — Inner pages were not URL-addressable

- **Observed:** workspace navigation was held in React state only, so nested views could not be deep-linked, refreshed, or restored with Back.
- **Fix:** the workspace now treats the URL hash as the route (`#/overview`, `#/complaints/:id`, `#/overlaps/:id`, `#/institutions/:id`, `#/users`, `#/bureau`, `#/notifications`, `#/audit`, `#/settings`) with `hashchange` synchronisation, render-time role guarding, and unknown-page fallback to Overview.
- **Verified:** direct hash navigation, nested refresh, Back navigation, case/institution/overlap deep links, and role-guard redirects in the browser audits.

### F5 — Database/seed behaviour and local D1 fragility

- **Schema:** created idempotently by `ensureAcics` with `CREATE TABLE IF NOT EXISTS`; there is no separate migration runner, so a fresh local or deployed D1 initialises on first request.
- **Seed:** inserts are conflict-tolerant (`INSERT OR IGNORE` / `ON CONFLICT`), so repeated runs preserve existing records. Added `POST /api/dev/seed` and `bun run seed`; the endpoint is development-only (`403 DEV_SEED_DISABLED` in production) and returns counts.
- **Reproduced failure:** local Miniflare D1 returned `D1_ERROR: Failed to get session commit token: internal error` after the dev server process was terminated abruptly. This is the documented OneDrive/external-writer failure mode, not an application bug.
- **Recovery performed:** stopped the server, moved `.wrangler/state/v3/d1` aside as `d1.bak-192834`, restarted, and reseeded. Health returned `{"ok":true,"database":true}` and counts 22 complaints / 9 users / 10 institutions. The procedure is documented in README.
- **Production:** `wrangler d1 execute --remote` bootstrap path exists; it was not run here because no remote D1 exists in this environment.

### F6 — Configuration and monorepo hygiene

- **Observed:** environment templates mixed public and server-only values, and the old example pointed the client at a hardcoded `http://localhost:5173/api`.
- **Fix:** root `.env.example` (safe placeholders), `src/frontend/.env.example` (public `VITE_*` only), and `src/backend/.dev.vars.example` (server-only, gitignored sibling). The client base is `/api` by default and configurable via `VITE_API_BASE_URL`; no frontend file references a backend port.
- **Verified:** Phase 12 test recursively scans `src/frontend` for `localhost:`, `127.0.0.1`, `:8787`, `:3000`; live browser/API traffic stayed on `localhost:5173`.

### F7 — Legacy CRM code remains, isolated

- **Observed:** `src/backend/routes/*` and several CRM pages/components are still present after the ACICS build.
- **Decision:** preserved rather than deleted, per the instruction to avoid unnecessary rewrites. They are mounted under `/api/*` but are not imported by `App.tsx`, so they are not part of the ACICS UI. Their routes still require `requireDb` + `requireUser`.
- **Risk:** unused surface area; documented as cleanup debt, not a functional blocker.

---

## 5. Security posture (current)

- Sessions: `acics_session` HttpOnly/SameSite=Lax cookie, HMAC-signed, backed by `acics_sessions`; `Secure` on HTTPS.
- Passwords: PBKDF2-SHA256, 100k iterations, per-user salt, lockout after failures.
- CSRF: same-origin enforcement on mutating verbs.
- Role enforcement: server-side on every `/api/acics/*` request; the portal header can only narrow, never escalate.
- Data scoping: complainant own cases; official assigned/unassigned scope; bureau officer bureau scope; administrator system-wide.
- No public administrator-registration endpoint. Bootstrap is environment-only or a remote CLI and refuses when an administrator already exists unless forced.
- Synthetic development identities are never seeded or accepted in production.

---

## 6. Planned work completed in this audit

| Area | Change |
|---|---|
| Dev access | `POST /api/auth/dev-session`, dev sign-in UI, production refusal |
| Portal UI | Rebuilt landing/access flow, exact copy, accessible cards, dev indicator |
| Inner app | Hash routing, deep links, refresh/Back, role guards, drawer/dialog wiring |
| Structure | `src/app`+`src/worker` → `src/frontend`+`src/backend`+`src/shared`, imports and config updated |
| Seed | Idempotent dev seed endpoint and `bun run seed` CLI |
| Config | Root/frontend/backend env templates and `.gitignore` |
| Docs | `docs/PROJECT_AUDIT.md`, `docs/ROUTE_AUDIT.md`, `docs/API_AUDIT.md`, README and architecture refresh |

---

## 7. Known limitations

1. Google OAuth was not exercised with real credentials; only the `501` unconfigured path and configuration detection are verified.
2. Production refusal of mock authentication is proven by automated tests importing the worker with `APP_ENV=production`, not by a live production deployment.
3. Remote first-administrator bootstrap was not run because no remote D1 is configured here.
4. Local Miniflare D1 can still become unreadable after abnormal termination or external writers; the documented backup-and-reset procedure is required. Production D1 is unaffected.
5. The client bundle is a single chunk (513 kB minified); code-splitting is a future optimisation.
6. Legacy CRM routes/pages remain in the tree but are unreferenced by the ACICS UI.
7. Browser coverage is behavioural (DOM/route/network assertions), not pixel-diff based.
