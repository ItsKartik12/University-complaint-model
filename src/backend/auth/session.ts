import type { Env } from '../types'

const SESSION_MAX_AGE = 7 * 86_400_000

function cookiesOf(request: Request): Record<string, string> {
  const header = request.headers.get('cookie') || ''
  return Object.fromEntries(
    header.split(';').map((part) => {
      const [key, ...value] = part.trim().split('=')
      return [key, decodeURIComponent(value.join('='))]
    }),
  )
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

function sessionSecret(env: Env): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET
  return (env.APP_ENV || '').toLowerCase() === 'production' ? '' : 'acics_dev_session_secret_key_32bytes_min'
}

export { cookiesOf, isSecureRequest, sessionSecret }

export async function issueSession(c: any, db: D1Database, sub: string): Promise<boolean> {
  const secret = sessionSecret(c.env)
  if (!secret) return false
  const sessionId = crypto.randomUUID()
  const expiresAt = Date.now() + SESSION_MAX_AGE
  const { createSessionToken } = await import('./crypto')
  const token = await createSessionToken(sessionId, expiresAt, secret)
  await db
    .prepare('INSERT INTO acics_sessions (id, user_sub, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, sub, expiresAt, Date.now())
    .run()
  const secure = isSecureRequest(c.req.raw) ? '; Secure' : ''
  c.header('Set-Cookie', `acics_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`)
  c.header('Set-Cookie', `acics_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, { append: true })
  return true
}

export function clearSessionCookies(c: any) {
  const secure = isSecureRequest(c.req.raw) ? '; Secure' : ''
  c.header('Set-Cookie', `acics_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
  c.header('Set-Cookie', `acics_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, { append: true })
}
