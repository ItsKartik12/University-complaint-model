# ACICS — Route and Interaction Audit

**Audit date:** 2026-10-30
**Target:** `http://localhost:5173` (`bun run dev`, fresh local D1, seeded 22 complaints / 9 users / 10 institutions)
**Driver:** headless Chrome over the DevTools Protocol (CDP) at `127.0.0.1:9222`, plus live HTTP checks.
**Session used for role sweeps:** development session `route-sweep@example.org`, which holds all four portal roles; each portal was entered through the sidebar switcher, not by re-signing in.

---

## 1. Method and result summary

| Harness | What it does | Result |
|---|---|---|
| Core UI audit (`dev-audit.mjs`) | public flow, card copy, dev sign-in, all four portals, direct hash navigation, nested refresh, Back, complaint submission, case drawer, mobile | **43/43 checks**, 0 exceptions |
| Route sweep (`route-sweep.mjs`) | 27 role→page combinations, hidden-nav check, institution drawer, overlap drawer, admin dialogs, mobile navigation and switcher, network/exception capture | **39/39 checks**, 0 server errors |
| Live API suite (`live-api.mjs`) | auth contract, dev session, portal narrowing, complaint lifecycle, role denials, cross-identity isolation | **28/28 checks** |
| Logout probe | dev session → logout → `/api/auth/me` with the old cookie | `200` + clearing cookie, then `401` |

No blank pages, dead navigation targets, endless spinners, wrong redirects, or uncaught runtime exceptions were observed in the final runs. The only `401` responses recorded by the browser were the expected signed-out `/api/auth/me` probes.

---

## 2. Route matrix

Routes are hash-based and rendered by `src/frontend/pages/Acics.tsx`; the public flow is `src/frontend/pages/PortalAccess.tsx`.

| Route | Screen | Access rule | API dependencies | Observed status | Evidence |
|---|---|---|---|---|---|
| `/` | Four-step portal access | Public | `GET /api/auth/status`, `/auth/me`, `/auth/onboarding/options`, `/auth/portal-access`, `POST /auth/dev-session`, `/auth/account-request` | Pass | Core audit: heading, exact dev copy, four cards, dev sign-in, blank rejection |
| `#/overview` | Role overview | Any active session | `GET /api/acics/analytics`, `/complaints?pageSize=5` | Pass for all four roles | Route sweep: Complainant, Official, Bureau, Administration |
| `#/complaints` | Case queue | Any active session; scoped by role | `GET /api/acics/complaints` | Pass for all four roles; complainant sees `My complaints`, staff sees `Assigned complaints` | Route sweep ×4; core audit: new complaint listed |
| `#/complaints/:id` | Case drawer | Case must pass `canSeeCase` | `GET /api/acics/complaints/:id`, `/bureaus` | Pass | Core audit: deep link, history, refresh, Back to `#/complaints` |
| `#/overlaps` | Cross-bureau overlap center | Complainant excluded; Official, Bureau, Admin | `GET /api/acics/overlaps` | Pass for the three staff roles | Route sweep ×3 |
| `#/overlaps/:id` | Overlap review drawer | Same as list | `GET /api/acics/overlaps`, `PATCH /overlaps/:id/review` | Pass | Route sweep: `Compare cases` opens `#/overlaps/<pair>` and closes back to the list |
| `#/institutions` | Institution profiles | Complainant excluded; staff | `GET /api/acics/institutions` | Pass for the three staff roles | Route sweep ×3 |
| `#/institutions/:id` | Institution drawer | Same as list | `GET /api/acics/institutions/:id` | Pass | Route sweep: `View profile` opens `#/institutions/inst-005`, closes back |
| `#/users` | User and role management | `ADMIN` only | `GET /api/acics/admin/users` | Pass | Route sweep: nav present only for Administration; page renders |
| `#/bureau` | Bureau directory | Complainant excluded | `GET /api/acics/bureaus` | Pass for the three staff roles | Route sweep ×3 |
| `#/notifications` | Notification center | Any active session | `GET /api/acics/notifications` | Pass for all four roles and on mobile | Route sweep ×4 + mobile check |
| `#/audit` | Audit log | `ADMIN` only | `GET /api/acics/admin/audit-logs` | Pass | Route sweep: Administration |
| `#/settings` | Account and prototype settings | Any active session | None beyond session state | Pass for all four roles | Route sweep ×4 |
| Unknown hash, e.g. `#/nope` | Falls back to Overview | Any active session | Same as Overview | Pass (by `readRoute`) | Code path; role guard also redirects page keys the role may not use |
| Sign out | Sidebar/header action | Any active session | `POST /api/auth/logout` | Pass | Logout probe: cookie cleared, `/api/auth/me` → 401 |

### Role guard behaviour

`readRoute()` only accepts known page keys, and `visiblePage` is computed during render:

```ts
const routeItem = NAV.find(([, key]) => key === page)
const visiblePage = routeItem && routeItem[2](active.role) ? page : 'overview'
```

If a complainant manually enters `#/institutions`, the workspace renders Overview and rewrites the hash. The server would reject the underlying data call anyway (`403`), so the redirect is an extra UX guard, not the security boundary.

### Hidden navigation

The sweep asserted that a complainant's sidebar contains none of: `User management`, `Audit log`, `Institutions`, `Cross-bureau overlaps`, `Bureau directory`.
Result: **pass**.

---

## 3. Interaction checks

| Interaction | Expected | Observed |
|---|---|---|
| Portal cards | Four uniform cards, visible `Enter portal`, selected state | Pass; `aria-pressed` selected state, four cards with exact copy |
| Keyboard semantics | Cards/actions are native buttons; focus ring visible | Native `<button>` elements with focus-visible styles; Enter/Space activation is browser-native. A full scripted tab-order walk was not repeated in this run |
| Development sign-in | Any non-empty ID, optional display name, no password | Pass: blank rejected inline; non-empty enters workspace |
| Google entry | No misleading failure | Pass: unconfigured copy explains credentials are not configured; no failed redirect attempt |
| Help / About | Dialogs open, no dead buttons | Pass both |
| Portal switcher | All held roles listed; switching re-validates | Pass; all four roles listed; each portal reachable without re-signing in |
| Direct navigation | `#/users`, `#/institutions` open their screens | Pass |
| Nested refresh | Reload keeps the current nested route and content | Pass (`#/institutions` and `#/complaints/:id`) |
| Back | Returns to the previous hash route | Pass (`#/settings`/`#/users` and drawer → list) |
| Complaint submission | Create through UI and list it | Pass: `AC-2026-434239` created and listed |
| Case drawer | Opens, shows history, survives refresh | Pass |
| Institution drawer | Opens from `View profile`, closes to list | Pass |
| Overlap drawer | Opens from `Compare cases`, closes to list | Pass |
| Admin dialogs | `Add user` and `Add institution` open with correct forms | Pass: “Add authorised user” (Create user) and “Add institution” (Institution name) |
| Mobile (390 × 844) | Primary nav and portal switcher visible; landing usable | Pass |

---

## 4. Defects found and resolved during the audit

| Finding | Resolution |
|---|---|
| Inner screens were not addressable by URL/refresh | Hash router with `hashchange` sync, deep links, Back, and role-aware fallback |
| Public flow required seeded credentials for role exploration | Backend development session + labelled sign-in panel |
| Admin-only pages disappeared briefly after a portal switch | Not an application defect in the final state; the audit now waits for the sidebar role to update before asserting navigation |
| Local D1 stopped accepting writes mid-audit (`commit token`) | Backed up `.wrangler/state/v3/d1`, restarted, reseeded; no application change required |

No route-level dead ends remain in the tested matrix. Mutating admin dialogs were opened and inspected but not submitted in the browser; their endpoints are covered by the live API suite and automated tests (see `docs/API_AUDIT.md`).

---

## 5. Coverage gaps and limitations

1. Staff status changes were verified through the API (`PATCH /complaints/:id/status`), not by clicking every action button in the case drawer.
2. `Add user` / `Add institution` dialogs were opened and validated visually, but form submission was not performed in the browser to avoid mutating the shared local dataset beyond the deliberate complaint test.
3. Institution creation and user provisioning endpoints were exercised by automated tests, not by a browser submit.
4. Google OAuth redirect/callback was not exercised (no credentials).
5. Keyboard operation relies on native controls; a full tab-order and screen-reader script was not part of this run.
6. Browser assertions are DOM/route/network based, not pixel comparisons.
