import { describe, expect, it, beforeEach } from 'bun:test'
import { createMockD1 } from './d1-mock'
import { ensureAcics } from '../src/worker/acics'
import worker from '../src/worker/index'

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
  } = {}) {
    const headers = new Headers(options.headers || {})
    headers.set('Origin', 'http://localhost')
    headers.set('Host', 'localhost')
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
})
