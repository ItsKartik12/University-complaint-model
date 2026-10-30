# AICTE Complaint Intelligence & Coordination System (ACICS)
**Project Reference:** SIH26264

ACICS is a secure, role-based platform for monitoring, tracking, investigating, coordinating, and resolving institution-related complaint cases across AICTE bureaus and cells.

> [!NOTE]
> All preloaded records, institutions, and demo accounts are synthetic. This project does not connect to live AICTE systems or external services.

---

## Quick Start & Local Execution

### Prerequisites
- **Runtime**: [Bun](https://bun.sh/) (v1.4+) or Node.js (v20.19+)
- **OS**: Windows / Linux / macOS

### Installation & Run Steps
```sh
# 1. Install dependencies
bun install

# 2. Run TypeScript typecheck
bun run typecheck

# 3. Run automated tests (Unit, API, Integration, Security)
bun test

# 4. Verify production bundle build
bun run build

# 5. Start local development server (Vite + local Cloudflare Worker & D1 binding)
bun run dev

# 6. Optional: ensure the synthetic dataset without deleting existing rows
bun run seed
```

The application will be served locally at:
👉 **`http://localhost:5173`**

The Worker and the React app share one Vite process because D1 is an internal Cloudflare binding. `dev:frontend` and `dev:backend` are aliases of `dev` for command compatibility; starting them together still means one server, not two ports.

| Script | Purpose |
| :--- | :--- |
| `bun run dev` | Unified Vite + Worker + Miniflare D1 server |
| `bun run dev:frontend`, `bun run dev:backend` | Aliases of the unified server |
| `bun run seed` | POST `/api/dev/seed` (development only, idempotent) |
| `bun test` | 68 tests / 411 assertions |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run build` | Worker bundle + static client |
| `bun run bootstrap:admin` | Out-of-band first administrator (see below) |

---

## Local Development Access

Local development uses a **labelled synthetic session**, issued by the worker only while `APP_ENV` is not `production` and the request originates from a loopback origin.

1. Open `http://localhost:5173`.
2. Choose any of the four portal cards.
3. Enter **any non-empty user ID or email address** (for example `reviewer@example.org`). A password is not required.
4. Continue: the backend creates a deterministic `dev-` account holding all four portal roles, so every workspace can be explored without an approval workflow.
5. Switch portals from the sidebar; each switch is re-validated by the server.

The screen and the session response both say `LOCAL DEVELOPMENT MODE`. This is explicitly synthetic — it is not a verified identity and must not be described as one. The endpoint returns `403 DEV_AUTH_DISABLED` when `APP_ENV=production`, behind an identity provider, or on a non-loopback origin, so the bypass cannot be enabled in production.

The client base URL is same-origin `/api` by default (`VITE_API_BASE_URL`); no frontend file hardcodes a backend port.

### Seeded development accounts (optional)

The synthetic dataset also includes real email/password accounts for testing approval and denial paths. They exist only outside production: with `APP_ENV=production` they are neither seeded nor accepted at sign-in. The sign-in screen does not list or auto-fill accounts; use the credentials below.

All seeded accounts use the development password **`AcicsPassword#2026`**.

| Status | Role(s) | Name | Email |
| :--- | :--- | :--- | :--- |
| ACTIVE | Complainant | Ananya Rao | `ananya.demo@example.test` |
| ACTIVE | Complainant | Rohan Das | `rohan.demo@example.test` |
| ACTIVE | Official | Kavita Menon | `kavita.official@example.test` |
| ACTIVE | Admin | Devika Sharma | `devika.admin@example.test` |
| ACTIVE | Bureau Officer (PGRC) | Amit Kulkarni | `amit.pgrc@example.test` |
| ACTIVE | Bureau Officer (Regulation) | Neha Iyer | `neha.rb@example.test` |
| ACTIVE | Complainant + Official | Priya Verma | `priya.multirole@example.test` |
| PENDING_APPROVAL | — | Suresh Nair | `suresh.pending@example.test` |
| SUSPENDED | Official | Meera Joshi | `meera.suspended@example.test` |

The pending and suspended accounts are seeded deliberately so the denial paths are observable: sign-in returns `ACCOUNT_PENDING_APPROVAL` / `ACCOUNT_SUSPENDED` instead of a session.

### Portal access flow

1. Choose a portal (Complainant, Official / Case Officer, Administrator, Bureau Coordination). The choice is a request, not a grant.
2. Sign in.
3. Eligibility is evaluated server-side and shown step by step.
4. Access is either granted or denied with an explicit reason code.

Only accounts with the matching role and `ACTIVE` status can enter a portal. Multi-role accounts can switch portals from the sidebar; every switch is re-validated by the server.

### Account requests and approval

A faculty member, teacher, head of department, principal or other authorised staff member can request Complainant access from the sign-in screen. The request is stored as `PENDING_APPROVAL` with no role. An administrator approves it from **Administration → Users**, which assigns the role and writes an audit entry. Privileged roles (`OFFICIAL`, `ADMIN`, `BUREAU_OFFICER`) cannot be self-assigned.

### First-administrator bootstrap

ACICS has **no administrator-registration HTTP endpoint**. The first administrator is created out-of-band, and only while no `ADMIN` role exists.

**Local / fresh deployment (environment bootstrap).** Add the following to `.dev.vars` and start the worker once:

```sh
ACICS_BOOTSTRAP_ADMIN_EMAIL=you@institution.ac.in
ACICS_BOOTSTRAP_ADMIN_NAME="Your Name"
ACICS_BOOTSTRAP_ADMIN_PASSWORD="a-strong-password-at-least-12-chars"
```

`ensureBootstrapAdmin` (`src/backend/acics.ts`) validates the email and the 12-character minimum, inserts the account, its `ADMIN` role and an `ADMIN_BOOTSTRAPPED` audit entry, then logs a warning. It is a no-op once any administrator exists, so it is safe to leave configured — but remove `ACICS_BOOTSTRAP_ADMIN_PASSWORD` after the first sign-in. Quote any value containing `#`; Wrangler treats an unquoted `#` as a comment.

**Deployed D1 (remote CLI).** Load the deployed site once (so the schema exists), then run:

```sh
bun run bootstrap:admin --email you@institution.ac.in --name "Your Name" --remote --yes
```

The script prints a generated password (or accepts `--password`), refuses to run without `--remote --yes`, refuses when an administrator already exists unless `--force` is passed, and verifies the insert with a read-back. Without `--remote` it only prints the local environment-bootstrap lines above; it never writes local Miniflare SQLite files directly.

### Google OAuth configuration

Google sign-in is fully wired but returns `501 GOOGLE_NOT_CONFIGURED` with no session cookie until credentials exist. To enable it:

1. In Google Cloud Console, create or select a project and configure the OAuth consent screen (External or Internal as appropriate). Add scopes `openid`, `email`, `profile`.
2. Create an **OAuth client ID → Web application**.
3. Add Authorised JavaScript origin `http://localhost:5173` (and the deployed origin in production).
4. Add Authorised redirect URI `http://localhost:5173/api/auth/google/callback` (and `https://<deployed-host>/api/auth/google/callback`).
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` in `.dev.vars` locally and as Worker secrets in production (`wrangler secret put`).
6. Restart the worker; `GET /api/auth/status` then reports `googleConfigured: true` and the sign-in screen shows a Google button instead of the "Not configured" note.

Live Google sign-in was **not** exercised in this environment because no real OAuth credentials were available; only the unconfigured path is verified.

---

## Key Features & Verified Workflows

0. **Portal access and eligibility**:
   - Four-step public flow: select portal → sign in → verify eligibility → allow/deny.
   - Server-side eligibility from account status, assigned roles and bureau assignment; the browser can request a portal but never grant one.
   - Explicit denial codes (`ACCOUNT_PENDING_APPROVAL`, `ACCOUNT_SUSPENDED`, `PORTAL_NOT_AUTHORIZED`, `BUREAU_NOT_ASSIGNED`, …) surfaced as human-readable guidance.
   - Account-request onboarding for teaching and institutional staff; administrator approval required.
   - Administrator user management with approve/reject/suspend/reactivate, multi-role assignment, generated one-time initial passwords, and audit logging.
   - Google OAuth wiring is in place and fails safely (`501`, no session) until credentials are configured; see [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md).

1. **Complainant Portal**:
   - Multi-step complaint intake with real-time field validation.
   - Safe institution selector (`GET /api/acics/institutions-list`) preventing exposure of internal metrics.
   - Unique reference number generation (format: `AC-YYYY-XXXX`).
   - Secure case timeline viewing (internal official notes hidden).
   - In-app notification center with one-click "Mark all as read".
   - Case response flow: Returning a case from `AWAITING_INFORMATION` back to `UNDER_PROCESS`.

2. **Official / Case Officer Portal**:
   - Queue of assigned complaints with status, priority, and deadline alerts.
   - Enforced status lifecycle transitions:
     - `SUBMITTED` ➔ `UNDER_REVIEW` / `REJECTED`
     - `UNDER_REVIEW` ➔ `UNDER_PROCESS` / `AWAITING_INFORMATION` / `TRANSFERRED` / `ESCALATED` / `REJECTED`
     - `UNDER_PROCESS` ➔ `AWAITING_INFORMATION` / `TRANSFERRED` / `ESCALATED` / `RESOLVED`
     - `AWAITING_INFORMATION` ➔ `UNDER_PROCESS` / `RESOLVED`
     - `TRANSFERRED` ➔ `UNDER_REVIEW` / `UNDER_PROCESS` / `ESCALATED`
     - `RESOLVED` ➔ `CLOSED` / `UNDER_PROCESS`
   - Internal case notes vs. public complainant-visible remarks.

3. **Bureau Coordination Portal**:
   - Bureau-scoped case queues (PGRC, Regulation Bureau, Academic Coordination Cell).
   - Inter-bureau case transfer with automated target bureau validation and audit logging (`BUREAU_TRANSFERRED`).
   - Staff officer assignment and reassignment (`PATCH /api/acics/complaints/:id/assign`).
   - Cross-bureau candidate overlap comparison with explainable rule-based scoring and human review (`CONFIRMED`, `REJECTED`, `INVESTIGATE`). Overlaps never auto-merge cases.

4. **Administrator Portal**:
   - High-level system dashboard with real-time counts (total cases, open cases, overdue cases, institutions, users).
   - User directory with role/query filtering (`GET /api/acics/admin/users`).
   - User creation and role management (`POST /api/acics/admin/users`, `PATCH /api/acics/admin/users/:sub`).
   - Guarded self-protection: Prevents administrators from deactivating their own account.
   - Institution management (`POST /api/acics/admin/institutions`, `PATCH /api/acics/admin/institutions/:id`).
   - Tamper-evident, append-only system audit log (`GET /api/acics/admin/audit-logs`).

---

## Source Structure

```
src/
├── backend/     Hono worker: auth, authorization, ACICS schema/routes, admin APIs
├── frontend/    React SPA: portal access flow, role workspaces, UI primitives
└── shared/      Safe cross-layer types
```

The backend is `src/backend/index.ts` (worker entry, declared in `wrangler.jsonc`). The frontend entry is `src/frontend/main.tsx` (loaded by `index.html`). Neither side imports secrets or the other's implementation.

Configuration templates:

- `.env.example` — public and local runtime placeholders.
- `src/frontend/.env.example` — `VITE_*` public values only.
- `src/backend/.dev.vars.example` — server-only values; copy to the repository root as `.dev.vars` (gitignored).

Database and API findings, route coverage, and remaining gaps are documented in [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md), [docs/ROUTE_AUDIT.md](docs/ROUTE_AUDIT.md), and [docs/API_AUDIT.md](docs/API_AUDIT.md).

---

## Database & Architecture

- **Frontend**: React 19, Vite 8, TailwindCSS v4, TanStack Query v5, Lucide Icons, Framer Motion.
- **Backend**: Cloudflare Workers, Hono Web Framework, D1 SQLite database binding (`DB`).
- **Storage**: Local Miniflare D1 emulation configured in `wrangler.jsonc`.
- **Database Seeding**: On first request, `ensureAcics(db)` initializes the schema and inserts missing synthetic records:
  - 9 accounts (7 active demo identities, 1 pending approval, 1 suspended) and their role assignments
  - 10 institutions, 22 complaint records, 3 bureaus
  - Demonstration audit logs and notifications
  - `bun run seed` re-runs the same idempotent seeding; no existing row is deleted or rewritten.

### Resetting Local Database
Local D1 state lives in `.wrangler/state/v3/d1`. If it becomes unreadable or read-only (for example after switching Miniflare/workerd versions, or after an external process wrote to the SQLite files), stop the dev server, back up the **whole** directory, then remove it:

```sh
# 1. Stop `bun run dev`
# 2. Back up the generated state (reversible)
mv .wrangler/state/v3/d1 .wrangler/state/v3/d1.bak
# 3. Restart
bun run dev
```

The next request recreates and reseeds the database with synthetic records. Removing only `miniflare-D1DatabaseObject` is not enough: the peer `metadata.sqlite` keeps the old commit counter and the error returns.

### Troubleshooting D1 storage errors

`D1_ERROR: attempt to write a readonly database` or `Failed to get session commit token: internal error` on the first request means the local Miniflare database state is stale or was committed by something other than the running workerd process. External writers (`bun:sqlite`, `wrangler d1 execute --local`, another workerd instance) invalidate the D1 session token; in this repository's OneDrive-synced folder a plain restart can do the same. Stop the dev server, apply the backup-and-remove procedure above, and restart. No source change is involved; production D1 is unaffected.

---

## Security Architecture

- **Server-side eligibility**: every `/api/acics/*` route passes through the authorization gate (`loadAccount` → `canAccessPortal` → `resolveActiveRole`). The `x-acics-portal` header can only narrow a session to a role the account already holds.
- **Account lifecycle**: `PENDING_VERIFICATION`, `PENDING_APPROVAL`, `ACTIVE`, `SUSPENDED`, `REJECTED`; only `ACTIVE` accounts can hold sessions.
- **Sessions**: HMAC-signed `acics_session` cookie backed by `acics_sessions`; PBKDF2-SHA256 passwords (100k iterations); lockout after repeated failures.
- **Zero-Trust Role Enforcement**: All protected routes verify user identity and role on the server; client-side parameters are never trusted.
- **Data Isolation**: Complainants can only read and mutate their own complaints. Officers cannot view or mutate cases outside their assigned bureau/jurisdiction.
- **Cross-Site Request Forgery (CSRF) Protection**: Same-origin enforcement (`isSameOriginRequest`) blocks cross-origin mutations.
- **SQL Injection Resistance**: All SQL queries utilize parameterized bindings (`prepare(...).bind(...)`).
- **Input Sanitization**: Strings and payloads are trimmed, bounded, and validated on the backend.
- **Cache-Control**: Sensitive API responses return `Cache-Control: private, no-store`.

---

## Automated Test Suite

Run the full automated test suite with:
```sh
bun test
```

Current result: **68 passing, 0 failing** (411 assertions, 2 files, ~4.6 s).

Test coverage includes:
- **D1 Mock & Seed**: Verification of schema creation and synthetic dataset counts.
- **Authentication & Sessions**: Health checks, mode discovery, cookie issuance, unauthorized access rejection.
- **Portal eligibility**: portal selection never grants access, header enforcement on protected routes, unknown portal rejection, multi-role portal access, pending/suspended sign-in blocks.
- **Onboarding**: public onboarding options, privileged self-assignment refusal, account request → administrator approval → sign-in → audit trail.
- **Administration**: user directory, provisioning, role/status edits, self-role-removal prevention, production demo sign-in disabled.
- **Complainant Lifecycle**: Intake validation, persistence, case isolation, response flow.
- **Official & Bureau Workflows**: Status transitions, forbidden transition rejection (409), note visibility, case assignment, bureau transfer.
- **Administrator Capabilities**: User management, institution creation, self-deactivation prevention, audit logging.
- **Security & Integrity**: SQL injection attack resilience, XSS boundaries, CSRF/origin verification.
- **Local development access**: arbitrary non-empty ID sign-in, blank rejection, all four portals, production refusal of mock auth and seeding.
- **Configuration & client contract**: missing D1 returns JSON 503, unknown API paths return JSON errors, no hardcoded backend ports in the frontend, idempotent seed.

### Browser verification

The UI was driven through headless Chrome over the DevTools Protocol against `bun run dev` on a fresh local D1 (2026-10-30):

- **43/43 core UI checks**: public flow and exact copy, Help/About, development sign-in, all four portals, portal switching, direct hash navigation, nested refresh, Back, complaint submission, case drawer, 390 × 844 mobile layout. No uncaught exceptions; the only failed network requests were the expected signed-out `/api/auth/me` 401s.
- **39/39 route-sweep checks**: 27 role→page combinations, hidden navigation for complainants, institution/overlap drawers, admin dialogs, mobile navigation and switcher. No 5xx responses.
- **28/28 live API checks**: unauthenticated 401s, onboarding 200, Google 501, dev-session validation, portal narrowing, complaint create → list → detail → status transition, admin-only 403s, cross-identity isolation, logout invalidation.

Repeat the key paths manually:

1. `bun run dev`, open `http://localhost:5173`.
2. Choose **Complainant Portal**, enter `reviewer@example.org`, continue → workspace opens in local development mode.
3. Use the sidebar portal switcher to open Official, Administrator, and Bureau workspaces without signing in again.
4. Refresh a nested route such as `#/users` or a case detail; use Back to return to the previous screen.
5. Submit a complaint from **Case queue → Submit a complaint**; confirm it appears in the complainant queue and survives refresh.
6. Sign out; the session cookie is cleared and `/api/auth/me` returns `401`.
7. To verify the real approval path instead, sign in with `devika.admin@example.test` and approve the pending request from Suresh Nair; or sign in as `meera.suspended@example.test` to see the suspension denial.
