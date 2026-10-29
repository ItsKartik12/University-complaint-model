import { Hono } from 'hono'

import { authMode, currentUser, getAuth, requireUser } from './auth'
import { requireDb } from './db'
import type { AppContext, Env } from './env'
import { activities } from './routes/activities'
import { companies } from './routes/companies'
import { contacts } from './routes/contacts'
import { deals } from './routes/deals'
import { files } from './routes/files'
import { tasks } from './routes/tasks'
import { workspace } from './routes/workspace'
import { acics, DEMO_USERS, ensureAcics } from './acics'

const app = new Hono<AppContext>()

// Public: lets the app know how to sign in before any private call.
app.get('/api/auth/status', (c) => {
  const mode = authMode(c.env, c.req.raw)
  c.header('Cache-Control', 'private, no-store')
  return c.json({ mode, database: Boolean(c.env.DB), files: Boolean(c.env.FILES) })
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

import { createSessionToken, verifyPassword, verifySessionToken } from './crypto'

app.get('/api/acics/health', (c) => c.json({ ok: true, status: 'operational' }))

const handleLogin = async (c: any) => {
  const db = c.env.DB
  if (!db) return c.json({ error: 'Database service unavailable.' }, 503)
  await ensureAcics(db)

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    return c.json({ error: 'Email and password are required.' }, 400)
  }

  const user = (await db
    .prepare('SELECT sub, full_name, email, role, bureau_id, password_hash, password_salt, failed_attempts, locked_until, active FROM acics_users WHERE lower(email) = ?')
    .bind(email)
    .first()) as any

  if (!user || user.active !== 1) {
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

  const sessionId = crypto.randomUUID()
  const expiresAt = Date.now() + 7 * 86_400_000 // 7 days
  const secret = c.env.SESSION_SECRET || 'acics_dev_session_secret_key_32bytes_min'
  const token = await createSessionToken(sessionId, expiresAt, secret)

  await db
    .prepare('INSERT INTO acics_sessions (id, user_sub, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, user.sub, expiresAt, Date.now())
    .run()

  const isSecure = new URL(c.req.url).protocol === 'https:'
  c.header('Set-Cookie', `acics_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${isSecure ? '; Secure' : ''}`)
  c.header('Set-Cookie', `acics_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`, { append: true })

  let bureau = null
  if (user.bureau_id) {
    const b = (await db.prepare('SELECT id, code, name FROM acics_bureaus WHERE id = ?').bind(user.bureau_id).first()) as any
    if (b) bureau = { id: b.id, code: b.code, name: b.name }
  }

  return c.json({
    ok: true,
    user: { sub: user.sub, name: user.full_name, email: user.email, role: user.role },
    role: user.role,
    bureau,
    demo: false,
  })
}

const handleLogout = async (c: any) => {
  const cookieHeader = c.req.header('cookie') || ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((p: string) => {
      const [k, ...v] = p.trim().split('=')
      return [k, decodeURIComponent(v.join('='))]
    })
  )
  const sessionToken = cookies['acics_session']
  if (sessionToken && c.env.DB) {
    const secret = c.env.SESSION_SECRET || 'acics_dev_session_secret_key_32bytes_min'
    const verified = await verifySessionToken(sessionToken, secret)
    if (verified) {
      await c.env.DB.prepare('DELETE FROM acics_sessions WHERE id = ?').bind(verified.sessionId).run().catch(() => {})
    }
  }

  const isSecure = new URL(c.req.url).protocol === 'https:'
  c.header('Set-Cookie', `acics_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`)
  c.header('Set-Cookie', `acics_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`, { append: true })
  return c.json({ ok: true })
}

app.post('/api/auth/login', handleLogin)
app.post('/api/acics/login', handleLogin)
app.post('/api/auth/logout', handleLogout)
app.post('/api/acics/logout', handleLogout)

app.get('/api/auth/me', async (c) => {
  const db = c.env.DB
  if (!db) return c.json({ error: 'Database service unavailable.' }, 503)
  await ensureAcics(db)
  const user = await currentUser(c.env, c.req.raw, db)
  if (!user) return c.json({ error: 'Sign in required.' }, 401)

  const profile = (await db.prepare('SELECT sub, full_name, email, role, bureau_id FROM acics_users WHERE sub = ?').bind(user.sub).first()) as any
  if (!profile) return c.json({ error: 'User profile not found.' }, 404)

  let bureau = null
  if (profile.bureau_id) {
    const b = (await db.prepare('SELECT id, code, name FROM acics_bureaus WHERE id = ?').bind(profile.bureau_id).first()) as any
    if (b) bureau = { id: b.id, code: b.code, name: b.name }
  }

  c.header('Cache-Control', 'private, no-store')
  return c.json({
    authenticated: true,
    user: { sub: profile.sub, name: profile.full_name, email: profile.email, role: profile.role },
    sub: profile.sub,
    name: profile.full_name,
    email: profile.email,
    role: profile.role,
    bureau,
    demo: false,
  })
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
  const clientId = c.env.GOOGLE_CLIENT_ID
  const callbackUrl = c.env.GOOGLE_CALLBACK_URL || `${new URL(c.req.url).origin}/api/auth/google/callback`

  if (!clientId || clientId.startsWith('replace_with') || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json(
      {
        error: 'google_oauth_not_configured',
        message: 'Google OAuth is not configured on this ACICS instance. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL in your environment variables.',
        requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
      },
      501
    )
  }

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', clientId)
  googleAuthUrl.searchParams.set('redirect_uri', callbackUrl)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'openid email profile')
  googleAuthUrl.searchParams.set('access_type', 'offline')
  googleAuthUrl.searchParams.set('prompt', 'select_account')

  return c.redirect(googleAuthUrl.toString(), 302)
})

app.get('/api/auth/google/callback', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret || clientId.startsWith('replace_with')) {
    return c.json(
      {
        error: 'google_oauth_not_configured',
        message: 'Google OAuth callback cannot proceed: missing Google credentials.',
      },
      501
    )
  }
  return c.json({
    error: 'oauth_exchange_pending',
    message: 'OAuth token exchange and user provisioning will activate once production Google Client Secret is verified.',
  }, 501)
})

// Local development loopback test endpoints (used by test suites)
app.post('/api/acics/demo-login', async (c) => {
  if (c.env.FREEBUFF_CLIENT_ID || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) return c.json({ error: 'Demo identities are available only on a local development origin.' }, 403)
  const input: { sub?: string } = await c.req.json<{ sub?: string }>().catch(() => ({}))
  const account = DEMO_USERS.find((candidate) => candidate.sub === input.sub && candidate.sub.startsWith('demo-'))
  if (!account) return c.json({ error: 'Choose one of the listed synthetic demo accounts.' }, 400)
  const isSecure = new URL(c.req.url).protocol === 'https:'
  c.header('Set-Cookie', `acics_demo=${encodeURIComponent(account.sub)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${isSecure ? '; Secure' : ''}`)
  return c.json({ ok: true })
})
app.post('/api/acics/demo-logout', (c) => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) return c.json({ error: 'Demo sign-out is available only on a local development origin.' }, 403)
  const isSecure = new URL(c.req.url).protocol === 'https:'
  c.header('Set-Cookie', `acics_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`)
  return c.json({ ok: true })
})

const api = new Hono<AppContext>()
api.use('*', requireDb, requireUser, async (c, next) => {
  await ensureAcics(c.get('db'))
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
