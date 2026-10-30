import { createFreebuffAuth, isSameOriginRequest } from '@freebuff/auth'
import type { FreebuffAuth, FreebuffUser } from '@freebuff/auth'
import type { Context, MiddlewareHandler } from 'hono'

import type { AppContext, Env } from '../types'
import { sessionSecret } from './session'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

// Synthetic demo identities are honoured only on loopback when no client ID
// is configured. A missing demo cookie means the user is unauthenticated.
export const DEV_USER: FreebuffUser = {
  sub: 'dev-user',
  name: 'Alex Morgan',
  email: 'alex@yourcompany.com',
  email_verified: true,
}

export function isLoopback(request: Request): boolean {
  return LOOPBACK.has(new URL(request.url).hostname)
}

export type AuthMode = 'freebuff' | 'mock' | 'development' | 'off'

export function authMode(env: Env, request: Request): AuthMode {
  if (env.FREEBUFF_CLIENT_ID) return 'freebuff'
  // Production deployments must never fall back to synthetic loopback identities.
  if ((env.APP_ENV || '').toLowerCase() === 'production') return 'off'
  if (!isLoopback(request)) return 'off'
  if ((env.AUTH_MODE || '').toLowerCase() === 'mock') return 'mock'
  // Loopback development with no explicit mode keeps the previous behaviour.
  return 'development'
}

let cached: { key: string; auth: FreebuffAuth } | undefined

/** One auth instance per isolate; recreated only if the config changes. */
export function getAuth(env: Env, request: Request): FreebuffAuth | null {
  if (!env.FREEBUFF_CLIENT_ID) return null
  const baseUrl = env.FRONTEND_ORIGIN ?? env.APP_ORIGIN ?? new URL(request.url).origin
  const key = `${env.FREEBUFF_CLIENT_ID}|${env.FREEBUFF_ISSUER ?? ''}|${baseUrl}`
  if (cached?.key !== key) {
    cached = {
      key,
      auth: createFreebuffAuth({
        clientId: env.FREEBUFF_CLIENT_ID,
        issuer: env.FREEBUFF_ISSUER || undefined,
        baseUrl,
        allowInsecureLocalhost: new URL(baseUrl).protocol === 'http:' && LOOPBACK.has(new URL(baseUrl).hostname),
      }),
    }
  }
  return cached.auth
}

import { verifySessionToken } from './crypto'

export async function currentUser(env: Env, request: Request, db?: D1Database): Promise<FreebuffUser | null> {
  const auth = getAuth(env, request)
  if (auth) return auth.getUser(request)

  const cookieHeader = request.headers.get('cookie') || ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((part) => {
      const [k, ...v] = part.trim().split('=')
      return [k, decodeURIComponent(v.join('='))]
    })
  )

  // 1. Authenticate via secure acics_session cookie backed by database
  const sessionToken = cookies['acics_session']
  const activeDb = db || env.DB
  if (sessionToken && activeDb) {
    const secret = sessionSecret(env)
    const verified = secret ? await verifySessionToken(sessionToken, secret) : null
    if (verified) {
      try {
        // Account status is evaluated by the authorization layer so suspended
        // and pending accounts receive an explicit 403 instead of "sign in".
        const sessionRow = await activeDb
          .prepare(
            `SELECT u.sub, u.full_name, u.email
             FROM acics_sessions s
             JOIN acics_users u ON u.sub = s.user_sub
             WHERE s.id = ? AND s.expires_at > ?`,
          )
          .bind(verified.sessionId, Date.now())
          .first<any>()

        if (sessionRow) {
          return {
            sub: sessionRow.sub,
            name: sessionRow.full_name,
            email: sessionRow.email,
            email_verified: true,
          }
        }
      } catch {
        // Table or lookup error fallback
      }
    }
  }

  // 2. Local loopback demo cookie (maintained for automated integration tests)
  if (authMode(env, request) === 'development') {
    const demoSub = cookies['acics_demo']
    if (demoSub && demoSub.startsWith('demo-')) {
      const { DEMO_USERS } = await import('../routes/acics')
      const demo = DEMO_USERS.find((candidate) => candidate.sub === demoSub)
      if (demo) return { sub: demo.sub, name: demo.name, email: demo.email, email_verified: true }
    }
  }

  return null
}

export function appOrigin(env: Env, request: Request): string {
  return env.FRONTEND_ORIGIN ?? env.APP_ORIGIN ?? new URL(request.url).origin
}

/** Requires a signed-in user and, for mutations, a same-origin request. */
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  const request = c.req.raw
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOriginRequest(request, appOrigin(c.env, request))) {
    return c.json({ error: 'Cross-origin request refused.' }, 403)
  }
  const user = await currentUser(c.env, request, c.get('db') || c.env.DB)
  if (!user) return c.json({ error: 'Sign in required.' }, 401)
  c.set('user', user)
  await next()
}

export function privateJson<T>(c: Context<AppContext>, body: T, status = 200) {
  c.header('Cache-Control', 'private, no-store')
  return c.json(body as never, status as never)
}
