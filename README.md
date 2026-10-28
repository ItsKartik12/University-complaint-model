# AICTE Complaint Intelligence & Coordination System (ACICS)

A role-scoped demonstration prototype for complaint intake, complaint processing, institution profiles, case history, deadline monitoring, cross-bureau overlap review, and management metrics. The workspace began from the CRM starter and its account/file integrations were replaced in the main application experience with ACICS workflows.

**All preloaded records and demo people are synthetic. This project does not connect to AICTE systems or establish any official policy, category, deadline, or adjudication.**

## Run locally

Requirements: Bun 1.4+ and Node.js 20.19+ (Vite 8 runtime).

```sh
bun install
bun run dev        # Vite + local Wrangler/Miniflare bindings
bun run typecheck
bun run build      # public static assets and Worker bundle
```

First API request creates the ACICS D1 tables and seeds 10 fictional institutions, 22 complaints, three bureaus, six demo identities, case history, notifications, and sample overlap alerts. The seed is guarded by the presence of users and uses stable IDs/unique keys, so it does not duplicate on subsequent requests. The inherited CRM database tables may also be initialized but are not used by the ACICS app.

### Local demo accounts

The local sign-in chooser offers these accounts, with no passwords because these are local-only synthetic identities:

- Complainant: `ananya.demo@example.test` (Ananya Rao)
- Complainant: `rohan.demo@example.test` (Rohan Das)
- Official: `kavita.official@example.test` (Kavita Menon)
- Admin: `devika.admin@example.test` (Devika Sharma)
- Bureau officer — PGRC: `amit.pgrc@example.test` (Amit Kulkarni)
- Bureau officer — Regulation Bureau: `neha.rb@example.test` (Neha Iyer)

Demo identity selection is restricted to loopback development without `FREEBUFF_CLIENT_ID`. It uses an HttpOnly, same-site development cookie; it is not production authentication.

## Persistence / environment

The app uses the existing Cloudflare Worker, Hono API, and D1 binding `DB`. Local D1/R2 config is in `wrangler.jsonc`; local state is maintained by the Vite Cloudflare plugin's Miniflare setup. The frontend makes same-origin requests to `/api/acics/*`.

Relevant deployment variables (provided by Freebuff Sites auth when configured):

- `FREEBUFF_CLIENT_ID`
- `FREEBUFF_ISSUER`
- `APP_ORIGIN`

For a Sites deployment, create/attach D1 as `DB`, enable Sign in with Freebuff, then build/deploy using the repository's `deploy.json`. Production uses authenticated Freebuff identity and must provision users and roles in `acics_users` using a secure admin-controlled process before non-demo users can access staff experiences. Do not set an account role from a browser-supplied value.

## Working flows included

- Complainant: database-backed dashboard, own-case list/search/filter/pagination, validated multi-step complaint form, generated reference number, details, public timeline, in-app notifications and case response.
- Official: assigned-case view, controlled server-side status transitions, internal/public remarks, status history and deadlines.
- Bureau: bureau-scoped queue and institution profiles; cross-bureau candidate comparison with matching reasons and human review. Reviewing an alert is audited for both linked cases and never merges records or alters the other case's status.
- Admin: system metrics, user and institution counts, and read-only audit history.
- Shared: D1-backed status analytics, deadline indicators, notification read state, input validation, same-origin mutation checks, private/no-store responses, record-level authorization, and role-specific navigation.

## Prototype limitations

- No Python/FastAPI Sentence Transformers semantic service is included. Matching is rule-based only: exact synthetic institution ID is required, with category and lexical token overlap contributing an illustrative score. Scores require human review; no automated merging occurs.
- The UI allows selecting a local attachment but intentionally does **not** upload it. A secure case-evidence storage and access policy must be implemented before handling documents.
- The default 30-day due date is illustrative, not an AICTE deadline. There is no scheduled deadline worker, deadline-extension workflow, or delivery service for reminders yet.
- Admin user management, bureau/category configuration, institution imports/edits, and privileged account recovery are not implemented. `/api/acics/admin/users` is a protected read-only user listing. Role provisioning is not exposed through demo controls.
- No MongoDB, Express, Vercel, or external AICTE integration is used; this workspace uses D1/Workers as a compatible existing-project alternative. Database rows are persistent for the bound D1 environment.
- No tests existed in the starter. Type checking and production bundle build are the available focused checks.

## Project map

- `src/app/pages/Acics.tsx` — all ACICS role experiences and UI workflows.
- `src/worker/acics.ts` — ACICS D1 schema/seed and role-checked REST endpoints.
- `src/worker/auth.ts`, `src/worker/index.ts` — authenticated request handling and loopback-only local demo identity.
- `src/styles.css` — shared institutional palette and UI tokens.
- `wrangler.jsonc`, `deploy.json` — local/deployment Worker configuration.

## API surface

All ACICS data routes are under `/api/acics/` and require authentication, D1, and same-origin mutations. Implemented routes include `/me`, `/categories`, `/complaints`, `/complaints/:id`, `/complaints/:id/status`, `/complaints/:id/actions`, `/institutions`, `/institutions/:id`, `/overlaps`, `/overlaps/:id/review`, `/analytics`, `/notifications`, `/notifications/:id/read`, `/admin/users`, and `/admin/audit-logs`. Error responses use status codes and safe messages. The local demo login endpoints are `/api/acics/demo-login` and `/api/acics/demo-logout`, and reject non-loopback/real-auth environments.

This is a hackathon prototype, not a production complaint-handling system. A security/privacy review, official policy approval, real identity onboarding, document controls, semantic model evaluation, full configuration/admin workflows, deadline scheduler, and automated integration tests are required before real institutional use.
