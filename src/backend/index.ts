import { Hono } from 'hono'

import { authMode, currentUser, getAuth, requireUser } from './auth'
import {
  accountSummary,
  canAccessPortal,
  COMPLAINANT_DESIGNATIONS,
  isPortalKey,
  loadAccount,
  PORTAL_KEYS,
  PORTALS,
  readPortalHeader,
} from './auth/authorization'
import type { PortalKey } from './auth/authorization'
import { hashPassword, verifyPassword, verifySessionToken } from './auth/crypto'
import { isGoogleConfigured, googleAuthProvider } from './auth/providers/google'
import { mockAuthProvider } from './auth/providers/mock'
import { clearSessionCookies, cookiesOf, isSecureRequest, issueSession, sessionSecret } from './auth/session'
import { requireDb } from './database/connection'
import type { AppContext, Env } from './types'
import { activities } from './routes/legacy/activities'
import { companies } from './routes/legacy/companies'
import { contacts } from './routes/legacy/contacts'
import { deals } from './routes/legacy/deals'
import { files } from './routes/legacy/files'
import { tasks } from './routes/legacy/tasks'
import { workspace } from './routes/legacy/workspace'
import { acics, DEMO_USERS, ensureAcics, ensureBootstrapAdmin, isSyntheticIdentity } from './routes/acics'

const app = new Hono<AppContext>()

// First-administrator bootstrap, driven by environment variables rather than a
// registration endpoint. No-op unless ACICS_BOOTSTRAP_ADMIN_* is configured.
app.use('/api/*', async (c, next) => {
  if (c.env.DB && (c.env.ACICS_BOOTSTRAP_ADMIN_EMAIL || c.env.ACICS_BOOTSTRAP_ADMIN_PASSWORD)) {
    await ensureBootstrapAdmin(c.env, c.env.DB)
  }
  await next()
})

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

// Public: lets the app know how to sign in before any private call.
app.get('/api/auth/status', (c) => {
  const mode = authMode(c.env, c.req.raw)
  const dev = mode === 'development' || mode === 'mock'
  c.header('Cache-Control', 'private, no-store')
  return c.json({
    mode,
    database: Boolean(c.env.DB),
    files: Boolean(c.env.FILES),
    googleConfigured: isGoogleConfigured(c.env),
    devAuthEnabled: dev,
    appEnv: c.env.APP_ENV ?? 'development',
    portals: PORTAL_KEYS.map((key) => ({ key, ...PORTALS[key] })),
    // Clearly-labelled synthetic identities, loopback development only.
    demoAccounts: dev ? DEMO_USERS.map(({ sub, name, email, roles }) => ({ sub, name, email, roles })) : [],
  })
})

app.get('/api/health', async (c) => {
  let dbOk = false
  if (c.env.DB) {
    try {
      await c.env.DB.prepare('SELECT 1').first()
      dbOk = true
    } catch {
      dbOk = false
    }
  }
  return c.json({ ok: true, database: dbOk })
})

app.get('/api/acics/health', (c) => c.json({ ok: true, status: 'operational' }))

const handleLogin = async (c: any) => {
  const db = c.env.DB
  if (!db) return c.json({ error: 'Database service unavailable.' }, 503)
  await ensureAcics(db, c.env)

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const portal: PortalKey | null = body.portal === undefined || body.portal === null ? null : isPortalKey(body.portal) ? body.portal : null

  if (!email || !password) {
    return c.json({ error: 'Email and password are required.' }, 400)
  }
  if (body.portal !== undefined && body.portal !== null && !portal) {
    return c.json({ error: 'The requested portal is not recognised.' }, 400)
  }

  const user = (await db
    .prepare('SELECT sub, full_name, email, role, bureau_id, password_hash, password_salt, failed_attempts, locked_until, active, account_status FROM acics_users WHERE lower(email) = ?')
    .bind(email)
    .first()) as any

  if (!user) {
    return c.json({ error: 'Invalid email or password.' }, 401)
  }

  // Synthetic demo identities are a development aid. Even if a database was
  // seeded before this rule existed, they can never sign in to production.
  if ((c.env.APP_ENV || '').toLowerCase() === 'production' && isSyntheticIdentity(user.sub)) {
    return c.json({ error: 'Invalid email or password.' }, 401)
  }

  if (user.locked_until && user.locked_until > Date.now()) {
    const minutesRemaining = Math.max(1, Math.ceil((user.locked_until - Date.now()) / 60000))
    return c.json({ error: `Account temporarily locked due to repeated failed attempts. Please try again in ${minutesRemaining} minute(s).` }, 429)
  }

  const isValid = await verifyPassword(password, user.password_hash, user.password_salt)
  if (!isValid) {
    const failedAttempts = (user.failed_attempts || 0) + 1
    const lockUntil = failedAttempts >= 5 ? Date.now() + 15 * 60 * 1000 : null
    await db
      .prepare('UPDATE acics_users SET failed_attempts = ?, locked_until = ? WHERE sub = ?')
      .bind(failedAttempts, lockUntil, user.sub)
      .run()

    if (failedAttempts >= 5) {
      return c.json({ error: 'Account temporarily locked due to repeated failed attempts. Please try again in 15 minutes.' }, 429)
    }
    return c.json({ error: 'Invalid email or password.' }, 401)
  }

  // Reset lock and failed attempts on successful authentication
  await db
    .prepare('UPDATE acics_users SET failed_attempts = 0, locked_until = NULL WHERE sub = ?')
    .bind(user.sub)
    .run()

  const account = await loadAccount(db, user.sub)
  if (!account) {
    return c.json({ error: 'No ACICS account is linked to this identity.', code: 'ACCOUNT_NOT_PROVISIONED' }, 403)
  }

  // Authentication proves identity. It does not grant portal access.
  if (account.accountStatus !== 'ACTIVE') {
    const code = `ACCOUNT_${account.accountStatus}`
    const message =
      account.accountStatus === 'PENDING_APPROVAL'
        ? 'Your account request is awaiting approval by an ACICS administrator.'
        : account.accountStatus === 'PENDING_VERIFICATION'
          ? 'Your account is awaiting identity verification by an ACICS administrator.'
          : account.accountStatus === 'SUSPENDED'
            ? 'This account has been suspended. Contact your ACICS administrator if you believe this is an error.'
            : 'This account request was not approved. Contact your ACICS administrator for assistance.'
    return c.json({ error: message, code, accountStatus: account.accountStatus, roles: account.roles }, 403)
  }

  const decision = portal ? canAccessPortal(account, portal) : null
  const sessionIssued = await issueSession(c, db, user.sub)
  if (!sessionIssued) {
    return c.json({ error: 'Server session configuration is incomplete. Set SESSION_SECRET before signing in.', code: 'SESSION_CONFIG_MISSING' }, 500)
  }

  return c.json({
    ok: true,
    user: { sub: account.sub, name: account.fullName, email: account.email, role: account.primaryRole },
    role: account.primaryRole,
    roles: account.roles,
    accountStatus: account.accountStatus,
    bureau: account.bureauId ? { id: account.bureauId, code: account.bureauCode, name: account.bureauName } : null,
    portal,
    access: decision,
    demo: false,
  })
}

const handleLogout = async (c: any) => {
  const token = cookiesOf(c.req.raw)['acics_session']
  if (token && c.env.DB) {
    const secret = sessionSecret(c.env)
    const verified = secret ? await verifySessionToken(token, secret) : null
    if (verified) {
      await c.env.DB.prepare('DELETE FROM acics_sessions WHERE id = ?').bind(verified.sessionId).run().catch(() => {})
    }
  }
  clearSessionCookies(c)
  return c.json({ ok: true })
}

app.post('/api/auth/login', handleLogin)
app.post('/api/acics/login', handleLogin)
app.post('/api/auth/logout', handleLogout)
app.post('/api/acics/logout', handleLogout)

app.get('/api/auth/me', async (c) => {
  const db = c.env.DB
  if (!db) return c.json({ error: 'Database service unavailable.' }, 503)
  await ensureAcics(db, c.env)
  const user = await currentUser(c.env, c.req.raw, db)
  if (!user) return c.json({ error: 'Sign in required.' }, 401)

  const account = await loadAccount(db, user.sub)
  if (!account) {
    return c.json({ error: 'No ACICS account is linked to this identity.', code: 'ACCOUNT_NOT_PROVISIONED' }, 403)
  }
  if (account.accountStatus !== 'ACTIVE') {
    return c.json({ error: `Account status: ${account.accountStatus.toLowerCase().replaceAll('_', ' ')}.`, code: `ACCOUNT_${account.accountStatus}` }, 403)
  }

  const requested = readPortalHeader(c.req.raw)
  let role = account.primaryRole
  if (requested === 'invalid') {
    return c.json({ error: 'The requested portal is not recognised.', code: 'PORTAL_UNKNOWN' }, 400)
  }
  if (requested) {
    const decision = canAccessPortal(account, requested)
    if (!decision.allowed) {
      return c.json({ error: decision.message, code: decision.code }, 403)
    }
    role = decision.role!
  }

  c.header('Cache-Control', 'private, no-store')
  return c.json({
    authenticated: true,
    ...accountSummary(account),
    // Compatibility view for callers that read user.name/user.email.
    user: { sub: account.sub, name: account.fullName, email: account.email, role },
    role,
    activePortal: requested ?? null,
  })
})

app.post('/api/auth/portal-access', requireDb, requireUser, async (c) => {
  const db = c.get('db')
  await ensureAcics(db, c.env)
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'A valid JSON request is required.' }, 400)
  }
  if (!isPortalKey(body.portal)) {
    return c.json({ error: 'The requested portal is not recognised.', code: 'PORTAL_UNKNOWN' }, 400)
  }
  const account = await loadAccount(db, c.get('user').sub)
  if (!account) {
    return c.json({ error: 'No ACICS account is linked to this identity.', code: 'ACCOUNT_NOT_PROVISIONED' }, 403)
  }
  const decision = canAccessPortal(account, body.portal)
  c.header('Cache-Control', 'private, no-store')
  if (!decision.allowed) {
    return c.json(
      {
        allowed: false,
        code: decision.code,
        error: decision.message,
        accountStatus: account.accountStatus,
        roles: account.roles,
        portal: body.portal,
      },
      403,
    )
  }
  return c.json({
    allowed: true,
    code: 'ALLOWED',
    portal: body.portal,
    role: decision.role,
    account: accountSummary(account),
    bureau: accountSummary(account).bureau,
  })
})

app.get('/api/auth/onboarding/options', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Database service unavailable.' }, 503)
  await ensureAcics(c.env.DB, c.env)
  const institutions = await c.env.DB
    .prepare(`SELECT official_id AS officialId, name, state FROM acics_institutions WHERE active=1 ORDER BY name LIMIT 200`)
    .all<any>()
  c.header('Cache-Control', 'private, no-store')
  return c.json({
    designations: COMPLAINANT_DESIGNATIONS,
    institutions: institutions.results,
    requestedPortal: 'complainant',
    googleConfigured: isGoogleConfigured(c.env),
    devAuthEnabled: (m => m === 'development' || m === 'mock')(authMode(c.env, c.req.raw)),
  })
})

app.post('/api/auth/account-request', requireDb, async (c) => {
  const db = c.get('db')
  await ensureAcics(db, c.env)
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'A valid JSON request is required.' }, 400)
  }

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 160) : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const designation = typeof body.designation === 'string' ? body.designation.trim().slice(0, 120) : ''
  const institutionId = typeof body.institutionOfficialId === 'string' ? body.institutionOfficialId.trim().slice(0, 64) : ''
  const requestedPortal = body.requestedPortal ?? 'complainant'

  // Privileged portals can only be granted by an administrator through provisioning.
  if (requestedPortal !== 'complainant') {
    return c.json(
      { error: 'Only Complainant Portal access can be requested through this form. Administrator, Official, and Bureau roles are assigned by an authorised administrator.', code: 'PRIVILEGED_PORTAL_DENIED' },
      403,
    )
  }
  if (body.role !== undefined && body.role !== 'COMPLAINANT') {
    return c.json({ error: 'You cannot self-assign a portal role.', code: 'PRIVILEGED_ROLE_DENIED' }, 403)
  }
  if (fullName.length < 2 || !email.includes('@') || password.length < 12) {
    return c.json({ error: 'Provide a full name, a valid email address, and a password of at least 12 characters.' }, 400)
  }
  if (!(COMPLAINANT_DESIGNATIONS as readonly string[]).includes(designation)) {
    return c.json({ error: 'Select your designation from the listed eligible categories.' }, 400)
  }

  const institution = await db
    .prepare(`SELECT id FROM acics_institutions WHERE official_id=? AND active=1`)
    .bind(institutionId)
    .first<any>()
  if (!institution) {
    return c.json({ error: 'Select a listed institution. Institution identifiers are verified during administrator review.' }, 400)
  }

  const existing = await db.prepare(`SELECT sub FROM acics_users WHERE lower(email)=?`).bind(email).first<any>()
  if (existing) {
    return c.json({ error: 'An ACICS account already exists for this email address. Sign in or contact your administrator.' }, 409)
  }

  const now = Date.now()
  const sub = `request-${crypto.randomUUID()}`
  const creds = await hashPassword(password)
  await db
    .prepare(
      `INSERT INTO acics_users (sub,full_name,email,role,bureau_id,password_hash,password_salt,failed_attempts,locked_until,active,account_status,designation,institution_id,requested_role,created_at,updated_at)
       VALUES (?,?,?,'',NULL,?,?,0,NULL,1,'PENDING_APPROVAL',?,?,'COMPLAINANT',?,?)`,
    )
    .bind(sub, fullName, email, creds.hash, creds.salt, designation, institution.id, now, now)
    .run()
  await db
    .prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), 'SYSTEM', sub, 'USER_ACCESS_REQUESTED', 'COMPLAINANT', `Access request from ${fullName} (${email}), designation ${designation}`, 'INTERNAL', now)
    .run()

  return c.json(
    {
      ok: true,
      status: 'PENDING_APPROVAL',
      message: 'Your request has been recorded. An ACICS administrator must verify your designation and institution before Complainant Portal access is granted.',
    },
    201,
  )
})

app.post('/api/auth/forgot-password', async (c) => {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON payload.' }, 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !email.includes('@')) {
    return c.json({ error: 'Please enter a valid institutional or personal email address.' }, 400)
  }
  return c.json({
    ok: true,
    message: 'If an active account is registered with this email, password recovery guidance has been queued. Institutional and Bureau officers may also contact your AICTE portal administrator directly.',
  })
})

app.get('/api/auth/google', (c) => {
  if (!isGoogleConfigured(c.env)) {
    c.header('Cache-Control', 'private, no-store')
    return c.json(
      {
        error: 'google_oauth_not_configured',
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google OAuth is not configured on this ACICS instance. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL in your environment variables. Local development accounts are documented in the README.',
        requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
      },
      501,
    )
  }

  const portal = c.req.query('portal') ?? 'complainant'
  if (!isPortalKey(portal)) {
    return c.json({ error: 'The requested portal is not recognised.', code: 'PORTAL_UNKNOWN' }, 400)
  }
  const { url, state, nonce } = googleAuthProvider.buildAuthorizationUrl(c.env, c.req.raw, portal)
  const secure = isSecureRequest(c.req.raw) ? '; Secure' : ''
  c.header('Set-Cookie', `acics_oauth_state=${encodeURIComponent(`${state}.${nonce}.${portal}`)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`)
  return c.redirect(url.toString(), 302)
})

app.get('/api/auth/google/callback', async (c) => {
  const db = c.env.DB
  if (!isGoogleConfigured(c.env) || !db) {
    return c.json({ error: 'google_oauth_not_configured', code: 'GOOGLE_NOT_CONFIGURED', message: 'Google OAuth callback cannot proceed: missing Google credentials.' }, 501)
  }
  await ensureAcics(db, c.env)

  const code = c.req.query('code')
  const state = c.req.query('state') || ''
  const cookieState = cookiesOf(c.req.raw)['acics_oauth_state'] || ''
  const [expectedState, , portalRaw] = cookieState.split('.')
  const portal: PortalKey = isPortalKey(portalRaw) ? portalRaw : 'complainant'
  const secure = isSecureRequest(c.req.raw) ? '; Secure' : ''
  c.header('Set-Cookie', `acics_oauth_state=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)

  if (!code || !expectedState || state !== expectedState) {
    return c.json({ error: 'invalid_oauth_state', message: 'The sign-in attempt could not be verified. Start again from the portal sign-in page.' }, 400)
  }

  const callbackUrl = c.env.GOOGLE_CALLBACK_URL || `${new URL(c.req.url).origin}/api/auth/google/callback`
  const identity = await googleAuthProvider.exchangeCode(c.env, code, callbackUrl)
  if ('error' in identity) {
    return c.json({ error: identity.error, message: 'Google sign-in could not be verified. No session was created.' }, 401)
  }

  const linked = await db.prepare(`SELECT sub FROM acics_users WHERE google_sub=?`).bind(identity.sub).first<any>()
  const home = new URL('/', new URL(c.req.url).origin)

  if (!linked) {
    // Never link by email string alone: an existing ACICS account must be
    // associated deliberately (administrator invitation or account linking).
    const byEmail = await db.prepare(`SELECT sub FROM acics_users WHERE lower(email)=?`).bind(identity.email).first<any>()
    if (byEmail) {
      home.searchParams.set('auth', 'account_exists')
      return c.redirect(home.toString(), 302)
    }
    const now = Date.now()
    const sub = `google-${crypto.randomUUID()}`
    await db.prepare(
      `INSERT INTO acics_users (sub,full_name,email,role,bureau_id,google_sub,failed_attempts,locked_until,active,account_status,requested_role,created_at,updated_at)
       VALUES (?,?,?,'',NULL,?,0,NULL,1,'PENDING_VERIFICATION','COMPLAINANT',?,?)`,
    ).bind(sub, identity.name, identity.email, identity.sub, now, now).run()
    await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), 'SYSTEM', sub, 'USER_GOOGLE_REQUEST', 'COMPLAINANT', `Google identity ${identity.email} awaiting administrator verification`, 'INTERNAL', now)
      .run()
    home.searchParams.set('auth', 'pending')
    home.searchParams.set('portal', portal)
    return c.redirect(home.toString(), 302)
  }

  const account = await loadAccount(db, linked.sub)
  const decision = account ? canAccessPortal(account, portal) : null
  if (!account || !decision?.allowed) {
    home.searchParams.set('auth', 'denied')
    home.searchParams.set('code', decision?.code ?? 'ACCOUNT_NOT_PROVISIONED')
    home.searchParams.set('portal', portal)
    return c.redirect(home.toString(), 302)
  }
  if (!(await issueSession(c, db, account.sub))) {
    return c.json({ error: 'Server session configuration is incomplete. Set SESSION_SECRET.', code: 'SESSION_CONFIG_MISSING' }, 500)
  }
  home.searchParams.set('portal', portal)
  home.searchParams.set('signed_in', '1')
  return c.redirect(home.toString(), 302)
})

// Local development loopback test endpoints (used by test suites and the
// documented development workflow). Never available once OAuth is configured.
app.post('/api/acics/demo-login', async (c) => {
  if (
    c.env.FREEBUFF_CLIENT_ID ||
    isGoogleConfigured(c.env) ||
    (c.env.APP_ENV || '').toLowerCase() === 'production' ||
    !LOOPBACK_HOSTS.includes(new URL(c.req.url).hostname)
  ) {
    return c.json({ error: 'Demo identities are available only on a local development origin.' }, 403)
  }
  const input: { sub?: string } = await c.req.json<{ sub?: string }>().catch(() => ({}))
  const account = DEMO_USERS.find((candidate) => candidate.sub === input.sub && candidate.sub.startsWith('demo-'))
  if (!account) return c.json({ error: 'Choose one of the listed synthetic demo accounts.' }, 400)
  const isSecure = isSecureRequest(c.req.raw)
  c.header('Set-Cookie', `acics_demo=${encodeURIComponent(account.sub)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${isSecure ? '; Secure' : ''}`)
  return c.json({ ok: true })
})
app.post('/api/acics/demo-logout', (c) => {
  if (!LOOPBACK_HOSTS.includes(new URL(c.req.url).hostname)) return c.json({ error: 'Demo sign-out is available only on a local development origin.' }, 403)
  clearSessionCookies(c)
  return c.json({ ok: true })
})

// Development access: a clearly-labelled synthetic session for local UI work.
// Delegated to MockAuthProvider, which refuses production, identity-provider
// and non-loopback origins. The synthetic account holds all four roles so every
// portal can be explored without an approval workflow.
app.post('/api/auth/dev-session', async (c) => {
  const mode = authMode(c.env, c.req.raw)
  if (!mockAuthProvider.isEnabled(c.env, c.req.raw) || (mode !== 'development' && mode !== 'mock')) {
    return c.json(
      {
        error: 'Local development access is disabled on this instance. Use the configured identity provider or run the app on a loopback development origin with APP_ENV=development.',
        code: 'DEV_AUTH_DISABLED',
      },
      403,
    )
  }
  const db = c.env.DB
  if (!db) return c.json({ error: 'Database service unavailable.' }, 503)
  await ensureAcics(db, c.env)

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'A valid JSON request is required.', code: 'DEV_INVALID_PAYLOAD' }, 400)
  }
  return mockAuthProvider.signIn(c, db, body)
})

// Development-only seed helper used by `bun run seed`. ensureAcics() only
// inserts missing rows, so repeated runs never delete or rewrite live records.
app.post('/api/dev/seed', async (c) => {
  const mode = authMode(c.env, c.req.raw)
  if (mode !== 'development' && mode !== 'mock') {
    return c.json(
      { error: 'Development seeding is disabled on this instance.', code: 'DEV_SEED_DISABLED' },
      403,
    )
  }
  const db = c.env.DB
  if (!db) return c.json({ error: 'Database service unavailable.', code: 'DB_UNAVAILABLE' }, 503)
  await ensureAcics(db, c.env)
  const [complaints, users, institutions] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS total FROM acics_complaints').first<{ total: number }>(),
    db.prepare('SELECT COUNT(*) AS total FROM acics_users').first<{ total: number }>(),
    db.prepare('SELECT COUNT(*) AS total FROM acics_institutions').first<{ total: number }>(),
  ])
  c.header('Cache-Control', 'private, no-store')
  return c.json({
    ok: true,
    label: 'LOCAL DEVELOPMENT MODE',
    message: 'Synthetic dataset ensured. Existing records were preserved.',
    counts: {
      complaints: complaints?.total ?? 0,
      users: users?.total ?? 0,
      institutions: institutions?.total ?? 0,
    },
  })
})

const api = new Hono<AppContext>()
api.use('*', requireDb, requireUser, async (c, next) => {
  await ensureAcics(c.get('db'), c.env)
  await next()
})
api.route('/acics', acics)
api.route('/', workspace)
api.route('/contacts', contacts)
api.route('/companies', companies)
api.route('/deals', deals)
api.route('/tasks', tasks)
api.route('/activities', activities)
api.route('/files', files)
app.route('/api', api)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Something went wrong.' }, 500)
})

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)))

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Sign in with Freebuff owns /auth/freebuff/* and keeps sessions fresh. It
    // wraps the whole app once per isolate; without a client ID the app falls
    // back to the loopback development user (see auth.ts).
    const auth = getAuth(env, request)
    const handler = (req: Request) => Promise.resolve(app.fetch(req, env, ctx))
    return auth ? auth.wrap(handler)(request) : handler(request)
  },
}
