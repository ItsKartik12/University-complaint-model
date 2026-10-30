// Cryptographic helpers for ACICS password hashing, verification, and session signing.
// Uses standard Web Crypto API (supported natively across Cloudflare Workers, Node 20+, and Bun).

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Derives a PBKDF2-SHA256 password hash using 100,000 iterations and a 128-bit salt.
 */
export async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder()
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(salt),
  }
}

/**
 * Validates a plaintext password against a stored PBKDF2 hash and salt using constant-time comparison.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  if (!password || !storedHash || !storedSalt) return false
  try {
    const { hash } = await hashPassword(password, storedSalt)
    return timingSafeEqual(hash, storedHash)
  } catch {
    return false
  }
}

/**
 * Signs payload with HMAC-SHA256 using the provided secret key.
 */
export async function signHmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return bytesToHex(new Uint8Array(sig))
}

/**
 * Creates a tamper-evident session token: `<sessionId>.<expiresAt>.<hmacSignature>`
 */
export async function createSessionToken(
  sessionId: string,
  expiresAt: number,
  secret: string
): Promise<string> {
  const data = `${sessionId}:${expiresAt}`
  const signature = await signHmac(secret, data)
  return `${sessionId}.${expiresAt}.${signature}`
}

/**
 * Verifies a session token, returning sessionId and expiresAt if valid and non-expired.
 */
export async function verifySessionToken(
  token: string,
  secret: string
): Promise<{ sessionId: string; expiresAt: number } | null> {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [sessionId, expiresStr, signature] = parts
  const expiresAt = Number(expiresStr)
  if (!sessionId || isNaN(expiresAt) || !signature) return null
  if (Date.now() > expiresAt) return null

  const data = `${sessionId}:${expiresAt}`
  const expectedSig = await signHmac(secret, data)
  if (!timingSafeEqual(expectedSig, signature)) return null

  return { sessionId, expiresAt }
}
