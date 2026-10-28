import { Hono } from 'hono'

import { authMode, getAuth, requireUser } from './auth'
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

app.get('/api/health', (c) => c.json({ ok: true }))

// Loopback-only synthetic identities let a local demonstrator exercise all
// roles. This endpoint is disabled when real Freebuff authentication is set.
app.post('/api/acics/demo-login', async (c) => {
  if (c.env.FREEBUFF_CLIENT_ID || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) return c.json({ error: 'Demo identities are available only on a local development origin.' }, 403)
  const input: { sub?: string } = await c.req.json<{ sub?: string }>().catch(() => ({}))
  const account = DEMO_USERS.find((candidate) => candidate.sub === input.sub && candidate.sub.startsWith('demo-'))
  if (!account) return c.json({ error: 'Choose one of the listed synthetic demo accounts.' }, 400)
  c.header('Set-Cookie', `acics_demo=${encodeURIComponent(account.sub)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`)
  return c.json({ ok: true })
})
app.post('/api/acics/demo-logout', (c) => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) return c.json({ error: 'Demo sign-out is available only on a local development origin.' }, 403)
  c.header('Set-Cookie', 'acics_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  return c.json({ ok: true })
})

const api = new Hono<AppContext>()
api.use('*', requireUser, requireDb, async (c, next) => {
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
