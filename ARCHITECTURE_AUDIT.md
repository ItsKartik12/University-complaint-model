# ACICS — Full-Stack Architecture Audit & Separation Specification

**Project:** AICTE Complaint Intelligence and Coordination System (SIH26264)  
**Date:** 2026-10-28  
**Architecture Model:** Cloudflare Unified Full-Stack (React SPA + Cloudflare Worker + D1 SQLite)

---

## 1. Runtime Architecture

The ACICS repository uses a **Cloudflare Workers unified full-stack architecture** powered by `@cloudflare/vite-plugin` and Hono:

1. **Development Environment:**
   - Single dev server started via `bun run dev` (Vite 8 + `@cloudflare/vite-plugin` + Miniflare).
   - Port `5173` hosts both the React single-page application and the Cloudflare Worker.
   - Vite routes frontend asset requests (`/`, `/index.html`, `*.tsx`, etc.) to the React client.
   - API requests (`/api/*`) are dispatched directly into the Hono Worker in Miniflare.

2. **Database Binding:**
   - **Engine:** Cloudflare D1 (SQLite distributed database).
   - **Access Pattern:** Injected via the `DB` worker environment binding (`c.env.DB`).
   - **Crucial Architectural Constraint:** Cloudflare D1 is an internal runtime binding, **not** an external TCP/network-addressable database URL. Therefore, splitting the Worker into a standalone external Node/Bun server on a different port without Cloudflare runtime proxies would disconnect D1. The unified worker architecture preserves native D1 transactions, speed, and edge distribution.

3. **Production Deployment:**
   - Built via `bun run build` (`vite build && node scripts/postbuild.mjs`).
   - Worker + static assets are bundled into `.wrangler/dist` and deployed to Cloudflare via `wrangler deploy`.

---

## 2. Directory Structure & Layer Separation

```
src/
├── app/                      # Frontend Presentation Layer
│   ├── components/           # Reusable UI primitives (Button, Card, Drawer, etc.)
│   ├── lib/
│   │   └── api.ts            # Typed HTTP client (configurable VITE_API_BASE_URL)
│   ├── pages/
│   │   ├── Acics.tsx         # ACICS 4-Portal Interface
│   │   └── [legacy pages]   # CRM demonstration pages (isolated)
│   ├── App.tsx               # Root application router
│   ├── index.css             # Tailwind CSS tokens & styling
│   └── main.tsx              # React DOM bootstrap
├── shared/                   # Shared Domain Contracts
│   └── types.ts              # Shared TypeScript interfaces (Roles, Cases, Alerts, Users)
└── worker/                   # Backend API Layer (Cloudflare Worker)
    ├── index.ts              # Hono application root & global middleware
    ├── auth.ts               # Session verification (Freebuff OIDC + Local Demo Auth)
    ├── env.ts                # Environment bindings typing (DB, FILES, OIDC)
    ├── acics.ts              # ACICS Domain Logic, D1 Schema, Seed & API Routes
    └── routes/               # Legacy CRM routes
```

---

## 3. Authentication & Security Model

The system implements dual-mode authentication:

| Mode | Trigger | Session Mechanism | Role Scopes |
|---|---|---|---|
| **Production (OIDC)** | `FREEBUFF_CLIENT_ID` defined | Signed OIDC session cookies + JWT verification | Dynamic role lookup from `acics_users` |
| **Development (Demo)** | Localhost (`127.0.0.1`, `localhost`, `[::1]`) without Client ID | `acics_demo` HTTP-only, SameSite=Lax cookie | `COMPLAINANT`, `OFFICIAL`, `BUREAU_OFFICER`, `ADMIN` |
| **Remote Unconfigured** | Non-loopback request without Client ID | Disabled (Returns 403/401) | None |

### Security Measures Implemented
- **CSRF Defense:** `requireUser` verifies origin matching (`isSameOriginRequest`) for all mutation verbs (`POST`, `PATCH`, `DELETE`, `PUT`).
- **Cookie Flags:** `HttpOnly`, `SameSite=Lax`, and `Secure` (when running over HTTPS).
- **Access Control:** `canSeeCase()` enforces that complainants can only query their own complaints, while bureau officers are restricted to their jurisdiction.

---

## 4. Database Schema (D1 SQLite)

The ACICS database schema resides in `acics_` prefixed tables:

1. `acics_bureaus`: AICTE bureaus (PGRC, Regulation Bureau, Academic Coordination Cell).
2. `acics_users`: System user directory mapping subject identity to role and assigned bureau.
3. `acics_institutions`: AICTE-approved institutions with official identifier, state, district, and type.
4. `acics_complaints`: Core complaint records with SLA due dates, bureau assignment, status, and priority.
5. `acics_actions`: Immutable audit log tracking status transitions, remarks, assignments, and visibility (`PUBLIC` vs `INTERNAL`).
6. `acics_overlaps`: Cross-bureau duplication and coordinate detection alerts with confidence scores and reasoning.
7. `acics_notifications`: User notification queue.
8. `acics_attachments`: Metadata for case supporting documents.

---

## 5. Completed Fixes & Enhancements

1. **Syntax & Parse Integrity:** Removed orphaned duplicate code blocks in `src/worker/acics.ts` that caused OXC parser failures.
2. **Export Integrity:** Exported `DEMO_USERS` and role definitions required by auth handlers.
3. **API Base URL Support:** Added configurable `VITE_API_BASE_URL` in `src/app/lib/api.ts` with fallback to `/api`.
4. **Shared Types Contract:** Consolidated ACICS models into `src/shared/types.ts`.
5. **Secure Cookie Handling:** Added dynamic `Secure` cookie attribute based on request protocol.
6. **Environment Templates:** Created `.env.example` and enhanced `.dev.vars.example`.
7. **Test Automation:** Added `"test": "bun test"` in `package.json` with 35 passing integration tests.
8. **Health Check Extension:** Enhanced `/api/health` to verify live D1 connectivity and exposed `/api/acics/health`.
