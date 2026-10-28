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
```

The application will be served locally at:
👉 **`http://localhost:5173`**

---

## Local Development Demo Accounts

When running on `localhost`, ACICS enables development demo identities stored in an HttpOnly, SameSite loopback cookie (`acics_demo`). No external identity provider is required.

| Role | Name | Email / Identifier | Bureau | Scope & Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Complainant** | Ananya Rao | `ananya.demo@example.test` | None | File complaints, track own complaints, view public timeline, respond to information requests |
| **Complainant** | Rohan Das | `rohan.demo@example.test` | None | File complaints, track own complaints, isolated from Ananya's cases |
| **Official** | Kavita Menon | `kavita.official@example.test` | None | Inspect assigned complaints, advance case lifecycle status, add internal notes or public updates |
| **Admin** | Devika Sharma | `devika.admin@example.test` | None | Full system dashboard, user management, institution management, audit logs, assignment override |
| **Bureau Officer** | Amit Kulkarni | `amit.pgrc@example.test` | PGRC | Public Grievance Redressal Cell queue, bureau assignments, inter-bureau transfer, overlap review |
| **Bureau Officer** | Neha Iyer | `neha.rb@example.test` | Regulation Bureau | Regulation Bureau queue, inter-bureau coordination, overlap review |

---

## Key Features & Verified Workflows

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

## Database & Architecture

- **Frontend**: React 19, Vite 8, TailwindCSS v4, TanStack Query v5, Lucide Icons, Framer Motion.
- **Backend**: Cloudflare Workers, Hono Web Framework, D1 SQLite database binding (`DB`).
- **Storage**: Local Miniflare D1 emulation configured in `wrangler.jsonc`.
- **Database Seeding**: On first run, `ensureAcics(db)` initializes schemas and seeds:
  - 6 Synthetic Demo Users
  - 10 Institutions
  - 22 Complaint records
  - 3 Bureaus
  - Demonstration audit logs and notifications

### Resetting Local Database
To clear and re-initialize the local database:
```sh
# Delete local Miniflare D1 state
rm -rf .wrangler/state/v3/d1
```
On the next request, the database will be freshly seeded with synthetic demo records.

---

## Security Architecture

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

Test coverage includes:
- **D1 Mock & Seed**: Verification of schema creation and synthetic dataset counts.
- **Authentication & Sessions**: Health checks, mode discovery, cookie issuance, unauthorized access rejection.
- **Complainant Lifecycle**: Intake validation, persistence, case isolation, response flow.
- **Official & Bureau Workflows**: Status transitions, forbidden transition rejection (409), note visibility, case assignment, bureau transfer.
- **Administrator Capabilities**: User management, institution creation, self-deactivation prevention, audit logging.
- **Security & Integrity**: SQL injection attack resilience, XSS boundaries, CSRF/origin verification.
