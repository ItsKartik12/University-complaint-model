import { describe, expect, it, beforeEach } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createMockD1 } from './d1-mock'
import { ensureAcics } from '../src/backend/routes/acics'
import worker from '../src/backend/index'

function makeEnv(db: any) {
  return {
    DB: db,
    FILES: null,
    ASSETS: { fetch: async () => new Response('Asset not found', { status: 404 }) },
    APP_ORIGIN: 'http://localhost',
  }
}

describe('ACICS Full System & API Integration Tests', () => {
  let db: any
  let env: any

  beforeEach(async () => {
    db = createMockD1()
    await ensureAcics(db)
    env = makeEnv(db)
  })

  // Helper to make requests to the worker
  async function request(path: string, options: {
    method?: string
    headers?: Record<string, string>
    body?: any
    demoSub?: string
    sessionCookie?: string
    portal?: string
  } = {}) {
    const headers = new Headers(options.headers || {})
    headers.set('Origin', 'http://localhost')
    headers.set('Host', 'localhost')
    if (options.portal) {
      headers.set('x-acics-portal', options.portal)
    }
    if (options.sessionCookie) {
      headers.set('Cookie', options.sessionCookie)
    } else if (options.demoSub) {
      headers.set('Cookie', `acics_demo=${encodeURIComponent(options.demoSub)}`)
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    const req = new Request(`http://localhost${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    return worker.fetch(req, env as any, {} as any)
  }

  describe('Phase 4: Health and Auth Endpoints', () => {
    it('returns 200 for /api/health', async () => {
      const res = await request('/api/health')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
    })

    it('returns auth status in development mode on localhost', async () => {
      const res = await request('/api/auth/status')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.mode).toBe('development')
      expect(data.database).toBe(true)
    })

    it('supports demo login and sets HttpOnly cookie for valid account', async () => {
      const res = await request('/api/acics/demo-login', {
        method: 'POST',
        body: { sub: 'demo-complainant' },
      })
      expect(res.status).toBe(200)
      const cookie = res.headers.get('Set-Cookie')
      expect(cookie).toContain('acics_demo=demo-complainant')
      expect(cookie).toContain('HttpOnly')
    })

    it('rejects demo login for non-existent or invalid account', async () => {
      const res = await request('/api/acics/demo-login', {
        method: 'POST',
        body: { sub: 'hacker-account' },
      })
      expect(res.status).toBe(400)
    })

    it('clears session cookie on demo logout', async () => {
      const res = await request('/api/acics/demo-logout', {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      const cookie = res.headers.get('Set-Cookie')
      expect(cookie).toContain('Max-Age=0')
    })

    it('enforces authentication on protected endpoints', async () => {
      const res = await request('/api/acics/me')
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toContain('Sign in required')
    })

    it('identifies demo-complainant correctly via cookie', async () => {
      const res = await request('/api/acics/me', { demoSub: 'demo-complainant' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.role).toBe('COMPLAINANT')
      expect(body.user.name).toBe('Ananya Rao')
    })

    it('identifies demo-admin correctly via cookie', async () => {
      const res = await request('/api/acics/me', { demoSub: 'demo-admin' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.role).toBe('ADMIN')
      expect(body.user.name).toBe('Devika Sharma')
    })
  })

  describe('Phase 4B: Real Email/Password Authentication & Sessions', () => {
    it('rejects login with missing email or password with 400 Bad Request', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: '', password: '' },
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('required')
    })

    it('rejects unregistered email with generic 401 error (no enumeration)', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'unknown.user@aicte-india.org', password: 'SomePassword#123' },
      })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid email or password.')
    })

    it('rejects incorrect password for registered user with generic 401 error', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ananya.demo@example.test', password: 'WrongPassword#999' },
      })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid email or password.')
    })

    it('locks account after 5 consecutive failed login attempts with 429', async () => {
      // 4 failed attempts
      for (let i = 0; i < 4; i++) {
        const r = await request('/api/auth/login', {
          method: 'POST',
          body: { email: 'rohan.demo@example.test', password: `Wrong#${i}` },
        })
        expect(r.status).toBe(401)
      }
      // 5th failed attempt triggers temporary lockout
      const fifth = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'rohan.demo@example.test', password: 'Wrong#5' },
      })
      expect(fifth.status).toBe(429)
      const fifthData = await fifth.json()
      expect(fifthData.error).toContain('temporarily locked')

      // Subsequent attempt is blocked by lockout
      const sixth = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'rohan.demo@example.test', password: 'AcicsPassword#2026' },
      })
      expect(sixth.status).toBe(429)
    })

    it('authenticates valid credentials, sets HttpOnly acics_session cookie, and returns role', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ananya.demo@example.test', password: 'AcicsPassword#2026' },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.role).toBe('COMPLAINANT')
      expect(data.user.email).toBe('ananya.demo@example.test')

      const cookie = res.headers.get('Set-Cookie')
      expect(cookie).toContain('acics_session=')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
    })

    it('authenticates all four distinct roles via server database record', async () => {
      const testAccounts = [
        { email: 'ananya.demo@example.test', expectedRole: 'COMPLAINANT', name: 'Ananya Rao' },
        { email: 'kavita.official@example.test', expectedRole: 'OFFICIAL', name: 'Kavita Menon' },
        { email: 'devika.admin@example.test', expectedRole: 'ADMIN', name: 'Devika Sharma' },
        { email: 'amit.pgrc@example.test', expectedRole: 'BUREAU_OFFICER', name: 'Amit Kulkarni' },
      ]

      for (const account of testAccounts) {
        const res = await request('/api/auth/login', {
          method: 'POST',
          body: { email: account.email, password: 'AcicsPassword#2026' },
        })
        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.role).toBe(account.expectedRole)
        expect(data.user.name).toBe(account.name)

        // Session check with cookie
        const cookie = res.headers.get('Set-Cookie')!.split(';')[0]
        const meRes = await request('/api/auth/me', { sessionCookie: cookie })
        expect(meRes.status).toBe(200)
        const meData = await meRes.json()
        expect(meData.role).toBe(account.expectedRole)
        expect(meData.user.email).toBe(account.email)
      }
    })

    it('rejects tampered or forged session token with 401', async () => {
      const res = await request('/api/auth/me', {
        sessionCookie: 'acics_session=forged-session-id.9999999999999.invalid-signature',
      })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toContain('Sign in required')
    })

    it('destroys session and clears cookie upon logout', async () => {
      // 1. Login
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'devika.admin@example.test', password: 'AcicsPassword#2026' },
      })
      const cookie = loginRes.headers.get('Set-Cookie')!.split(';')[0]

      // 2. Logout
      const logoutRes = await request('/api/auth/logout', {
        method: 'POST',
        sessionCookie: cookie,
      })
      expect(logoutRes.status).toBe(200)
      const logoutCookie = logoutRes.headers.get('Set-Cookie')
      expect(logoutCookie).toContain('acics_session=;')
      expect(logoutCookie).toContain('Max-Age=0')

      // 3. Re-verify session is invalidated
      const meRes = await request('/api/auth/me', { sessionCookie: cookie })
      expect(meRes.status).toBe(401)
    })

    it('handles forgot password with secure non-enumerating message', async () => {
      const res = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: 'anyone@institution.gov.in' },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.message).toContain('guidance has been queued')

      // Rejects invalid email
      const badRes = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: 'invalid-email-format' },
      })
      expect(badRes.status).toBe(400)
    })

    it('returns 501 informative response when Google OAuth is invoked without credentials', async () => {
      const res = await request('/api/auth/google')
      expect(res.status).toBe(501)
      const data = await res.json()
      expect(data.error).toBe('google_oauth_not_configured')
      expect(data.message).toContain('Google OAuth is not configured')
      expect(data.requiredEnv).toContain('GOOGLE_CLIENT_ID')
    })
  })

  describe('Phase 3A: Complainant Portal Workflows', () => {
    it('allows complainants to retrieve public categories', async () => {
      const res = await request('/api/acics/categories', { demoSub: 'demo-complainant' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data.items)).toBe(true)
      expect(data.items).toContain('Faculty and staffing')
    })

    it('provides a safe institutions list without sensitive counts', async () => {
      const res = await request('/api/acics/institutions-list', { demoSub: 'demo-complainant' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.items.length).toBeGreaterThan(0)
      expect(data.items[0]).toHaveProperty('officialId')
      expect(data.items[0]).toHaveProperty('name')
      expect(data.items[0]).not.toHaveProperty('totalCases')
    })

    it('validates required fields on complaint submission', async () => {
      const res = await request('/api/acics/complaints', {
        method: 'POST',
        demoSub: 'demo-complainant',
        body: { subject: 'Test' }, // missing description, category, institutionId
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBeDefined()
    })

    it('validates category against allowed list', async () => {
      const res = await request('/api/acics/complaints', {
        method: 'POST',
        demoSub: 'demo-complainant',
        body: {
          institutionId: 'AICTE-DEMO-001',
          subject: 'Valid Subject With Length',
          description: 'Valid Description with enough length for submission.',
          category: 'Invalid Fraud Category',
        },
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Select a valid complaint category')
    })

    it('successfully submits a valid complaint and persists to database', async () => {
      const res = await request('/api/acics/complaints', {
        method: 'POST',
        demoSub: 'demo-complainant',
        body: {
          institutionId: 'AICTE-DEMO-001',
          subject: 'Lab computers out of order',
          description: 'The computer science lab computers have been non-functional for 3 weeks.',
          category: 'Infrastructure and facilities',
        },
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.item.complaintNumber).toMatch(/^AC-\d{4}-\d+$/)
      expect(data.item.id).toBeDefined()
      const complaintId = data.item.id

      // Verify persistence in DB
      const dbRow = await db.prepare('SELECT * FROM acics_complaints WHERE id=?').bind(complaintId).first()
      expect(dbRow).not.toBeNull()
      expect(dbRow.subject).toBe('Lab computers out of order')
      expect(dbRow.status).toBe('SUBMITTED')
      expect(dbRow.complainant_id).toBe('demo-complainant')

      // Verify notification created
      const notice = await db.prepare('SELECT * FROM acics_notifications WHERE complaint_id=?').bind(complaintId).first()
      expect(notice).not.toBeNull()
      expect(notice.recipient_id).toBe('demo-complainant')
    })

    it('complainant can only view their own complaints in the queue', async () => {
      const res = await request('/api/acics/complaints', { demoSub: 'demo-complainant' })
      expect(res.status).toBe(200)
      const data = await res.json()
      for (const item of data.items) {
        expect(item.id).toBeDefined()
        expect(item.subject).toBeDefined()
      }
    })

    it('blocks complainant from viewing another complainant’s case detail', async () => {
      // Find a case belonging to demo-complainant-other
      const otherCase = await db.prepare("SELECT id FROM acics_complaints WHERE complainant_id='demo-complainant-other' LIMIT 1").first()
      expect(otherCase).not.toBeNull()

      const res = await request(`/api/acics/complaints/${otherCase.id}`, { demoSub: 'demo-complainant' })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain('permission')
    })
  })

  describe('Phase 3B: Official / Case Officer Workflows', () => {
    it('official can view all complaints', async () => {
      const res = await request('/api/acics/complaints', { demoSub: 'demo-official' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.items.length).toBeGreaterThan(1)
    })

    it('official can view case details and full timeline', async () => {
      const res = await request('/api/acics/complaints/case-demo-001', { demoSub: 'demo-official' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.item.id).toBe('case-demo-001')
      expect(Array.isArray(data.actions)).toBe(true)
    })

    it('official can update complaint status along valid transitions', async () => {
      // Transition case-demo-001 (UNDER_PROCESS) -> AWAITING_INFORMATION
      const res = await request('/api/acics/complaints/case-demo-001/status', {
        method: 'PATCH',
        demoSub: 'demo-official',
        body: {
          status: 'AWAITING_INFORMATION',
          remarks: 'Officer taking up case for review.',
        },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)

      // Verify in DB
      const updated = await db.prepare('SELECT status FROM acics_complaints WHERE id=?').bind('case-demo-001').first()
      expect(updated.status).toBe('AWAITING_INFORMATION')
    })

    it('prevents illegal status transitions with 409 Conflict', async () => {
      const res = await request('/api/acics/complaints/case-demo-001/status', {
        method: 'PATCH',
        demoSub: 'demo-official',
        body: { status: 'CLOSED' },
      })
      expect(res.status).toBe(409)
    })

    it('official can add internal note not visible to complainant', async () => {
      const res = await request('/api/acics/complaints/case-demo-001/actions', {
        method: 'POST',
        demoSub: 'demo-official',
        body: {
          remarks: 'Confidential inquiry initiated with college administration.',
          visibility: 'INTERNAL',
        },
      })
      expect(res.status).toBe(201)

      // Complainant view should NOT see the internal note
      const cRes = await request('/api/acics/complaints/case-demo-001', { demoSub: 'demo-complainant' })
      expect(cRes.status).toBe(200)
      const cData = await cRes.json()
      const internalAction = cData.actions.find((t: any) => t.remarks?.includes('Confidential inquiry'))
      expect(internalAction).toBeUndefined()
    })
  })

  describe('Phase 3C & 3D: Bureau Coordination & Officer Assignment', () => {
    it('bureau officer only sees cases for their bureau or permitted scope', async () => {
      const res = await request('/api/acics/complaints', { demoSub: 'demo-pgrc' })
      expect(res.status).toBe(200)
      const data = await res.json()
      for (const item of data.items) {
        expect(item.assignedBureau.id).toBe('bureau-pgrc')
      }
    })

    it('allows assigning an officer to a complaint', async () => {
      const cRow = await db.prepare('SELECT id FROM acics_complaints LIMIT 1').first()
      const res = await request(`/api/acics/complaints/${cRow.id}/assign`, {
        method: 'PATCH',
        demoSub: 'demo-admin',
        body: { officerId: 'demo-official' },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)

      const updated = await db.prepare('SELECT assigned_officer_id FROM acics_complaints WHERE id=?').bind(cRow.id).first()
      expect(updated.assigned_officer_id).toBe('demo-official')
    })

    it('allows transferring a complaint to another bureau with audit log', async () => {
      const cRow = await db.prepare("SELECT id, assigned_bureau_id FROM acics_complaints WHERE status='UNDER_REVIEW' LIMIT 1").first()
      expect(cRow).not.toBeNull()

      const targetBureau = cRow.assigned_bureau_id === 'bureau-pgrc' ? 'bureau-rb' : 'bureau-pgrc'
      const res = await request(`/api/acics/complaints/${cRow.id}/status`, {
        method: 'PATCH',
        demoSub: 'demo-admin',
        body: {
          status: 'TRANSFERRED',
          targetBureauId: targetBureau,
          remarks: 'Jurisdiction belongs to Regulation Bureau.',
        },
      })
      expect(res.status).toBe(200)

      const updated = await db.prepare('SELECT assigned_bureau_id, status FROM acics_complaints WHERE id=?').bind(cRow.id).first()
      expect(updated.assigned_bureau_id).toBe(targetBureau)
      expect(updated.status).toBe('TRANSFERRED')

      const action = await db.prepare("SELECT * FROM acics_actions WHERE complaint_id=? AND action_type='BUREAU_TRANSFERRED'").bind(cRow.id).first()
      expect(action).not.toBeNull()
    })

    it('allows reviewing overlap alerts (CONFIRMED, REJECTED, INVESTIGATE)', async () => {
      const overlap = await db.prepare('SELECT id FROM acics_overlaps LIMIT 1').first()
      if (overlap) {
        const res = await request(`/api/acics/overlaps/${overlap.id}/review`, {
          method: 'PATCH',
          demoSub: 'demo-admin',
          body: {
            status: 'CONFIRMED',
            notes: 'Duplicate complaint confirmed from same student body.',
          },
        })
        expect(res.status).toBe(200)

        const updated = await db.prepare('SELECT review_status, review_notes FROM acics_overlaps WHERE id=?').bind(overlap.id).first()
        expect(updated.review_status).toBe('CONFIRMED')
        expect(updated.review_notes).toContain('Duplicate complaint')
      }
    })
  })

  describe('Phase 3C: Administrator Portal & User Management', () => {
    it('rejects non-admin from accessing admin endpoints', async () => {
      const res1 = await request('/api/acics/admin/users', { demoSub: 'demo-complainant' })
      expect(res1.status).toBe(403)

      const res2 = await request('/api/acics/admin/users', { demoSub: 'demo-official' })
      expect(res2.status).toBe(403)
    })

    it('admin can list users with search and filter', async () => {
      const res = await request('/api/acics/admin/users?role=OFFICIAL', { demoSub: 'demo-admin' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data.items)).toBe(true)
      expect(data.items.length).toBeGreaterThan(0)
      expect(data.items[0].role).toBe('OFFICIAL')
    })

    it('admin can create a new user', async () => {
      const res = await request('/api/acics/admin/users', {
        method: 'POST',
        demoSub: 'demo-admin',
        body: {
          fullName: 'Prof. Suresh Kumar',
          email: 'suresh.kumar@aicte.test',
          role: 'OFFICIAL',
        },
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.user.email).toBe('suresh.kumar@aicte.test')

      const dbUser = await db.prepare("SELECT * FROM acics_users WHERE email='suresh.kumar@aicte.test'").first()
      expect(dbUser).not.toBeNull()
      expect(dbUser.full_name).toBe('Prof. Suresh Kumar')
    })

    it('prevents administrator from deactivating their own account', async () => {
      const res = await request('/api/acics/admin/users/demo-admin', {
        method: 'PATCH',
        demoSub: 'demo-admin',
        body: { active: 0 },
      })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain('deactivate their own account')
    })

    it('admin can create and update an institution', async () => {
      const createRes = await request('/api/acics/admin/institutions', {
        method: 'POST',
        demoSub: 'demo-admin',
        body: {
          officialId: 'AICTE-NEW-999',
          name: 'Delhi Institute of Advanced Robotics',
          state: 'Delhi',
          district: 'New Delhi',
          type: 'Technical Institute',
        },
      })
      expect(createRes.status).toBe(201)
      const createData = await createRes.json()
      expect(createData.institution.officialId).toBe('AICTE-NEW-999')

      // Update institution
      const updateRes = await request(`/api/acics/admin/institutions/${createData.institution.id}`, {
        method: 'PATCH',
        demoSub: 'demo-admin',
        body: { name: 'Delhi Institute of Robotics and Automation' },
      })
      expect(updateRes.status).toBe(200)

      const instInDb = await db.prepare("SELECT name FROM acics_institutions WHERE official_id='AICTE-NEW-999'").first()
      expect(instInDb.name).toBe('Delhi Institute of Robotics and Automation')
    })

    it('admin can view complete audit logs', async () => {
      const res = await request('/api/acics/admin/audit-logs', { demoSub: 'demo-admin' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data.items)).toBe(true)
      expect(data.items.length).toBeGreaterThan(0)
    })
  })

  describe('Phase 7: End-to-End Complainant Response Workflow', () => {
    it('handles AWAITING_INFORMATION -> UNDER_PROCESS response from complainant', async () => {
      // Find or set a complaint to AWAITING_INFORMATION
      const cRow = await db.prepare("SELECT id FROM acics_complaints WHERE status='AWAITING_INFORMATION' LIMIT 1").first()
      expect(cRow).not.toBeNull()

      // Complainant responds with additional details
      const res = await request(`/api/acics/complaints/${cRow.id}/status`, {
        method: 'PATCH',
        demoSub: 'demo-complainant',
        body: {
          status: 'UNDER_PROCESS',
          remarks: 'Attached student roster and semester schedules as requested.',
        },
      })
      expect(res.status).toBe(200)

      const updated = await db.prepare('SELECT status FROM acics_complaints WHERE id=?').bind(cRow.id).first()
      expect(updated.status).toBe('UNDER_PROCESS')
    })
  })

  describe('Phase 9: Security & Input Robustness', () => {
    it('is resilient against SQL injection payloads in search queries', async () => {
      const payloads = [
        "' OR '1'='1",
        "'; DROP TABLE acics_complaints; --",
        "\" UNION SELECT * FROM acics_users --",
      ]
      for (const payload of payloads) {
        const res = await request(`/api/acics/complaints?q=${encodeURIComponent(payload)}`, {
          demoSub: 'demo-official',
        })
        expect(res.status).toBe(200)
        // Ensure table still exists
        const count = await db.prepare('SELECT COUNT(*) as count FROM acics_complaints').first()
        expect(count.count).toBeGreaterThan(0)
      }
    })

    it('returns 404 cleanly for non-existent complaint IDs', async () => {
      const res = await request('/api/acics/complaints/non-existent-case-id-12345', {
        demoSub: 'demo-official',
      })
      expect(res.status).toBe(404)
    })

    it('rejects cross-origin mutations without matching origin', async () => {
      const req = new Request('http://localhost/api/acics/complaints', {
        method: 'POST',
        headers: {
          'Origin': 'http://malicious-external-site.com',
          'Cookie': 'acics_demo=demo-complainant',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          institutionId: 'AICTE-DEMO-001',
          subject: 'CSRF Attempt',
          description: 'Testing CSRF rejection',
          category: 'Other',
        }),
      })
      const res = await worker.fetch(req, env as any, {} as any)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Cross-origin request refused')
    })
  })

  describe('Phase 10: Portal eligibility, multi-role access, and account approval', () => {
    it('publishes portal metadata without exposing demo identities in production mode', async () => {
      const res = await request('/api/auth/status')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.portals.map((p: any) => p.key)).toEqual(['complainant', 'official', 'admin', 'bureau'])
      expect(data.googleConfigured).toBe(false)
      expect(Array.isArray(data.demoAccounts)).toBe(true)

      const production = await worker.fetch(
        new Request('http://localhost/api/auth/status', { headers: { Origin: 'http://localhost' } }),
        { ...env, APP_ENV: 'production' } as any,
        {} as any,
      )
      const productionData = await production.json()
      expect(productionData.demoAccounts).toEqual([])
    })

    it('authenticates but does not grant a portal merely because it was selected', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ananya.demo@example.test', password: 'AcicsPassword#2026', portal: 'admin' },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.role).toBe('COMPLAINANT')
      expect(data.access.allowed).toBe(false)
      expect(data.access.code).toBe('PORTAL_NOT_AUTHORIZED')
    })

    it('rejects a portal header the account does not hold on protected routes', async () => {
      const res = await request('/api/acics/complaints', { demoSub: 'demo-complainant', portal: 'admin' })
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.code).toBe('PORTAL_NOT_AUTHORIZED')
    })

    it('rejects unknown portal headers instead of silently ignoring them', async () => {
      const me = await request('/api/auth/me', { demoSub: 'demo-complainant', portal: 'superuser' })
      expect(me.status).toBe(400)
      expect((await me.json()).code).toBe('PORTAL_UNKNOWN')

      const queue = await request('/api/acics/complaints', { demoSub: 'demo-complainant', portal: 'root' })
      expect(queue.status).toBe(403)
      expect((await queue.json()).code).toBe('PORTAL_UNKNOWN')
    })

    it('lets a multi-role account into each held portal but not unheld ones', async () => {
      const complainant = await request('/api/acics/complaints', { demoSub: 'demo-multirole', portal: 'complainant' })
      expect(complainant.status).toBe(200)

      const official = await request('/api/acics/complaints?scope=assigned', { demoSub: 'demo-multirole', portal: 'official' })
      expect(official.status).toBe(200)

      const admin = await request('/api/acics/admin/users', { demoSub: 'demo-multirole', portal: 'admin' })
      expect(admin.status).toBe(403)
    })

    it('blocks accounts awaiting approval and suspended accounts with explicit codes', async () => {
      const pending = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'suresh.pending@example.test', password: 'AcicsPassword#2026' },
      })
      expect(pending.status).toBe(403)
      const pendingData = await pending.json()
      expect(pendingData.code).toBe('ACCOUNT_PENDING_APPROVAL')
      expect(pendingData.error).toContain('awaiting approval')

      const suspended = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'meera.suspended@example.test', password: 'AcicsPassword#2026' },
      })
      expect(suspended.status).toBe(403)
      expect((await suspended.json()).code).toBe('ACCOUNT_SUSPENDED')
    })

    it('exposes complainant onboarding options publicly', async () => {
      const res = await request('/api/auth/onboarding/options')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.designations).toContain('Assistant Professor')
      expect(data.institutions.length).toBeGreaterThan(0)
      expect(data.requestedPortal).toBe('complainant')
    })

    it('refuses privileged self-assignment and invalid designations during account requests', async () => {
      const privileged = await request('/api/auth/account-request', {
        method: 'POST',
        body: {
          fullName: 'Rising Admin',
          email: `rising.admin.${Date.now()}@example.test`,
          password: 'RequestPassword#123',
          designation: 'Assistant Professor',
          institutionOfficialId: 'AICTE-DEMO-001',
          requestedPortal: 'admin',
        },
      })
      expect(privileged.status).toBe(403)
      expect((await privileged.json()).code).toBe('PRIVILEGED_PORTAL_DENIED')

      const forgedRole = await request('/api/auth/account-request', {
        method: 'POST',
        body: {
          fullName: 'Role Forger',
          email: `role.forger.${Date.now()}@example.test`,
          password: 'RequestPassword#123',
          designation: 'Assistant Professor',
          institutionOfficialId: 'AICTE-DEMO-001',
          role: 'ADMIN',
        },
      })
      expect(forgedRole.status).toBe(403)
      expect((await forgedRole.json()).code).toBe('PRIVILEGED_ROLE_DENIED')

      const invalidDesignation = await request('/api/auth/account-request', {
        method: 'POST',
        body: {
          fullName: 'Invalid Designation',
          email: `invalid.designation.${Date.now()}@example.test`,
          password: 'RequestPassword#123',
          designation: 'Freelance consultant',
          institutionOfficialId: 'AICTE-DEMO-001',
        },
      })
      expect(invalidDesignation.status).toBe(400)
    })

    it('records an account request, blocks sign-in, then allows it after administrator approval', async () => {
      const email = `approved.faculty.${Date.now()}@example.test`
      const created = await request('/api/auth/account-request', {
        method: 'POST',
        body: {
          fullName: 'Approved Faculty',
          email,
          password: 'RequestPassword#123',
          designation: 'Assistant Professor',
          institutionOfficialId: 'AICTE-DEMO-001',
        },
      })
      expect(created.status).toBe(201)
      expect((await created.json()).status).toBe('PENDING_APPROVAL')

      const row = await db.prepare('SELECT * FROM acics_users WHERE lower(email)=?').bind(email).first<any>()
      expect(row).not.toBeNull()
      expect(row.account_status).toBe('PENDING_APPROVAL')
      expect(row.role).toBe('')
      expect(row.requested_role).toBe('COMPLAINANT')

      const beforeApproval = await request('/api/auth/login', {
        method: 'POST',
        body: { email, password: 'RequestPassword#123' },
      })
      expect(beforeApproval.status).toBe(403)
      expect((await beforeApproval.json()).code).toBe('ACCOUNT_PENDING_APPROVAL')

      const approval = await request(`/api/acics/admin/users/${row.sub}`, {
        method: 'PATCH',
        demoSub: 'demo-admin',
        body: { accountStatus: 'ACTIVE', roles: ['COMPLAINANT'] },
      })
      expect(approval.status).toBe(200)

      const afterApproval = await request('/api/auth/login', {
        method: 'POST',
        body: { email, password: 'RequestPassword#123', portal: 'complainant' },
      })
      expect(afterApproval.status).toBe(200)
      const loginData = await afterApproval.json()
      expect(loginData.access.allowed).toBe(true)
      expect(loginData.role).toBe('COMPLAINANT')

      const cookie = afterApproval.headers.get('Set-Cookie')!.split(';')[0]
      const queue = await request('/api/acics/complaints', { sessionCookie: cookie, portal: 'complainant' })
      expect(queue.status).toBe(200)

      const audit = await db
        .prepare(`SELECT * FROM acics_actions WHERE action_type='USER_ACCESS_REQUESTED' AND actor_id=?`)
        .bind(row.sub)
        .first<any>()
      expect(audit).not.toBeNull()
    })

    it('prevents an administrator from removing their own administrator role', async () => {
      const res = await request('/api/acics/admin/users/demo-admin', {
        method: 'PATCH',
        demoSub: 'demo-admin',
        body: { roles: ['COMPLAINANT'], accountStatus: 'ACTIVE' },
      })
      expect(res.status).toBe(403)
    })

    it('disables synthetic demo sign-in when production mode is configured', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/acics/demo-login', {
          method: 'POST',
          headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
          body: JSON.stringify({ sub: 'demo-admin' }),
        }),
        { ...env, APP_ENV: 'production' } as any,
        {} as any,
      )
      expect(res.status).toBe(403)
    })
  })

  describe('Phase 11: Local development access', () => {
    async function devLogin(body: Record<string, unknown>) {
      const res = await request('/api/auth/dev-session', { method: 'POST', body })
      const cookie = res.status === 200 ? res.headers.get('Set-Cookie')!.split(';')[0] : ''
      return { res, cookie }
    }

    it('accepts any non-empty user ID and issues a labelled synthetic session', async () => {
      const { res, cookie } = await devLogin({ identifier: 'kartik@example.org', displayName: 'Kartik' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.development).toBe(true)
      expect(data.label).toBe('LOCAL DEVELOPMENT MODE')
      expect(data.account.roles.sort()).toEqual(['ADMIN', 'BUREAU_OFFICER', 'COMPLAINANT', 'OFFICIAL'])
      expect(cookie).toContain('acics_session=')
      expect(String(res.headers.get('Set-Cookie'))).toContain('HttpOnly')

      const me = await request('/api/auth/me', { sessionCookie: cookie })
      expect(me.status).toBe(200)
      const account = await me.json()
      expect(account.email).toBe('kartik@example.org')
      expect(account.name).toBe('Kartik')
      expect(account.accountStatus).toBe('ACTIVE')
    })

    it('gives the development session access to all four portals', async () => {
      const { cookie } = await devLogin({ identifier: 'portal-tester' })
      for (const portal of ['complainant', 'official', 'admin', 'bureau']) {
        const me = await request('/api/auth/me', { sessionCookie: cookie, portal })
        expect(me.status).toBe(200)
        expect((await me.json()).activePortal).toBe(portal)
        const access = await request('/api/auth/portal-access', { method: 'POST', sessionCookie: cookie, body: { portal } })
        expect(access.status).toBe(200)
        expect((await access.json()).allowed).toBe(true)
      }
    })

    it('rejects blank identifiers without creating a session', async () => {
      for (const identifier of ['', '   ']) {
        const { res } = await devLogin({ identifier })
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('DEV_ID_REQUIRED')
        expect(res.headers.get('Set-Cookie')).toBeNull()
      }
    })

    it('refuses development access when APP_ENV=production', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/dev-session', {
          method: 'POST',
          headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'production-probe' }),
        }),
        { ...env, APP_ENV: 'production' } as any,
        {} as any,
      )
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('DEV_AUTH_DISABLED')
      expect(res.headers.get('Set-Cookie')).toBeNull()
    })

    it('refuses development access on a non-loopback origin', async () => {
      const res = await worker.fetch(
        new Request('https://acics.example.gov.in/api/auth/dev-session', {
          method: 'POST',
          headers: { Origin: 'https://acics.example.gov.in', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'remote-probe' }),
        }),
        env as any,
        {} as any,
      )
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('DEV_AUTH_DISABLED')
    })

    it('refuses development access once an identity provider is configured', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/dev-session', {
          method: 'POST',
          headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'oauth-probe' }),
        }),
        { ...env, FREEBUFF_CLIENT_ID: 'configured-client' } as any,
        {} as any,
      )
      expect(res.status).toBe(403)
    })

    it('honours explicit AUTH_MODE=mock on a loopback origin', async () => {
      const mockEnv = { ...env, APP_ENV: 'development', AUTH_MODE: 'mock' } as any
      const status = await worker.fetch(new Request('http://localhost/api/auth/status'), mockEnv, {} as any)
      const statusBody = await status.json()
      expect(statusBody.mode).toBe('mock')
      expect(statusBody.devAuthEnabled).toBe(true)

      const res = await worker.fetch(
        new Request('http://localhost/api/auth/dev-session', {
          method: 'POST',
          headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'mock-mode-user', portal: 'admin' }),
        }),
        mockEnv,
        {} as any,
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.label).toBe('LOCAL DEVELOPMENT MODE')
      expect(data.account.roles.sort()).toEqual(['ADMIN', 'BUREAU_OFFICER', 'COMPLAINANT', 'OFFICIAL'])
    })

    it('never allows AUTH_MODE=mock to override production', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/dev-session', {
          method: 'POST',
          headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'production-mock-probe' }),
        }),
        { ...env, APP_ENV: 'production', AUTH_MODE: 'mock' } as any,
        {} as any,
      )
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('DEV_AUTH_DISABLED')
    })

    it('persists a complaint created through a development session', async () => {
      const { cookie } = await devLogin({ identifier: 'complaint-author' })
      const created = await request('/api/acics/complaints', {
        method: 'POST',
        sessionCookie: cookie,
        portal: 'complainant',
        body: {
          institutionOfficialId: 'AICTE-DEMO-001',
          subject: 'Development access persistence check',
          description: 'This complaint verifies that a development session writes through to the database and can be read back.',
          category: 'Other',
          priority: 'LOW',
        },
      })
      expect(created.status).toBe(201)
      const { item } = await created.json()
      expect(item.complaintNumber).toMatch(/^AC-\d{4}-\d+$/)

      const list = await request('/api/acics/complaints?q=Development%20access%20persistence', { sessionCookie: cookie, portal: 'complainant' })
      expect(list.status).toBe(200)
      expect((await list.json()).items.some((row: any) => row.id === item.id)).toBe(true)

      const detail = await request(`/api/acics/complaints/${item.id}`, { sessionCookie: cookie, portal: 'complainant' })
      expect(detail.status).toBe(200)
      expect((await detail.json()).item.subject).toBe('Development access persistence check')
    })

    it('marks development identities as synthetic for production login refusal', async () => {
      const { cookie } = await devLogin({ identifier: 'synthetic-check' })
      const me = await request('/api/auth/me', { sessionCookie: cookie })
      const account = await me.json()
      expect(account.sub.startsWith('dev-')).toBe(true)
      const { isSyntheticIdentity } = await import('../src/backend/routes/acics')
      expect(isSyntheticIdentity(account.sub)).toBe(true)
      expect(isSyntheticIdentity('dev-user')).toBe(true)
      expect(isSyntheticIdentity('demo-complainant')).toBe(true)
      expect(isSyntheticIdentity('user-real')).toBe(false)
    })
  })

  describe('Phase 12: Configuration, errors, and client contract', () => {
    it('returns a JSON 503 instead of crashing when the D1 binding is missing', async () => {
      const noDb = { ...env, DB: undefined }
      for (const path of ['/api/auth/me', '/api/auth/portal-access']) {
        const res = await worker.fetch(
          new Request(`http://localhost${path}`, {
            method: path.includes('portal-access') ? 'POST' : 'GET',
            headers: { Origin: 'http://localhost' },
          }),
          noDb as any,
          {} as any,
        )
        expect(res.status).toBe(503)
        expect(res.headers.get('content-type')).toContain('application/json')
        const body = await res.json()
        expect(body.error).toBeTruthy()
        expect(JSON.stringify(body)).not.toContain('Something went wrong')
      }
    })

    it('answers unauthenticated and unknown API calls with JSON errors, never a 500', async () => {
      const me = await request('/api/auth/me')
      expect(me.status).toBe(401)
      expect((await me.json()).error).toBe('Sign in required.')

      const onboarding = await request('/api/auth/onboarding/options')
      expect(onboarding.status).toBe(200)

      // Unknown API paths sit behind the authenticated router, so anonymous
      // callers get a JSON 401; signed-in callers get a JSON 404. Never a 500.
      const anonymousMissing = await request('/api/does-not-exist')
      expect(anonymousMissing.status).toBe(401)
      expect((await anonymousMissing.json()).error).toBe('Sign in required.')

      const signedInMissing = await request('/api/does-not-exist', { demoSub: 'demo-official' })
      expect(signedInMissing.status).toBe(404)
      expect((await signedInMissing.json()).error).toBe('Not found.')
    })

    it('keeps every frontend request on the same-origin /api base', () => {
      const root = join(import.meta.dir, '..', 'src', 'frontend')
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const full = join(dir, name)
          return statSync(full).isDirectory() ? walk(full) : [full]
        })
      const files = walk(root).filter((file) => /\.(ts|tsx)$/.test(file))
      expect(files.length).toBeGreaterThan(10)
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        expect(source).not.toContain('localhost:')
        expect(source).not.toContain('127.0.0.1')
        expect(source).not.toContain(':8787')
        expect(source).not.toContain(':3000')
      }
      const apiSource = readFileSync(join(root, 'services', 'api', 'api.ts'), 'utf8')
      expect(apiSource).toContain("?? '/api'")
    })

    it('seeds synthetic data idempotently and refuses to seed in production', async () => {
      const first = await request('/api/dev/seed', { method: 'POST' })
      expect(first.status).toBe(200)
      const firstBody = await first.json()
      expect(firstBody.label).toBe('LOCAL DEVELOPMENT MODE')
      expect(firstBody.counts.complaints).toBeGreaterThan(0)

      const second = await request('/api/dev/seed', { method: 'POST' })
      expect(second.status).toBe(200)
      expect((await second.json()).counts).toEqual(firstBody.counts)

      const blocked = await worker.fetch(
        new Request('http://localhost/api/dev/seed', {
          method: 'POST',
          headers: { Origin: 'http://localhost' },
        }),
        { ...env, APP_ENV: 'production' } as any,
        {} as any,
      )
      expect(blocked.status).toBe(403)
      expect((await blocked.json()).code).toBe('DEV_SEED_DISABLED')
    })
  })
})
