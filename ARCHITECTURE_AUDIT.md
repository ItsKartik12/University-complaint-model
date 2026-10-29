# ACICS — Architecture Audit & Access-Control Specification

**Project:** AICTE Complaint Intelligence and Coordination System (SIH26264)
**Last verified:** 2026-10-29 (`bun test` 56/56, `bun run typecheck` clean, `bun run build` clean, browser audit 57/57, 19-section live API suite)

---

## 1. Runtime Architecture

ACICS runs on a **Cloudflare Workers unified full-stack architecture** with `@cloudflare/vite-plugin`, Vite 8, Hono and React 19.

1. **Development:** one server (`bun run dev`) on port `5173` serves the React SPA and the Hono worker. `/api/*` is dispatched straight into Miniflare.
2. **Database:** Cloudflare D1 through the `DB` binding (`c.env.DB`). D1 is an internal runtime binding, not a network-addressable database URL, so the worker cannot be split into a separate Node/Bun process without losing D1. The unified runtime is a deliberate constraint, not an oversight.
3. **Storage:** R2 through the `FILES` binding.
4. **Production:** `bun run build` emits the worker bundle plus static assets; deploy with `wrangler deploy` (D1/R2 bindings declared in `wrangler.jsonc`).

### Layer separation

```
src/
├── app/            # Presentation layer (React SPA)
│   ├── components/ # Reusable primitives (Button, Card, Drawer, Select…)
│   ├── lib/api.ts  # Typed HTTP client, portal header, auth hooks
│   ├── pages/
│   │   ├── PortalAccess.tsx  # Public 4-step portal access flow
│   │   └── Acics.tsx         # Authenticated role workspaces
│   └── App.tsx     # Gate: loading / signed-in / access flow / held / error
├── shared/types.ts # Shared domain contracts
└── worker/         # Backend layer (Hono on Cloudflare Workers)
    ├── index.ts         # Auth routes, app wiring
    ├── auth.ts          # Session tokens, password hashing, mode gating
    ├── authorization.ts # Central authorization service (single source of truth)
    ├── acics.ts         # ACICS schema, seed, domain routes, admin APIs
    └── routes/          # Legacy CRM routes (isolated)
```

The frontend never decides eligibility. It renders what `/api/auth/me`, `/api/auth/portal-access` and `/api/acics/*` return.

---

## 2. Identity, Sessions and Configuration

| Mode | Trigger | Behaviour |
|---|---|---|
| **Google OAuth** | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set | `/api/auth/google` → Google → `/api/auth/google/callback`; requires an existing linked account. Unconfigured ⇒ `501`, no session issued. |
| **Freebuff OIDC** | `FREEBUFF_CLIENT_ID` set | Upstream OIDC session verification. |
| **Development** | loopback request, no IdP configured, `APP_ENV` ≠ production | Email/password accounts seeded in D1. Synthetic identities are never seeded or accepted when `APP_ENV=production`. |
| **Disabled** | `APP_ENV=production` with no IdP | `authMode()` returns `off`; synthetic/demo sign-in is unreachable. |

- Sessions: `acics_session` cookie (`sessionId.expiresAt.HMAC-SHA256`), `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, backed by `acics_sessions`.
- Passwords: PBKDF2-SHA256, 100k iterations, per-user salt, lockout after repeated failures.
- CSRF: same-origin enforcement on mutating verbs.
- `SESSION_SECRET` is mandatory in production; development falls back to a fixed dev-only secret.
- No email address is ever treated as proof of identity or of a role.

### Google OAuth enablement checklist (prepared, not enabled)

1. Create/select a Google Cloud project and configure the OAuth consent screen with scopes `openid`, `email`, `profile`.
2. Create an OAuth 2.0 **Web application** client. Authorised JavaScript origin: `https://<host>` (locally `http://localhost:5173`). Authorised redirect URI: `https://<host>/api/auth/google/callback` (locally `http://localhost:5173/api/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` as worker secrets/vars (locally in `.dev.vars`).
4. Provision the account first: the callback links only through `google_sub`; an unknown or non-ACTIVE identity receives no session.
5. Validation already implemented: random `state` + `nonce` stored in a short-lived HttpOnly cookie, exact callback URL match, ID token `aud` / `iss` / `exp` / `email_verified` checks via Google's tokeninfo endpoint, and no account creation from the callback.

---

## 3. Role Eligibility and Authorization

Portal selection is a **request**. The grant always comes from the database.

### Account states

`PENDING_VERIFICATION` → `PENDING_APPROVAL` → `ACTIVE` → (`SUSPENDED` | `REJECTED`)

Only `ACTIVE` accounts can create sessions or call protected routes.

### Data model

- `acics_users` — identity + `account_status`, `designation`, `institution_id`, `bureau_id`, `google_sub`, legacy `role`, `active`.
- `acics_user_roles` — one row per granted role (multi-role supported).
- `acics_sessions` — server-side session records.
- `acics_account_requests` — onboarding requests with requested role, institution and designation.
- `acics_institutions`, `acics_bureaus`, `acics_complaints`, `acics_actions`, `acics_overlaps`, `acics_notifications`, `acics_attachments` — complaint domain, unchanged.

### Central service (`src/worker/authorization.ts`)

`loadAccount(db, sub)` → `canAccessPortal(account, portal)` → `resolveActiveRole(account, request)`.

Ordered checks, each with a stable code:

| Check | Code |
|---|---|
| Identity has no ACICS account | `ACCOUNT_NOT_PROVISIONED` |
| Account not `ACTIVE` | `ACCOUNT_PENDING_VERIFICATION` / `ACCOUNT_PENDING_APPROVAL` / `ACCOUNT_SUSPENDED` / `ACCOUNT_REJECTED` |
| No role assigned | `ACCOUNT_NO_ROLE` |
| Role not held for requested portal | `PORTAL_NOT_AUTHORIZED` |
| Bureau officer without bureau | `BUREAU_NOT_ASSIGNED` |
| Unrecognised portal header | `PORTAL_UNKNOWN` |
| Granted | `ALLOWED` |

The `x-acics-portal` header only narrows a session to a role the account already holds; it can never escalate. `acics.use('*')` applies this gate to **every** `/api/acics` route, so a forged frontend or direct API call receives 401/403.

### Complainant eligibility

Faculty, teachers, heads of departments, principals/directors and other authorised institutional staff may request Complainant access using a fixed designation list (`COMPLAINANT_DESIGNATIONS`). Requests are stored as `PENDING_APPROVAL` with no roles; an administrator must approve and assign a role. Privileged roles (`OFFICIAL`, `ADMIN`, `BUREAU_OFFICER`) cannot be self-assigned through onboarding.

### Administrator controls

- `GET /api/acics/admin/users` — directory with status, roles, designation, institution.
- `POST /api/acics/admin/users` — provision with generated one-time initial password.
- `PATCH /api/acics/admin/users/:sub` — approve, reject, suspend, reactivate, edit roles/designation/bureau.
- Self-protection: an administrator cannot remove their own administrator role or deactivate themselves.
- All provisioning and status transitions write to the append-only audit log.

### First-administrator bootstrap (no public registration endpoint)

There is deliberately no administrator-registration HTTP route. Two out-of-band paths exist, and both create an administrator **only while no `ADMIN` role exists**:

1. **Environment bootstrap (local/fresh deployment)** — `ensureBootstrapAdmin` runs from `/api/*` middleware when `ACICS_BOOTSTRAP_ADMIN_EMAIL` and `ACICS_BOOTSTRAP_ADMIN_PASSWORD` are set. It validates the address and a 12-character password minimum, inserts the user, the `ADMIN` role and an `ADMIN_BOOTSTRAPPED` action, and logs a warning to remove the password. Failures are logged, never surfaced as an endpoint.
2. **Remote CLI** — `bun run bootstrap:admin --email … --name … --remote --yes` writes through `wrangler d1 execute --remote` after checking the schema, duplicate email and existing administrators (`--force` required for a second one), then verifies with a read-back.

Without `--remote` the CLI only prints environment-bootstrap instructions; it never edits local Miniflare SQLite files directly, because external writers invalidate D1 session tokens.

---

## 4. Login and Portal Experience

Four-step flow in `src/app/pages/PortalAccess.tsx`:

1. **Select portal** — four cards (Complainant, Official / Case Officer, Administrator, Bureau Coordination) with eligibility notes; selecting is a request, never a grant.
2. **Sign in** — email/password with show/hide, busy state (spinner plus "Verifying credentials…" via `aria-busy`), inline errors, and a Google entry point that shows an explicit "Not configured" notice until credentials exist. No demo-account picker or account list is rendered; development credentials live in the README.
3. **Verify eligibility** — visible checklist driven by the server decision.
4. **Allow or deny** — granted: enter the workspace; denied: explicit code, account status, held roles and next action (request access / contact administrator / sign out).

`App.tsx` gates on `/api/auth/me`: 401 → access flow, 403 → held-state screen (`PENDING`/`SUSPENDED`/`REJECTED`/`NO_ROLE`), success → workspace. Stale portal preferences are cleared when the server returns `PORTAL_NOT_AUTHORIZED` / `PORTAL_UNKNOWN`.

Multi-role accounts get a portal switcher in the sidebar; the choice is stored and sent as `x-acics-portal`, then re-validated server-side on every request.

---

## 5. Data Scoping

| Role | Scope |
|---|---|
| Complainant | Own complaints only; internal notes never returned |
| Official | Assigned cases, or institution scope where assigned |
| Bureau officer | Cases assigned to their bureau; overlap review |
| Administrator | System-wide directory, audit, configuration |

Enforced in `src/worker/acics.ts` query construction, not in the UI.

---

## 6. Visual System

Government-style tokens in `src/styles.css`: navy `#163A5F`, dark navy `#102A43`, saffron `#E68A24`, green `#237A4B`, background `#F3F6F9`, surface `#FFFFFF`, text `#1F2937`, muted `#5B6573`, border `#D5DDE5`, error `#B42318`.

- Formal, restrained layout with a saffron rule on the masthead; no imitation emblems or seals.
- Shared primitives (Card, Button, Badge, Drawer, Select, Field) and token-only colours.
- Accessibility: labelled inputs, `aria-invalid`/`aria-describedby`, `aria-live` for async status, visible focus rings, keyboard-operable portal cards (radio semantics), reduced-motion support, responsive sidebar-to-top-nav switch.

---

## 7. Verification

| Check | Result |
|---|---|
| `bun test` | **56 pass, 0 fail** (250 assertions, 2 files, 3.6 s) |
| `bun run typecheck` | clean |
| `bun run build` | success — worker 261 kB, client JS 501 kB (chunk-size warning only), CSS 48 kB |
| Live API against `bun run dev` | 19-section lifecycle/authorization suite on a fresh D1: request → pending → approve → sign-in, rejection, suspension/reactivation, multi-role portals, cross-user 403, cross-bureau 403, direct admin-route 403, unauthenticated 401, unknown portal 400, complaint create + re-read, audit-log rows |
| Browser automation (headless Chrome via CDP) | **57/57 checks pass**, 0 uncaught exceptions, 0 unexpected failed requests; screenshots captured for landing, validation, checklist, all four dashboards, pending denial, portal denial, account request, mobile |
| Google OAuth | unconfigured path live-verified: `501 GOOGLE_NOT_CONFIGURED`, no `Set-Cookie`; configured path **not tested** (no credentials) |
| Production fail-safe | code path verified: `APP_ENV=production` without `SESSION_SECRET` returns `500 SESSION_CONFIG_MISSING` and issues no cookie; synthetic identities are rejected at login and not seeded |

### Known limitations

- Local D1 can end up read-only or lose its commit token if the `.wrangler/state` files were written by another process (`bun:sqlite`, `wrangler d1 execute --local`, a crashed workerd) or, in this OneDrive-synced folder, after a plain restart. Reset procedure (move the whole `.wrangler/state/v3/d1` directory) is in README.
- Live Google OAuth was not exercised; only the unconfigured and configuration-detection paths were tested.
- First-administrator bootstrap was verified with the environment flow in production mode earlier in the audit; the remote `wrangler d1 execute` path was not run because no remote D1 exists in this environment. There is no HTTP registration endpoint.
- Client bundle is a single chunk; code-splitting is a future optimisation, not a functional issue.
- Browser automation used headless Chrome over CDP (Playwright was unavailable); coverage is behavioural, not pixel-diff based.
