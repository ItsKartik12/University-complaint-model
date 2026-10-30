# ACICS — API Audit

**Audit date:** 2026-10-30
**Base URL:** `http://localhost:5173/api` (same origin as the SPA)
**Server:** Hono on Cloudflare Workers (`src/backend/index.ts`, `src/backend/acics.ts`)
**Methods used:** live `fetch` calls against the running development server, the automated test suite, and browser network capture.

---

## 1. Contract and verification method

- All responses are JSON. Errors are `{ "error": string, "code"?: string }`; no endpoint returns a fabricated success.
- Mutating requests require a same-origin `Origin` header (CSRF guard).
- Authenticated requests carry the `acics_session` cookie and optionally `x-acics-portal`.
- Sensitive responses set `Cache-Control: private, no-store`.
- Status conventions observed: `200` read/update, `201` create, `400` validation, `401` no session, `403` authenticated but not authorised, `404` unknown resource, `409` conflict/forbidden transition, `500` unexpected error, `501` Google not configured, `503` database binding missing.

Verification sources:

| Source | Scope | Result |
|---|---|---|
| Live API suite (`live-api.mjs`) | 28 checks across auth, dev session, portal narrowing, complaint lifecycle, role denial, identity isolation | **28/28 pass** |
| `bun test` | 68 tests / 411 assertions across worker routes, authorization, security, configuration | **68 pass** |
| Browser network capture | Every request made by the 43-check UI audit and 39-check route sweep | 0 unexpected failures, 0 server errors |

---

## 2. Public and authentication endpoints

| Method | Path | Auth | Consumers | Live result |
|---|---|---|---|---|
| GET | `/api/auth/status` | public | `useAuthStatus` (portal page, dev banner) | `200` with `mode`, `database`, `files`, `googleConfigured`, `devAuthEnabled`, `appEnv`, portals; `demoAccounts` only in development |
| GET | `/api/health` | public | readiness checks | `200 {"ok":true,"database":true}` |
| GET | `/api/acics/health` | public | readiness checks | `200` |
| POST | `/api/auth/login` (alias `/api/acics/login`) | public | seeded email/password sign-in | `200` session; `401` bad credentials; `403` for pending/suspended/rejected accounts with a code (automated tests) |
| POST | `/api/auth/logout` (alias `/api/acics/logout`) | session | sign-out | `200`, clearing cookie; old cookie then returns `401` on `/auth/me` |
| GET | `/api/auth/me` | session | app gate | `401` signed out (live), `403` held/denied with code, `200` account summary; `503` when D1 is missing (test) |
| POST | `/api/auth/portal-access` | session | eligibility step | `401` signed out (live), `400 PORTAL_UNKNOWN`, `403` denial with `code/accountStatus/roles`, `200 ALLOWED` |
| GET | `/api/auth/onboarding/options` | public | account-request form | `200` designations + institutions (live); `503` when D1 is missing (test) |
| POST | `/api/auth/account-request` | public (DB required) | account request | `201 PENDING_APPROVAL`; `403 PRIVILEGED_PORTAL_DENIED`; `400` validation; `409` duplicate email (tests) |
| POST | `/api/auth/forgot-password` | public | recovery notice | `200` generic message; `400` invalid email |
| GET | `/api/auth/google` | public | Google entry point | `501 GOOGLE_NOT_CONFIGURED` with no cookie (live); redirect when configured |
| GET | `/api/auth/google/callback` | public | OAuth callback | configured flow only; no account creation; not exercised live |
| POST | `/api/acics/demo-login`, `/api/acics/demo-logout` | loopback only | legacy demo helpers | loopback-gated; not used by the current UI |
| POST | `/api/auth/dev-session` | development only | dev sign-in panel | `200` + synthetic session (live); `400 DEV_ID_REQUIRED`; `400 PORTAL_UNKNOWN`; `403 DEV_AUTH_DISABLED` in production (test) |
| POST | `/api/dev/seed` | development only | `bun run seed` | `200` with counts (live: 22/9/10); `403 DEV_SEED_DISABLED` in production (test); idempotent (test) |

### Development-only safety

`authMode(env, request)` returns:

- `freebuff` when `FREEBUFF_CLIENT_ID` is set;
- `off` when `APP_ENV=production`;
- `development` only for loopback requests otherwise.

`/api/auth/dev-session` and `/api/dev/seed` both require `authMode(...) === 'development'`, so neither is reachable in production or on a non-loopback origin. The synthetic subject uses the `dev-` prefix and the response says `"Synthetic development session. This is not a verified or production identity."`

---

## 3. ACICS application endpoints

Every route below is mounted behind `requireDb`, `requireUser`, and the central authorization middleware (account status + portal/role check). Role-dependent scoping is applied in the query, not the UI.

| Method | Path | Role rule | Consumers | Verification |
|---|---|---|---|---|
| GET | `/api/acics/me` | any active | workspace identity | tests + browser |
| GET | `/api/acics/categories` | any active | filters, complaint form | tests + browser |
| GET | `/api/acics/bureaus` | complainant `403` | bureau directory, case assignment | tests |
| GET | `/api/acics/complaints` | scoped: complainant own; official assigned/unassigned/all; bureau bureau-scoped; admin all | case queues, overview | live `200` complainant (total 1) / admin (total 23) |
| POST | `/api/acics/complaints` | `COMPLAINANT` only | submit form | live `403` without complainant portal, `201 AC-2026-993829` with it |
| GET | `/api/acics/complaints/:id` | `canSeeCase` | case drawer | live `200`; cross-identity `403` |
| PATCH | `/api/acics/complaints/:id/status` | staff scope; complainant only `AWAITING_INFORMATION → UNDER_PROCESS` | status controls | live complainant `403`; admin `SUBMITTED → UNDER_REVIEW` `200` and persisted |
| PATCH | `/api/acics/complaints/:id/assign` | `ADMIN` / `BUREAU_OFFICER` / `OFFICIAL` within scope | assignment | tests |
| POST | `/api/acics/complaints/:id/actions` | `canSeeCase`; complainant responses forced `PUBLIC` | case remarks | tests |
| GET | `/api/acics/institutions-list` | any active | complainant institution selector | live `200` (10 items) |
| GET | `/api/acics/officers` | complainant `403` | assignment picker | tests |
| GET | `/api/acics/institutions` | complainant `403` | institution profiles | tests + browser route |
| GET | `/api/acics/institutions/:id` | complainant `403`; staff scoped | institution drawer | browser: `#/institutions/inst-005` |
| GET | `/api/acics/overlaps` | complainant `403`; staff scoped | overlap center | live complainant `403`; browser review drawer |
| PATCH | `/api/acics/overlaps/:id/review` | staff with case visibility | review decision | tests |
| GET | `/api/acics/analytics` | role-scoped totals | overview cards | browser all roles |
| GET | `/api/acics/notifications` | own notifications | notification center | browser all roles |
| PATCH | `/api/acics/notifications/:id/read` | recipient only | mark one read | tests |
| PATCH | `/api/acics/notifications/read-all` | recipient only | mark all read | tests |

### Administrator endpoints

| Method | Path | Rule | Verification |
|---|---|---|---|
| GET | `/api/acics/admin/users` | `ADMIN` | live `403` complainant, `200` admin (11 users) |
| POST | `/api/acics/admin/users` | `ADMIN` | tests; returns one-time `initialPassword`, `201` |
| PATCH | `/api/acics/admin/users/:sub` | `ADMIN`; self-role/self-deactivation blocked | tests |
| POST | `/api/acics/admin/institutions` | `ADMIN` | tests; `409` duplicate identifier |
| PATCH | `/api/acics/admin/institutions/:id` | `ADMIN` | tests |
| GET | `/api/acics/admin/audit-logs` | `ADMIN` | tests + browser audit page |

All provisioning, status, institution, and complaint actions write append-only `acics_actions` rows. The audit log query joins actor names and complaint numbers and is limited to 200 rows.

---

## 4. Live verification log (2026-10-30)

Session: `POST /api/auth/dev-session` with `audit-api@example.org`.

| Check | Observed |
|---|---|
| `GET /auth/me` without cookie | `401` |
| `GET /auth/onboarding/options` | `200`, designations present |
| `GET /auth/portal-access` / `POST` without cookie | `401` |
| `GET /auth/google` | `501 GOOGLE_NOT_CONFIGURED`, no session cookie |
| `GET /acics/complaints` without cookie | `401` |
| `GET /does-not-exist` without cookie | `401`; with session `404 {"error":"Not found."}` |
| `POST /auth/dev-session` blank ID | `400 DEV_ID_REQUIRED` |
| `POST /auth/dev-session` unknown portal | `400 PORTAL_UNKNOWN` |
| `POST /auth/dev-session` valid | `200`, `LOCAL DEVELOPMENT MODE`, session cookie |
| `GET /auth/me` | `200`, primary role `ADMIN` |
| `GET /auth/me` with `x-acics-portal: bogus` | `400 PORTAL_UNKNOWN` |
| `GET /acics/institutions-list` as complainant portal | `200`, 10 institutions |
| `POST /acics/complaints` without complainant portal | `403` |
| `POST /acics/complaints` with complainant portal | `201 AC-2026-993829` |
| `GET /acics/complaints?q=<subject>` as complainant | `200`, total 1 |
| `GET /acics/complaints/:id` | `200`, `SUBMITTED` |
| `PATCH .../status` as complainant | `403` |
| `PATCH .../status` as admin | `200`, `UNDER_REVIEW` |
| Re-read detail | `200`, `UNDER_REVIEW` |
| `GET /acics/complaints` as admin | `200`, total 23 |
| `GET /acics/admin/users` as complainant | `403` |
| `GET /acics/admin/users` as admin | `200`, 11 users |
| `GET /acics/overlaps` as complainant | `403` |
| Second dev identity reading the first identity's complaint | `403` |
| `POST /auth/logout` | `200`, clearing cookie; subsequent `/auth/me` `401` |

The portal header demonstrably narrows rather than escalates: the dev account's primary role is `ADMIN`, yet complaint creation only succeeded when the request carried `x-acics-portal: complainant`, which the server resolved to `COMPLAINANT`.

---

## 5. Automated coverage mapped to API areas

| Test group | API areas |
|---|---|
| Phase 4: Health and Auth Endpoints | `/health`, `/auth/status`, `/auth/me`, `/auth/logout` |
| Phase 4B: Real Email/Password Authentication & Sessions | `/auth/login`, cookie issuance, lockout, session expiry |
| Phase 3A: Complainant Portal Workflows | complaint create/list/detail, validation, scoping |
| Phase 3B: Official / Case Officer Workflows | status transitions, forbidden transition `409`, note visibility |
| Phase 3C & 3D: Bureau Coordination & Officer Assignment | bureau scope, transfer, assignment |
| Phase 3C: Administrator Portal & User Management | user CRUD, role edits, self-protection, institutions, audit |
| Phase 7: End-to-End Complainant Response Workflow | `AWAITING_INFORMATION → UNDER_PROCESS` |
| Phase 9: Security & Input Robustness | SQL injection, XSS input, CSRF/origin checks |
| Phase 10: Portal eligibility, multi-role access, and account approval | `/auth/portal-access`, onboarding → approval → sign-in, pending/suspended denial, unknown portal |
| Phase 11: Local development access | arbitrary ID sign-in, blank rejection, portal switching, production refusal |
| Phase 12: Configuration, errors, and client contract | missing D1 `503`, unknown paths, no hardcoded ports, idempotent seed, production seed refusal |
| D1 Mock and Seed | schema creation and seeded counts |

---

## 6. Legacy endpoints (retained, not consumed by the SPA)

`/api/overview`, `/api/search`, `/api/contacts*`, `/api/companies*`, `/api/deals*`, `/api/tasks*`, `/api/activities*`, `/api/files*` are mounted after `requireDb` + `requireUser`. They are not called by the ACICS frontend and should be removed or isolated if the CRM prototype is retired.

---

## 7. Gaps

1. Google OAuth callback was not exercised with real credentials.
2. `POST /admin/users`, `PATCH /admin/users/:sub`, and institution mutation endpoints were verified by automated tests, not by live HTTP calls in this audit (browser dialogs were opened but not submitted).
3. Assignment and overlap-review mutations were verified by tests, not by a live browser click.
4. The remote administrator bootstrap path (`wrangler d1 execute --remote`) was not run because no remote D1 exists here.
