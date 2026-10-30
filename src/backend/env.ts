import type { FreebuffUser } from '@freebuff/auth'

import type { AcicsAccount, AcicsRole, PortalKey } from './authorization'

export interface Env {
  ASSETS: Fetcher
  // Attached by Freebuff Sites once provisioned (sites_add_storage). Optional so
  // the app can explain what is missing instead of crashing.
  DB?: D1Database
  FILES?: R2Bucket
  // Injected on deploy once Sign in with Freebuff is enabled (sites_enable_auth).
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
  APP_ENV?: string
  SESSION_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_CALLBACK_URL?: string
  // First-administrator bootstrap. Set these on a fresh deployment only; the
  // account is created once, and only while no administrator exists.
  ACICS_BOOTSTRAP_ADMIN_EMAIL?: string
  ACICS_BOOTSTRAP_ADMIN_PASSWORD?: string
  ACICS_BOOTSTRAP_ADMIN_NAME?: string
}

export type Variables = {
  user: FreebuffUser
  db: D1Database
  /** Full ACICS account record, loaded and authorized for every /api/acics request. */
  account: AcicsAccount
  /** Effective role for this request (from the x-acics-portal header or primary role). */
  activeRole: AcicsRole
  activePortal: PortalKey | null
  /** Account view with the effective role and legacy snake_case fields used by routes. */
  profile: AcicsAccount & {
    role: AcicsRole
    bureau_id: string | null
    bureau_name: string | null
    bureau_code: string | null
    full_name: string
  }
}

export type AppContext = { Bindings: Env; Variables: Variables }
