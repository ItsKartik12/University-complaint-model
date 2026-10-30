import type { Env } from '../../types'

export const GOOGLE_PROVIDER_NAME = 'GoogleAuthProvider'

export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  name: string
}

export function isGoogleConfigured(env: Env): boolean {
  const placeholder = (value?: string) => !value || value.startsWith('replace_with')
  return !placeholder(env.GOOGLE_CLIENT_ID) && !placeholder(env.GOOGLE_CLIENT_SECRET)
}

/** Future Google identity provider. Configuration detection and token validation only. */
export class GoogleAuthProvider {
  readonly name = GOOGLE_PROVIDER_NAME

  isConfigured(env: Env): boolean {
    return isGoogleConfigured(env)
  }

  buildAuthorizationUrl(env: Env, request: Request, _portal: string): { url: URL; state: string; nonce: string } {
    const clientId = env.GOOGLE_CLIENT_ID!
    const callbackUrl = env.GOOGLE_CALLBACK_URL || `${new URL(request.url).origin}/api/auth/google/callback`
    const state = crypto.randomUUID()
    const nonce = crypto.randomUUID()
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', callbackUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
    return { url, state, nonce }
  }

  async exchangeCode(env: Env, code: string, redirectUri: string): Promise<GoogleIdentity | { error: string }> {
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenResponse.ok) return { error: 'token_exchange_failed' }
      const tokens = (await tokenResponse.json()) as { id_token?: string }
      if (!tokens.id_token) return { error: 'missing_id_token' }

      const infoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`)
      if (!infoResponse.ok) return { error: 'invalid_id_token' }
      const info = (await infoResponse.json()) as Record<string, string>
      const emailVerified = info.email_verified === 'true' || (info.email_verified as unknown) === true
      if (info.aud !== env.GOOGLE_CLIENT_ID) return { error: 'audience_mismatch' }
      if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') return { error: 'issuer_mismatch' }
      if (!info.exp || Number(info.exp) * 1000 <= Date.now()) return { error: 'token_expired' }
      if (!info.sub || !info.email || !emailVerified) return { error: 'unverified_identity' }
      return { sub: info.sub, email: info.email.toLowerCase(), emailVerified, name: info.name || info.email.split('@')[0] }
    } catch {
      return { error: 'google_unavailable' }
    }
  }
}

export const googleAuthProvider = new GoogleAuthProvider()
