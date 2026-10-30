import { accountSummary, canAccessPortal, isPortalKey, loadAccount } from '../authorization'
import type { PortalKey } from '../authorization'
import { issueSession } from '../session'
import type { Env } from '../../types'

export const MOCK_PROVIDER_NAME = 'MockAuthProvider'

export interface MockAuthRequest {
  identifier?: string
  displayName?: string
  portal?: unknown
}

export interface MockAuthResult {
  ok: true
  development: true
  label: 'LOCAL DEVELOPMENT MODE'
  message: string
  portal: PortalKey | null
  access: ReturnType<typeof canAccessPortal> | null
  account: ReturnType<typeof accountSummary> | null
}

/** Simulated development identity provider. Never valid in production. */
export class MockAuthProvider {
  readonly name = MOCK_PROVIDER_NAME

  isEnabled(env: Env, request: Request): boolean {
    const mode = env.AUTH_MODE?.toLowerCase()
    if ((env.APP_ENV || '').toLowerCase() === 'production') return false
    if (env.FREEBUFF_CLIENT_ID) return false
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
    if (!loopback) return false
    // Explicit mock mode or the default loopback development mode both allow exploration.
    return mode === 'mock' || mode === 'development' || mode === undefined || mode === ''
  }

  async signIn(c: any, db: D1Database, body: MockAuthRequest): Promise<Response> {
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim().slice(0, 160) : ''
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 120) : ''
    const portal: PortalKey | null = isPortalKey(body.portal) ? body.portal : null

    if (!identifier) {
      return c.json({ error: 'Enter a user ID or email address to continue.', code: 'DEV_ID_REQUIRED' }, 400)
    }
    if (body.portal !== undefined && body.portal !== null && !portal) {
      return c.json({ error: 'The requested portal is not recognised.', code: 'PORTAL_UNKNOWN' }, 400)
    }

    const slug = identifier
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    let hash = 0x811c9dc5
    for (const char of identifier.toLowerCase()) {
      hash ^= char.codePointAt(0)!
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    const suffix = hash.toString(16).padStart(8, '0')
    const sub = `dev-${slug ? `${slug}-` : ''}${suffix}`
    const name = displayName || identifier

    await db
      .prepare(`INSERT OR IGNORE INTO acics_bureaus (id,code,name,permitted_categories,created_at) VALUES (?,?,?,?,?)`)
      .bind('bureau-pgrc', 'PGRC', 'Public Grievance Redressal Cell', '[]', Date.now())
      .run()
    const institution = await db.prepare(`SELECT id FROM acics_institutions WHERE active=1 ORDER BY id LIMIT 1`).first<any>()

    let email = identifier.includes('@') ? identifier.toLowerCase() : `${slug || 'dev'}.${suffix}@dev.local`
    const clash = await db.prepare(`SELECT sub FROM acics_users WHERE lower(email)=?`).bind(email).first<any>()
    if (clash && clash.sub !== sub) email = `${slug || 'dev'}.${suffix}@dev.local`

    const now = Date.now()
    await db
      .prepare(
        `INSERT INTO acics_users (sub,full_name,email,role,bureau_id,failed_attempts,locked_until,active,account_status,designation,institution_id,created_at,updated_at)
         VALUES (?,?,?,'ADMIN','bureau-pgrc',0,NULL,1,'ACTIVE','Development Access',?,?,?)
         ON CONFLICT(sub) DO UPDATE SET full_name=excluded.full_name, email=excluded.email, active=1, account_status='ACTIVE', bureau_id='bureau-pgrc', institution_id=excluded.institution_id, updated_at=excluded.updated_at`,
      )
      .bind(sub, name, email, institution?.id ?? null, now, now)
      .run()
    for (const role of ['COMPLAINANT', 'OFFICIAL', 'ADMIN', 'BUREAU_OFFICER']) {
      await db
        .prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub,role,granted_by,granted_at) VALUES (?,?,?,?)`)
        .bind(sub, role, 'development', now)
        .run()
    }
    await db
      .prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), 'SYSTEM', sub, 'DEV_SESSION_ISSUED', portal ?? 'all', `Development session for ${identifier}`, 'INTERNAL', now)
      .run()

    if (!(await issueSession(c, db, sub))) {
      return c.json({ error: 'Server session configuration is incomplete. Set SESSION_SECRET.', code: 'SESSION_CONFIG_MISSING' }, 500)
    }

    const account = await loadAccount(db, sub)
    const decision = account && portal ? canAccessPortal(account, portal) : null
    c.header('Cache-Control', 'private, no-store')
    return c.json({
      ok: true,
      development: true,
      label: 'LOCAL DEVELOPMENT MODE',
      message: 'Synthetic development session. This is not a verified or production identity.',
      portal: portal ?? null,
      access: decision,
      account: account ? accountSummary(account) : null,
    })
  }
}

export const mockAuthProvider = new MockAuthProvider()
