import { Hono } from 'hono'

import { privateJson } from '../auth'
import { ACCOUNT_STATUSES, ACICS_ROLES, accountStatusMessage, loadAccount, resolveActiveRole } from '../auth/authorization'
import type { AcicsRole } from '../auth/authorization'
import type { AppContext, Env } from '../types'

const DAY = 86_400_000
const ROLES = ACICS_ROLES
const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'UNDER_PROCESS', 'AWAITING_INFORMATION', 'TRANSFERRED', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REJECTED'] as const
const CATEGORIES = ['Faculty and staffing', 'Infrastructure and facilities', 'Academic quality', 'Regulatory compliance', 'Student grievances', 'Institutional administration', 'Other']
const transitions: Record<string, string[]> = {
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED'], UNDER_REVIEW: ['UNDER_PROCESS', 'AWAITING_INFORMATION', 'TRANSFERRED', 'ESCALATED', 'REJECTED'],
  UNDER_PROCESS: ['AWAITING_INFORMATION', 'TRANSFERRED', 'ESCALATED', 'RESOLVED'], AWAITING_INFORMATION: ['UNDER_PROCESS', 'RESOLVED'],
  TRANSFERRED: ['UNDER_REVIEW', 'UNDER_PROCESS', 'ESCALATED'], ESCALATED: ['UNDER_PROCESS', 'RESOLVED'], RESOLVED: ['CLOSED', 'UNDER_PROCESS'], CLOSED: [], REJECTED: [],
}
export const DEMO_USERS: Array<{
  sub: string
  name: string
  email: string
  role: AcicsRole
  bureauId: string | null
  roles: AcicsRole[]
  designation: string
  institutionId: string | null
}> = [
  { sub: 'demo-complainant', name: 'Ananya Rao', email: 'ananya.demo@example.test', role: 'COMPLAINANT', bureauId: null, roles: ['COMPLAINANT'], designation: 'Assistant Professor', institutionId: 'inst-001' },
  { sub: 'demo-complainant-other', name: 'Rohan Das', email: 'rohan.demo@example.test', role: 'COMPLAINANT', bureauId: null, roles: ['COMPLAINANT'], designation: 'Head of Department', institutionId: 'inst-003' },
  { sub: 'demo-official', name: 'Kavita Menon', email: 'kavita.official@example.test', role: 'OFFICIAL', bureauId: null, roles: ['OFFICIAL'], designation: 'Case Officer', institutionId: null },
  { sub: 'demo-admin', name: 'Devika Sharma', email: 'devika.admin@example.test', role: 'ADMIN', bureauId: null, roles: ['ADMIN'], designation: 'Portal Administrator', institutionId: null },
  { sub: 'demo-pgrc', name: 'Amit Kulkarni', email: 'amit.pgrc@example.test', role: 'BUREAU_OFFICER', bureauId: 'bureau-pgrc', roles: ['BUREAU_OFFICER'], designation: 'Bureau Coordination Officer', institutionId: null },
  { sub: 'demo-rb', name: 'Neha Iyer', email: 'neha.rb@example.test', role: 'BUREAU_OFFICER', bureauId: 'bureau-rb', roles: ['BUREAU_OFFICER'], designation: 'Bureau Coordination Officer', institutionId: null },
  { sub: 'demo-multirole', name: 'Priya Verma', email: 'priya.multirole@example.test', role: 'COMPLAINANT', bureauId: null, roles: ['COMPLAINANT', 'OFFICIAL'], designation: 'Head of Department', institutionId: 'inst-003' },
]

// Accounts that exercise the verification workflow. They authenticate with the
// development password but cannot enter a portal until an administrator acts.
const PENDING_USERS: Array<{
  sub: string
  name: string
  email: string
  role: AcicsRole | ''
  status: 'PENDING_APPROVAL' | 'SUSPENDED' | 'PENDING_VERIFICATION'
  designation: string
  institutionId: string | null
}> = [
  { sub: 'pending-faculty', name: 'Suresh Nair', email: 'suresh.pending@example.test', role: '', status: 'PENDING_APPROVAL', designation: 'Assistant Professor', institutionId: 'inst-001' },
  { sub: 'suspended-official', name: 'Meera Joshi', email: 'meera.suspended@example.test', role: 'OFFICIAL', status: 'SUSPENDED', designation: 'Case Officer', institutionId: null },
]
const INSTITUTIONS = [
  ['inst-001','AICTE-DEMO-001','National Institute of Technology, Jaipur','Rajasthan','Jaipur','Public technical institute'],
  ['inst-002','AICTE-DEMO-002','Coastal Engineering College','Karnataka','Mangaluru','Private engineering college'],
  ['inst-003','AICTE-DEMO-003','Eastern Valley Institute of Technology','West Bengal','Kolkata','Private engineering college'],
  ['inst-004','AICTE-DEMO-004','Deccan School of Management','Maharashtra','Pune','Management institute'],
  ['inst-005','AICTE-DEMO-005','Central Polytechnic, Bhopal','Madhya Pradesh','Bhopal','Public polytechnic'],
  ['inst-006','AICTE-DEMO-006','Greenfield College of Engineering','Tamil Nadu','Coimbatore','Private engineering college'],
  ['inst-007','AICTE-DEMO-007','Himalayan Technical University','Uttarakhand','Dehradun','Technical university'],
  ['inst-008','AICTE-DEMO-008','Riverbend Institute of Technology','Assam','Guwahati','Private engineering college'],
  ['inst-009','AICTE-DEMO-009','Western Institute of Applied Sciences','Gujarat','Vadodara','Technical institute'],
  ['inst-010','AICTE-DEMO-010','Metro College of Information Technology','Delhi','New Delhi','Private technical college'],
]
const CASES: Array<[string,string,string,string,string,string,string,string,string,number]> = [
  ['AC-2026-1001','Insufficient qualified faculty','inst-001','Faculty and staffing','demo-complainant','bureau-pgrc','demo-official','UNDER_PROCESS','HIGH',-4],
  ['AC-2026-1002','Teaching staff vacancies remain unfilled','inst-001','Faculty and staffing','demo-complainant-other','bureau-rb','demo-pgrc','UNDER_REVIEW','MEDIUM',17],
  ['AC-2026-1003','Poor quality of hostel food','inst-001','Student grievances','demo-complainant','bureau-pgrc','demo-official','UNDER_REVIEW','MEDIUM',20],
  ['AC-2026-1004','Inadequate laboratory equipment','inst-002','Infrastructure and facilities','demo-complainant','bureau-rb','demo-rb','AWAITING_INFORMATION','HIGH',-2],
  ['AC-2026-1005','No fire-safety certificate displayed','inst-002','Regulatory compliance','demo-complainant-other','bureau-pgrc','demo-pgrc','SUBMITTED','LOW',26],
  ['AC-2026-1006','Request to review examination results','inst-003','Student grievances','demo-complainant','bureau-pgrc','demo-official','UNDER_REVIEW','MEDIUM',15],
  ['AC-2026-1007','Unapproved programme advertised to students','inst-004','Regulatory compliance','demo-complainant','bureau-rb','demo-rb','ESCALATED','HIGH',-7],
  ['AC-2026-1008','Library access unavailable after class hours','inst-004','Infrastructure and facilities','demo-complainant-other','bureau-pgrc','demo-pgrc','UNDER_PROCESS','LOW',31],
  ['AC-2026-1009','Delayed faculty salary payments','inst-005','Faculty and staffing','demo-complainant','bureau-pgrc','demo-official','SUBMITTED','MEDIUM',23],
  ['AC-2026-1010','Campus accessibility barriers','inst-006','Infrastructure and facilities','demo-complainant','bureau-rb','demo-rb','UNDER_PROCESS','MEDIUM',14],
  ['AC-2026-1011','Missing mandatory disclosure on website','inst-006','Regulatory compliance','demo-complainant-other','bureau-pgrc','demo-pgrc','RESOLVED','LOW',-23],
  ['AC-2026-1012','Student grievance committee not active','inst-007','Institutional administration','demo-complainant','bureau-pgrc','demo-official','AWAITING_INFORMATION','MEDIUM',18],
  ['AC-2026-1013','Unclean drinking water in workshops','inst-008','Infrastructure and facilities','demo-complainant','bureau-rb','demo-rb','UNDER_REVIEW','HIGH',-1],
  ['AC-2026-1014','Academic calendar changed without notice','inst-008','Academic quality','demo-complainant-other','bureau-pgrc','demo-pgrc','TRANSFERRED','MEDIUM',21],
  ['AC-2026-1015','Unclear admission refund policy','inst-009','Institutional administration','demo-complainant','bureau-rb','demo-rb','UNDER_PROCESS','LOW',28],
  ['AC-2026-1016','Insufficient qualified instructors for courses','inst-009','Faculty and staffing','demo-complainant-other','bureau-pgrc','demo-pgrc','UNDER_REVIEW','HIGH',11],
  ['AC-2026-1017','Repeated power outages in computer labs','inst-010','Infrastructure and facilities','demo-complainant','bureau-rb','demo-rb','SUBMITTED','MEDIUM',30],
  ['AC-2026-1018','Student data privacy concern','inst-010','Regulatory compliance','demo-complainant-other','bureau-pgrc','demo-pgrc','UNDER_PROCESS','HIGH',-3],
  ['AC-2026-1019','Unqualified visiting faculty assigned to core courses','inst-001','Faculty and staffing','demo-complainant','bureau-rb','demo-rb','UNDER_REVIEW','HIGH',12],
  ['AC-2026-1020','Accessible transport not available','inst-003','Student grievances','demo-complainant-other','bureau-rb','demo-rb','CLOSED','LOW',-60],
  ['AC-2026-1021','Workshop tools are unsafe and outdated','inst-005','Infrastructure and facilities','demo-complainant','bureau-pgrc','demo-official','REJECTED','LOW',-33],
  ['AC-2026-1022','Faculty appointment records need verification','inst-007','Faculty and staffing','demo-complainant-other','bureau-rb','demo-rb','TRANSFERRED','MEDIUM',16],
]
const id = () => crypto.randomUUID()
const text = (value: unknown, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const words = (s: string) => new Set(normalize(s).split(' ').filter((w) => w.length > 3))
const tokenSimilarity = (a: string, b: string) => {
  const aa = words(a), bb = words(b), union = new Set([...aa, ...bb])
  return union.size ? [...aa].filter((w) => bb.has(w)).length / union.size : 0
}

import { hashPassword } from '../auth/crypto'

export const DEV_DEFAULT_PASSWORD = 'AcicsPassword#2026'

// Schema and seed work is idempotent, but running PBKDF2 and ~40 DDL statements
// on every request is wasteful. Guard once per database instance per isolate.
const ensured = new WeakSet<object>()

export async function ensureAcics(db: D1Database, env?: Env) {
  if (ensured.has(db as object)) return
  const synthetic = (env?.APP_ENV ?? 'development').toLowerCase() !== 'production'
  const schema = [
    `CREATE TABLE IF NOT EXISTS acics_bureaus (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, permitted_categories TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS acics_users (sub TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', bureau_id TEXT, password_hash TEXT, password_salt TEXT, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, active INTEGER NOT NULL DEFAULT 1, account_status TEXT NOT NULL DEFAULT 'ACTIVE', designation TEXT, institution_id TEXT, google_sub TEXT, requested_role TEXT, created_at INTEGER NOT NULL, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS acics_user_roles (user_sub TEXT NOT NULL, role TEXT NOT NULL, granted_by TEXT, granted_at INTEGER NOT NULL, PRIMARY KEY (user_sub, role))`,
    `CREATE INDEX IF NOT EXISTS acics_user_roles_role ON acics_user_roles(role)`,
    `CREATE INDEX IF NOT EXISTS acics_users_google ON acics_users(google_sub)`,
    `CREATE INDEX IF NOT EXISTS acics_users_status ON acics_users(account_status)`,
    `CREATE TABLE IF NOT EXISTS acics_sessions (id TEXT PRIMARY KEY, user_sub TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS acics_sessions_lookup ON acics_sessions(id, expires_at)`,
    `CREATE INDEX IF NOT EXISTS acics_sessions_user ON acics_sessions(user_sub)`,
    `CREATE TABLE IF NOT EXISTS acics_institutions (id TEXT PRIMARY KEY, official_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, state TEXT NOT NULL, district TEXT NOT NULL, institution_type TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS acics_complaints (id TEXT PRIMARY KEY, complaint_number TEXT UNIQUE NOT NULL, complainant_id TEXT NOT NULL, institution_id TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL, assigned_bureau_id TEXT, assigned_officer_id TEXT, due_at INTEGER NOT NULL, public_remarks TEXT NOT NULL DEFAULT '', submitted_at INTEGER NOT NULL, last_action_at INTEGER NOT NULL, resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS acics_complaints_person ON acics_complaints(complainant_id, submitted_at DESC)`,
    `CREATE INDEX IF NOT EXISTS acics_complaints_queue ON acics_complaints(assigned_bureau_id, assigned_officer_id, status, due_at)`,
    `CREATE INDEX IF NOT EXISTS acics_complaints_institution ON acics_complaints(institution_id, status)`,
    `CREATE TABLE IF NOT EXISTS acics_actions (id TEXT PRIMARY KEY, complaint_id TEXT NOT NULL, actor_id TEXT NOT NULL, action_type TEXT NOT NULL, previous_value TEXT, new_value TEXT, remarks TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'INTERNAL', created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS acics_actions_case ON acics_actions(complaint_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS acics_overlaps (id TEXT PRIMARY KEY, pair_key TEXT UNIQUE NOT NULL, case_a TEXT NOT NULL, case_b TEXT NOT NULL, institution_id TEXT NOT NULL, source_bureau_ids TEXT NOT NULL, rule_score REAL NOT NULL, semantic_score REAL, overall_score REAL NOT NULL, reasons TEXT NOT NULL, model_version TEXT, review_status TEXT NOT NULL, reviewed_by TEXT, reviewed_at INTEGER, review_notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS acics_notifications (id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, complaint_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS acics_attachments (id TEXT PRIMARY KEY, complaint_id TEXT NOT NULL, uploader_id TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, mime_type TEXT NOT NULL, storage_key TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS acics_attachments_case ON acics_attachments(complaint_id, created_at)`,
  ]
  await db.batch(schema.map((sql) => db.prepare(sql)))

  // Migrate columns if the table already existed without them.
  try {
    const userCols = await db.prepare(`PRAGMA table_info(acics_users)`).all<any>()
    const colNames = new Set((userCols.results || []).map((c: any) => c.name))
    const migrations: Array<[string, string]> = [
      ['password_hash', 'TEXT'],
      ['password_salt', 'TEXT'],
      ['failed_attempts', 'INTEGER NOT NULL DEFAULT 0'],
      ['locked_until', 'INTEGER'],
      ['account_status', "TEXT NOT NULL DEFAULT 'ACTIVE'"],
      ['designation', 'TEXT'],
      ['institution_id', 'TEXT'],
      ['google_sub', 'TEXT'],
      ['requested_role', 'TEXT'],
      ['updated_at', 'INTEGER'],
    ]
    for (const [name, type] of migrations) {
      if (!colNames.has(name)) {
        await db.prepare(`ALTER TABLE acics_users ADD COLUMN ${name} ${type}`).run()
      }
    }
  } catch {
    // Column alter fallback
  }

  // Backfill passwords, statuses, and the role join table for legacy databases.
  // The default development password is only applied outside production, so a
  // password-less production account can never inherit a known credential.
  try {
    if (synthetic) {
      const defaultCreds = await hashPassword(DEV_DEFAULT_PASSWORD)
      await db.prepare(`UPDATE acics_users SET password_hash=?, password_salt=? WHERE password_hash IS NULL`)
        .bind(defaultCreds.hash, defaultCreds.salt)
        .run()
    }
    await db.prepare(`UPDATE acics_users SET account_status='ACTIVE' WHERE account_status IS NULL OR account_status=''`).run()
    await db.prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub, role, granted_at) SELECT sub, role, created_at FROM acics_users WHERE role IS NOT NULL AND role <> ''`).run()
  } catch {
    // Ignore update error
  }

  const exists = await db.prepare('SELECT sub FROM acics_users LIMIT 1').first()
  if (exists) {
    ensured.add(db as object)
    return
  }
  const now = Date.now()
  const inserts: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO acics_bureaus (id,code,name,permitted_categories,created_at) VALUES (?,?,?,?,?)`).bind('bureau-pgrc','PGRC','Public Grievance Redressal Cell',JSON.stringify(CATEGORIES),now),
    db.prepare(`INSERT OR IGNORE INTO acics_bureaus (id,code,name,permitted_categories,created_at) VALUES (?,?,?,?,?)`).bind('bureau-rb','RB','Regulation Bureau',JSON.stringify(CATEGORIES),now),
    db.prepare(`INSERT OR IGNORE INTO acics_bureaus (id,code,name,permitted_categories,created_at) VALUES (?,?,?,?,?)`).bind('bureau-academic','ACADEMIC','Academic Coordination Cell',JSON.stringify(CATEGORIES),now),
  ]
  // Synthetic identities, complaints, and institutions exist for local
  // demonstration and automated tests only. Production starts with reference
  // bureaus and whoever the first-administrator bootstrap creates.
  if (synthetic) {
    const defaultCreds = await hashPassword(DEV_DEFAULT_PASSWORD)
    for (const user of DEMO_USERS) {
      inserts.push(
        db.prepare(`INSERT OR IGNORE INTO acics_users (sub,full_name,email,role,bureau_id,password_hash,password_salt,failed_attempts,locked_until,active,account_status,designation,institution_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,NULL,1,'ACTIVE',?,?,?,?)`)
          .bind(user.sub, user.name, user.email, user.role, user.bureauId, defaultCreds.hash, defaultCreds.salt, user.designation, user.institutionId, now, now)
      )
      for (const role of user.roles) {
        inserts.push(
          db.prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub, role, granted_by, granted_at) VALUES (?,?,?,?)`)
            .bind(user.sub, role, 'seed', now)
        )
      }
    }
    for (const user of PENDING_USERS) {
      inserts.push(
        db.prepare(`INSERT OR IGNORE INTO acics_users (sub,full_name,email,role,bureau_id,password_hash,password_salt,failed_attempts,locked_until,active,account_status,designation,institution_id,requested_role,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,0,NULL,1,?,?,?,?,?,?)`)
          .bind(user.sub, user.name, user.email, user.role, defaultCreds.hash, defaultCreds.salt, user.status, user.designation, user.institutionId, user.status === 'PENDING_APPROVAL' ? 'COMPLAINANT' : null, now, now)
      )
      if (user.role) {
        inserts.push(
          db.prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub, role, granted_by, granted_at) VALUES (?,?,?,?)`)
            .bind(user.sub, user.role, 'seed', now)
        )
      }
    }
    for (const [id,officialId,name,state,district,type] of INSTITUTIONS) inserts.push(db.prepare(`INSERT OR IGNORE INTO acics_institutions (id,official_id,name,normalized_name,state,district,institution_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,officialId,name,normalize(name),state,district,type,now,now))
    for (let i=0;i<CASES.length;i++) {
      const [number,subject,institutionId,category,complainantId,bureauId,officerId,status,priority,dueOffset] = CASES[i]
      const submitted = now - (38 - i) * DAY
      const complaintId = `case-demo-${String(i+1).padStart(3,'0')}`
      const description = demoDescription(subject, category, i)
      inserts.push(db.prepare(`INSERT OR IGNORE INTO acics_complaints (id,complaint_number,complainant_id,institution_id,subject,description,category,priority,status,assigned_bureau_id,assigned_officer_id,due_at,public_remarks,submitted_at,last_action_at,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(complaintId,number,complainantId,institutionId,subject,description,category,priority,status,bureauId,officerId,now+dueOffset*DAY,status==='AWAITING_INFORMATION'?'Please provide supporting details using the case response option.':'',submitted,now-(i%5)*DAY,['RESOLVED','CLOSED'].includes(status)?now-(i%12+1)*DAY:null,submitted,now-(i%5)*DAY))
      if (i % 2 === 0) inserts.push(db.prepare(`INSERT OR IGNORE INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(`action-demo-${i+1}`,complaintId,officerId,'STATUS_CHANGED','SUBMITTED',status,'Case updated as part of synthetic demonstration history.','PUBLIC',now-(i%5+1)*DAY))
    }
    inserts.push(db.prepare(`INSERT OR IGNORE INTO acics_attachments (id,complaint_id,uploader_id,file_name,file_size,mime_type,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind('att-demo-001','case-demo-001','demo-complainant','faculty_vacancy_schedule.pdf',142850,'application/pdf','acics/case-demo-001/att-demo-001-faculty_vacancy_schedule.pdf',now-5*DAY))
  }
  await db.batch(inserts)
  if (synthetic) {
    await createOverlap(db,'case-demo-001','case-demo-002','PENDING',now)
    await createOverlap(db,'case-demo-001','case-demo-003','REJECTED',now-2*DAY,'Different category and issue; example false positive for human review.')
    await createOverlap(db,'case-demo-001','case-demo-019','CONFIRMED',now-4*DAY,'Related faculty reports retained as separate cases.')
    await db.prepare(`INSERT OR IGNORE INTO acics_notifications (id,recipient_id,complaint_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?)`).bind('notice-demo-1','demo-complainant','case-demo-001','STATUS_CHANGED','Complaint under review','Your complaint AC-2026-1001 is being processed.',now-2*DAY).run()
  }
  ensured.add(db as object)
}

const SYNTHETIC_SUBS = new Set([...DEMO_USERS.map((user) => user.sub), ...PENDING_USERS.map((user) => user.sub)])

/** True for the clearly-labelled synthetic identities used by local demos, development access, and tests. */
export function isSyntheticIdentity(sub: string): boolean {
  return SYNTHETIC_SUBS.has(sub) || sub.startsWith('dev-')
}

const bootstrapped = new WeakSet<object>()

/**
 * Creates the first administrator from environment configuration on a fresh
 * deployment. There is no registration endpoint: the account is written once,
 * only while no administrator exists, and the variables can be removed
 * afterwards. Guarded by a per-isolate WeakSet so it costs one query per cold
 * start, not per request.
 */
export async function ensureBootstrapAdmin(env: Env, db: D1Database) {
  if (bootstrapped.has(db as object)) return
  const email = env.ACICS_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  const password = env.ACICS_BOOTSTRAP_ADMIN_PASSWORD
  if (!email || !password) return
  await ensureAcics(db, env)
  try {
    const existing = await db.prepare(`SELECT user_sub FROM acics_user_roles WHERE role='ADMIN' LIMIT 1`).first()
    if (existing) {
      bootstrapped.add(db as object)
      return
    }
    if (password.length < 12) {
      console.warn('[acics] ACICS_BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters; bootstrap skipped.')
      bootstrapped.add(db as object)
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.warn('[acics] ACICS_BOOTSTRAP_ADMIN_EMAIL is not a valid address; bootstrap skipped.')
      bootstrapped.add(db as object)
      return
    }
    const name = (env.ACICS_BOOTSTRAP_ADMIN_NAME || '').trim().slice(0, 120) || 'ACICS Administrator'
    const sub = 'admin-bootstrap'
    const { hash, salt } = await hashPassword(password)
    const now = Date.now()
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO acics_users (sub,full_name,email,role,bureau_id,password_hash,password_salt,failed_attempts,locked_until,active,account_status,designation,institution_id,created_at,updated_at) VALUES (?,?,?,'ADMIN',NULL,?,?,0,NULL,1,'ACTIVE','Portal Administrator',NULL,?,?)`)
        .bind(sub, name, email, hash, salt, now, now),
      db.prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub, role, granted_by, granted_at) VALUES (?,'ADMIN','bootstrap',?)`)
        .bind(sub, now),
      db.prepare(`INSERT OR IGNORE INTO acics_actions (id, complaint_id, actor_id, action_type, previous_value, new_value, remarks, visibility, created_at) VALUES (?, 'SYSTEM', ?, 'ADMIN_BOOTSTRAPPED', NULL, 'ADMIN', ?, 'INTERNAL', ?)`)
        .bind('action-bootstrap-admin', sub, `Bootstrapped administrator ${email}`, now),
    ])
    const created = await db.prepare(`SELECT sub FROM acics_users WHERE sub=?`).bind(sub).first()
    if (created) console.warn(`[acics] Bootstrapped first administrator ${email}. Remove ACICS_BOOTSTRAP_ADMIN_PASSWORD from the environment now.`)
    bootstrapped.add(db as object)
  } catch (error) {
    console.error('[acics] Administrator bootstrap failed:', (error as Error).message)
  }
}

export const inMemoryFiles = new Map<string, { buffer: Uint8Array; mime: string; name: string }>()
inMemoryFiles.set('acics/case-demo-001/att-demo-001-faculty_vacancy_schedule.pdf', {
  buffer: new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Title (Faculty Vacancy Schedule) /Creator (AICTE ACICS) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'),
  mime: 'application/pdf',
  name: 'faculty_vacancy_schedule.pdf',
})

function calculateDueAt(category: string, priority: string, now = Date.now()): number {
  let days = 30
  if (category === 'Student grievances') days = 15
  else if (category === 'Regulatory compliance') days = 21
  else if (category === 'Infrastructure and facilities') days = 25
  else if (category === 'Faculty and staffing') days = 30
  if (priority === 'HIGH') days = Math.max(7, Math.floor(days * 0.6))
  else if (priority === 'LOW') days = Math.floor(days * 1.3)
  return now + days * DAY
}
function demoDescription(subject:string,category:string,i:number) {
  if (i===0) return 'The institution has too few qualified faculty members for the approved programme. Several core courses are being handled without appropriately qualified teaching staff.'
  if (i===1) return 'The college does not have enough qualified teaching staff. Vacant faculty positions mean core subjects are covered by instructors without the required qualifications.'
  if (i===2) return 'Students have raised concerns about the quality and hygiene of meals served in the campus hostel. This concerns food service, not staffing.'
  return `${subject}. This synthetic ${category.toLowerCase()} report requests review of the described institution matter and appropriate follow-up. Supporting details are available for authorized review.`
}
async function createOverlap(db:D1Database,a:string,b:string,status='PENDING',createdAt=Date.now(),notes='') {
  const pair=[a,b].sort(),pairKey=pair.join(':')
  const rows=await db.prepare(`SELECT id,complaint_number,institution_id,subject,description,category,assigned_bureau_id FROM acics_complaints WHERE id IN (?,?)`).bind(a,b).all<any>()
  if(rows.results.length!==2)return
  const [x,y]=rows.results
  const sameId=Number(x.institution_id===y.institution_id)
  const cat=Number(x.category===y.category)
  const similarity=tokenSimilarity(x.description,y.description)
  const score=Number((sameId*.4+cat*.2+similarity*.4).toFixed(4))
  const reasons=[sameId?'Exact verified institution identifier match':'',cat?'Same complaint category':'',similarity>.12?`Shared keywords in descriptions (${Math.round(similarity*100)}% Jaccard overlap)`:'',x.assigned_bureau_id!==y.assigned_bureau_id?'Cases are assigned to different bureaus':''].filter(Boolean)
  await db.prepare(`INSERT OR IGNORE INTO acics_overlaps (id,pair_key,case_a,case_b,institution_id,source_bureau_ids,rule_score,overall_score,reasons,review_status,review_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`overlap-${pairKey}`,pairKey,pair[0],pair[1],x.institution_id,JSON.stringify([x.assigned_bureau_id,y.assigned_bureau_id]),score,score,JSON.stringify(reasons),status,notes,createdAt,createdAt).run()
}
function canSeeCase(user:any,caseRow:any) {
  if(user.role==='ADMIN')return true
  if(user.role==='COMPLAINANT')return caseRow.complainant_id===user.sub
  if(user.role==='OFFICIAL')return caseRow.assigned_officer_id===user.sub || !caseRow.assigned_officer_id
  if(user.role==='BUREAU_OFFICER')return caseRow.assigned_bureau_id===user.bureauId
  return false
}
async function caseRow(db:D1Database,id:string) {
  return db.prepare(`SELECT c.*,i.official_id AS institution_official_id,i.name AS institution_name,i.state AS institution_state,i.district AS institution_district,i.institution_type,b.name AS bureau_name,b.code AS bureau_code FROM acics_complaints c JOIN acics_institutions i ON i.id=c.institution_id LEFT JOIN acics_bureaus b ON b.id=c.assigned_bureau_id WHERE c.id=? OR c.complaint_number=?`).bind(id,id).first<any>()
}
function mapCase(row:any,user:any) {
  const complainant=user.role==='COMPLAINANT'
  const now = Date.now()
  const daysLeft = Math.round((row.due_at - now) / DAY)
  return {id:row.id,complaintNumber:row.complaint_number,subject:row.subject,description:row.description,category:row.category,priority:row.priority,status:row.status,institution:{id:row.institution_id,officialId:row.institution_official_id,name:row.institution_name,state:row.institution_state,district:row.institution_district,type:row.institution_type},assignedBureau:complainant?null:{id:row.assigned_bureau_id,name:row.bureau_name,code:row.bureau_code},assignedOfficer:complainant?null:row.assigned_officer_id,dueAt:row.due_at,daysLeft,overdue:!['RESOLVED','CLOSED','REJECTED'].includes(row.status)&&row.due_at<now,publicRemarks:row.public_remarks,submittedAt:row.submitted_at,lastActionAt:row.last_action_at,resolvedAt:row.resolved_at,complainantId:complainant?undefined:row.complainant_id}
}
export const acics = new Hono<AppContext>()

// Authorization gate for every ACICS route: the identity must have a
// provisioned account, the account must be active, and any portal requested
// through the x-acics-portal header must be one the account actually holds.
acics.use('*', async (c, next) => {
  const db = c.get('db')
  const account = await loadAccount(db, c.get('user').sub)
  if (!account) {
    return c.json({ error: 'No ACICS account is linked to this identity. Request access or contact your administrator.', code: 'ACCOUNT_NOT_PROVISIONED' }, 403)
  }
  if (account.accountStatus !== 'ACTIVE') {
    return c.json({ error: accountStatusMessage(account.accountStatus), code: `ACCOUNT_${account.accountStatus}` }, 403)
  }
  const resolved = resolveActiveRole(account, c.req.raw)
  if (resolved.denied) {
    return c.json({ error: resolved.denied.message, code: resolved.denied.code }, 403)
  }
  if (!resolved.role) {
    return c.json({ error: 'This account has no portal role assigned. Contact your ACICS administrator.', code: 'ACCOUNT_NO_ROLE' }, 403)
  }
  c.set('account', account)
  c.set('activeRole', resolved.role)
  c.set('activePortal', resolved.portal)
  c.set('profile', {
    ...account,
    role: resolved.role,
    bureau_id: account.bureauId,
    bureau_name: account.bureauName,
    bureau_code: account.bureauCode,
    full_name: account.fullName,
  })
  await next()
})

acics.get('/me',async c=>{
  const profile=c.get('profile')
  return privateJson(c,{
    user:{sub:profile.sub,name:profile.fullName,email:profile.email},
    role:profile.role,
    roles:profile.roles,
    accountStatus:profile.accountStatus,
    designation:profile.designation,
    institution:profile.institutionId?{id:profile.institutionId,name:profile.institutionName}:null,
    bureau:profile.bureauId?{id:profile.bureauId,name:profile.bureauName,code:profile.bureauCode}:null,
    demo:profile.demo,
    activePortal:c.get('activePortal'),
  })
})
acics.get('/categories',c=>privateJson(c,{items:CATEGORIES,prototypeDefaults:true}))
acics.get('/bureaus',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role==='COMPLAINANT')return c.json({error:'Bureau directory is not available to complainants.'},403)
  const rows=await db.prepare(`SELECT b.id,b.code,b.name,b.active,b.permitted_categories AS permittedCategories,COUNT(c.id) AS caseCount FROM acics_bureaus b LEFT JOIN acics_complaints c ON c.assigned_bureau_id=b.id ${profile.role==='BUREAU_OFFICER'?'AND c.assigned_bureau_id=?':''} GROUP BY b.id ORDER BY b.name`).bind(...(profile.role==='BUREAU_OFFICER'?[profile.bureau_id]:[])).all<any>()
  return privateJson(c,{items:rows.results.map(row=>({...row,permittedCategories:JSON.parse(row.permittedCategories)}))})
})
acics.get('/complaints',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  let sql=`SELECT c.*,i.official_id AS institution_official_id,i.name AS institution_name,i.state AS institution_state,i.district AS institution_district,i.institution_type,b.name AS bureau_name,b.code AS bureau_code FROM acics_complaints c JOIN acics_institutions i ON i.id=c.institution_id LEFT JOIN acics_bureaus b ON b.id=c.assigned_bureau_id WHERE 1=1`
  const args:unknown[]=[]
  if(profile.role==='COMPLAINANT'){
    sql+=' AND c.complainant_id=?';args.push(profile.sub)
  }else if(profile.role==='OFFICIAL'){
    const scope=c.req.query('scope')||'assigned'
    if(scope==='unassigned'){
      sql+=' AND c.assigned_officer_id IS NULL'
    }else if(scope==='all'){
      // all cases
    }else{
      sql+=' AND c.assigned_officer_id=?';args.push(profile.sub)
    }
  }else if(profile.role==='BUREAU_OFFICER'){
    const scope=c.req.query('scope')||'bureau'
    if(scope==='unassigned'){
      sql+=' AND c.assigned_bureau_id=? AND c.assigned_officer_id IS NULL';args.push(profile.bureau_id)
    }else{
      sql+=' AND c.assigned_bureau_id=?';args.push(profile.bureau_id)
    }
  }
  const q=text(c.req.query('q'),100); if(q){sql+=' AND (c.complaint_number LIKE ? OR c.subject LIKE ? OR i.name LIKE ?)';args.push(`%${q}%`,`%${q}%`,`%${q}%`)}
  const status=text(c.req.query('status'),32);if(status){sql+=' AND c.status=?';args.push(status)}
  const category=text(c.req.query('category'),80);if(category){sql+=' AND c.category=?';args.push(category)}
  const priority=text(c.req.query('priority'),20);if(priority){sql+=' AND c.priority=?';args.push(priority)}
  if(c.req.query('overdue')==='true')sql+=` AND c.due_at<${Date.now()} AND c.status NOT IN ('RESOLVED','CLOSED','REJECTED')`
  const page=Math.max(1,Number(c.req.query('page'))||1),size=Math.min(50,Math.max(1,Number(c.req.query('pageSize'))||12))
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM (${sql})`).bind(...args).first<any>()
  const rows=await db.prepare(`${sql} ORDER BY c.submitted_at DESC LIMIT ? OFFSET ?`).bind(...args,size,(page-1)*size).all<any>()
  return privateJson(c,{items:rows.results.map(r=>mapCase(r,profile)),total:Number(count?.total||0),page,pageSize:size})
})
acics.post('/complaints',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role!=='COMPLAINANT')return c.json({error:'Only complainants can submit a complaint.'},403)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const subject=text(body.subject,180),description=text(body.description,5000),category=text(body.category,80),officialId=text(body.institutionOfficialId||body.institutionId,80),priority=text(body.priority||'MEDIUM',20)
  if(!CATEGORIES.includes(category))return c.json({error:'Select a valid complaint category.'},400)
  if(subject.length<8||description.length<30||!officialId)return c.json({error:'Provide a subject (at least 8 characters), a description (at least 30 characters), a category, and an institution identifier.'},400)
  const inst=await db.prepare(`SELECT id FROM acics_institutions WHERE official_id=? AND active=1`).bind(officialId).first<any>()
  if(!inst)return c.json({error:'Institution identifier was not found in the synthetic directory. Ask an administrator to add the institution.'},400)
  const complaintId=id(),number=`AC-${new Date().getUTCFullYear()}-${Math.floor(100000+Math.random()*900000)}`,now=Date.now(),bureau=category==='Regulatory compliance'?'bureau-rb':'bureau-pgrc',due=calculateDueAt(category,priority,now)
  await db.prepare(`INSERT INTO acics_complaints (id,complaint_number,complainant_id,institution_id,subject,description,category,priority,status,assigned_bureau_id,assigned_officer_id,due_at,submitted_at,last_action_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(complaintId,number,profile.sub,inst.id,subject,description,category,priority,'SUBMITTED',bureau,null,due,now,now,now,now).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),complaintId,profile.sub,'COMPLAINT_SUBMITTED','SUBMITTED','Complaint submitted through the complainant portal.','PUBLIC',now).run()
  await db.prepare(`INSERT INTO acics_notifications (id,recipient_id,complaint_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id(),profile.sub,complaintId,'SUBMITTED','Complaint received',`Your complaint ${number} has been received.`,now).run()
  const candidates=await db.prepare(`SELECT id,description,category,assigned_bureau_id FROM acics_complaints WHERE institution_id=? AND id<>? AND assigned_bureau_id<>? AND status NOT IN ('CLOSED','RESOLVED','REJECTED')`).bind(inst.id,complaintId,bureau).all<any>()
  for(const candidate of candidates.results){const sim=tokenSimilarity(description,candidate.description),sameCategory=category===candidate.category,score=.4+.2*Number(sameCategory)+.4*sim;if(score>=.52){const pair=[complaintId,candidate.id].sort(),reasons=['Exact verified institution identifier match',...(sameCategory?['Same complaint category']:[]),...(sim>.05?[`Shared descriptive keywords (${Math.round(sim*100)}% token overlap)`]:[]),'Complaints are assigned to different bureaus'];await db.prepare(`INSERT OR IGNORE INTO acics_overlaps (id,pair_key,case_a,case_b,institution_id,source_bureau_ids,rule_score,overall_score,reasons,review_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).bind(`overlap-${pair.join(':')}`,pair.join(':'),pair[0],pair[1],inst.id,JSON.stringify([bureau,candidate.assigned_bureau_id]),score,score,JSON.stringify(reasons),now,now).run()}}
  return privateJson(c,{item:{id:complaintId,complaintNumber:number,status:'SUBMITTED'},message:'Complaint submitted. Save the reference number to track your case.'},201)
})
acics.get('/complaints/:id',async c=>{
  const db=c.get('db'),profile=c.get('profile'),row=await caseRow(db,c.req.param('id'))
  if(!row)return c.json({error:'Complaint not found.'},404)
  if(!canSeeCase(profile,row))return c.json({error:'You do not have permission to view this complaint.'},403)
  const actions=await db.prepare(`SELECT a.id,a.actor_id,a.action_type,a.previous_value,a.new_value,a.remarks,a.visibility,a.created_at,u.full_name AS actor_name FROM acics_actions a LEFT JOIN acics_users u ON u.sub=a.actor_id WHERE a.complaint_id=? ${profile.role==='COMPLAINANT'?"AND a.visibility='PUBLIC'":''} ORDER BY a.created_at ASC`).bind(row.id).all<any>()
  const related=profile.role==='COMPLAINANT'?[]:(await db.prepare(`SELECT o.id,o.case_a,o.case_b,o.overall_score,o.reasons,o.review_status FROM acics_overlaps o WHERE o.case_a=? OR o.case_b=?`).bind(row.id,row.id).all<any>()).results
  const attachments=await db.prepare(`SELECT id, file_name AS fileName, file_size AS fileSize, mime_type AS mimeType, created_at AS createdAt FROM acics_attachments WHERE complaint_id=? ORDER BY created_at ASC`).bind(row.id).all<any>()
  return privateJson(c,{item:mapCase(row,profile),actions:actions.results.map(a=>({id:a.id,actor:a.actor_name||'System',actionType:a.action_type,previousValue:a.previous_value,newValue:a.new_value,remarks:a.remarks,visibility:a.visibility,createdAt:a.created_at})),related,attachments:attachments.results})
})
acics.patch('/complaints/:id/status',async c=>{
  const db=c.get('db'),profile=c.get('profile'),row=await caseRow(db,c.req.param('id'))
  if(!row)return c.json({error:'Complaint not found.'},404)
  if(!canSeeCase(profile,row))return c.json({error:'You do not have permission to update this complaint.'},403)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const next=text(body.status,32),remarks=text(body.remarks,1000),visibility=body.visibility==='PUBLIC'?'PUBLIC':'INTERNAL'
  if(profile.role==='COMPLAINANT'){
    if(row.status!=='AWAITING_INFORMATION'||next!=='UNDER_PROCESS'){
      return c.json({error:'Complainants can only return a case from awaiting information to under process.'},403)
    }
  }
  if(!STATUSES.includes(next as any))return c.json({error:'Unknown case status.'},400)
  if(!(transitions[row.status]||[]).includes(next))return c.json({error:`Transition from ${row.status} to ${next} is not allowed.`},409)

  let targetBureauId: string | null = null
  if(next==='TRANSFERRED'){
    targetBureauId = body.targetBureauId ? text(body.targetBureauId,64) : null
    if(!targetBureauId) return c.json({error:'Target bureau is required when transferring a case.'},400)
    const targetBureau = await db.prepare(`SELECT id, name FROM acics_bureaus WHERE id=? AND active=1`).bind(targetBureauId).first<any>()
    if(!targetBureau) return c.json({error:'Target bureau was not found or is inactive.'},400)
  }

  const now=Date.now()
  const updatedBureau = next==='TRANSFERRED' ? targetBureauId : row.assigned_bureau_id
  const updatedOfficer = next==='TRANSFERRED' ? null : row.assigned_officer_id

  await db.prepare(`UPDATE acics_complaints SET status=?,assigned_bureau_id=?,assigned_officer_id=?,public_remarks=CASE WHEN ?='PUBLIC' AND ?<>'' THEN ? ELSE public_remarks END,last_action_at=?,resolved_at=CASE WHEN ?='RESOLVED' THEN ? WHEN ?='UNDER_PROCESS' AND resolved_at IS NOT NULL THEN NULL ELSE resolved_at END,updated_at=? WHERE id=?`).bind(next,updatedBureau,updatedOfficer,visibility,remarks,remarks,now,next,now,next,now,row.id).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),row.id,profile.sub,'STATUS_CHANGED',row.status,next,remarks,visibility,now).run()

  if(next==='TRANSFERRED'){
    await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),row.id,profile.sub,'BUREAU_TRANSFERRED',row.assigned_bureau_id,targetBureauId,remarks||'Case transferred to another bureau.','INTERNAL',now).run()
  }

  await db.prepare(`INSERT INTO acics_notifications (id,recipient_id,complaint_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id(),row.complainant_id,row.id,'STATUS_CHANGED','Case status updated',`Your complaint ${row.complaint_number} is now ${next.replaceAll('_',' ').toLowerCase()}.`,now).run()
  return privateJson(c,{ok:true,status:next,assignedBureauId:updatedBureau,assignedOfficerId:updatedOfficer})
})
acics.patch('/complaints/:id/assign',async c=>{
  const db=c.get('db'),profile=c.get('profile'),row=await caseRow(db,c.req.param('id'))
  if(!row)return c.json({error:'Complaint not found.'},404)
  if(!['ADMIN','BUREAU_OFFICER','OFFICIAL'].includes(profile.role))return c.json({error:'Unauthorized to assign cases.'},403)
  if(profile.role==='BUREAU_OFFICER'&&row.assigned_bureau_id!==profile.bureau_id){
    return c.json({error:'Bureau officers can only assign cases within their assigned bureau.'},403)
  }
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const officerId=body.officerId?text(body.officerId,64):null
  const bureauId=body.bureauId?text(body.bureauId,64):null
  const remarks=text(body.remarks,500)
  const now=Date.now()

  let newOfficerId=row.assigned_officer_id
  let newBureauId=row.assigned_bureau_id

  if(officerId!==undefined){
    if(officerId){
      const officer=await db.prepare(`SELECT sub,full_name,role,bureau_id,active FROM acics_users WHERE sub=?`).bind(officerId).first<any>()
      if(!officer||!officer.active)return c.json({error:'Selected officer does not exist or is inactive.'},400)
      if(!['OFFICIAL','BUREAU_OFFICER','ADMIN'].includes(officer.role))return c.json({error:'Assigned user must be staff.'},400)
      newOfficerId=officer.sub
    }else{
      newOfficerId=null
    }
  }

  if(bureauId&&(profile.role==='ADMIN'||profile.role==='BUREAU_OFFICER')){
    const b=await db.prepare(`SELECT id FROM acics_bureaus WHERE id=? AND active=1`).bind(bureauId).first<any>()
    if(!b)return c.json({error:'Bureau not found.'},400)
    newBureauId=b.id
  }

  await db.prepare(`UPDATE acics_complaints SET assigned_officer_id=?,assigned_bureau_id=?,last_action_at=?,updated_at=? WHERE id=?`).bind(newOfficerId,newBureauId,now,now,row.id).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),row.id,profile.sub,'OFFICER_ASSIGNED',row.assigned_officer_id,newOfficerId,remarks||'Case assignment updated.','INTERNAL',now).run()

  if(newOfficerId&&newOfficerId!==row.assigned_officer_id){
    await db.prepare(`INSERT INTO acics_notifications (id,recipient_id,complaint_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id(),newOfficerId,row.id,'ASSIGNMENT','Case assigned',`Complaint ${row.complaint_number} has been assigned to you.`,now).run()
  }

  return privateJson(c,{ok:true,assignedOfficerId:newOfficerId,assignedBureauId:newBureauId})
})
acics.get('/institutions-list',async c=>{
  const db=c.get('db')
  const q=text(c.req.query('q'),100),like=`%${q}%`
  const rows=await db.prepare(`SELECT id,official_id AS officialId,name,state,district,institution_type AS type FROM acics_institutions WHERE active=1 AND (?='' OR name LIKE ? OR official_id LIKE ?) ORDER BY name LIMIT 100`).bind(q,like,like).all<any>()
  return privateJson(c,{items:rows.results})
})
acics.get('/officers',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role==='COMPLAINANT')return c.json({error:'Staff directory is not available to complainants.'},403)
  const rows=await db.prepare(`SELECT u.sub,u.full_name AS fullName,u.role,u.bureau_id AS bureauId,b.code AS bureauCode FROM acics_users u LEFT JOIN acics_bureaus b ON b.id=u.bureau_id WHERE u.active=1 AND u.role IN ('OFFICIAL','BUREAU_OFFICER','ADMIN') ORDER BY u.full_name`).all<any>()
  return privateJson(c,{items:rows.results})
})
acics.post('/complaints/:id/actions',async c=>{
  const db=c.get('db'),profile=c.get('profile'),row=await caseRow(db,c.req.param('id'))
  if(!row)return c.json({error:'Complaint not found.'},404)
  if(!canSeeCase(profile,row))return c.json({error:'You do not have permission to respond to this complaint.'},403)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const remarks=text(body.remarks,1500);if(remarks.length<3)return c.json({error:'Enter a response of at least 3 characters.'},400)
  const visibility=profile.role==='COMPLAINANT'?'PUBLIC':body.visibility==='PUBLIC'?'PUBLIC':'INTERNAL',now=Date.now()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id(),row.id,profile.sub,profile.role==='COMPLAINANT'?'COMPLAINANT_RESPONSE':'OFFICIAL_REMARK',remarks,visibility,now).run()
  await db.prepare(`UPDATE acics_complaints SET last_action_at=?,updated_at=? WHERE id=?`).bind(now,now,row.id).run()
  const recipient=profile.role==='COMPLAINANT'?(row.assigned_officer_id||'demo-admin'):row.complainant_id
  await db.prepare(`INSERT INTO acics_notifications (id,recipient_id,complaint_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id(),recipient,row.id,'RESPONSE',profile.role==='COMPLAINANT'?'Complainant response received':'New case update',profile.role==='COMPLAINANT'?`A response was added to ${row.complaint_number}.`:`An update was added to ${row.complaint_number}.`,now).run()
  return privateJson(c,{ok:true},201)
})
acics.get('/institutions',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role==='COMPLAINANT')return c.json({error:'Institution directory is not available to complainants.'},403)
  const q=text(c.req.query('q'),100),like=`%${q}%`
  const rows=await db.prepare(`SELECT i.id,i.official_id AS officialId,i.name,i.state,i.district,i.institution_type AS type,COUNT(c.id) AS complaintCount,SUM(CASE WHEN c.status NOT IN ('RESOLVED','CLOSED','REJECTED') THEN 1 ELSE 0 END) AS openCount FROM acics_institutions i LEFT JOIN acics_complaints c ON c.institution_id=i.id ${profile.role==='BUREAU_OFFICER'?'AND c.assigned_bureau_id=?':''} WHERE (?='' OR i.name LIKE ? OR i.official_id LIKE ?) GROUP BY i.id ORDER BY i.name LIMIT 100`).bind(...(profile.role==='BUREAU_OFFICER'?[profile.bureau_id,q,like,like]:[q,like,like])).all<any>()
  return privateJson(c,{items:rows.results})
})
acics.get('/institutions/:id',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role==='COMPLAINANT')return c.json({error:'Institution directory is not available to complainants.'},403)
  const institution=await db.prepare(`SELECT id,official_id AS officialId,name,state,district,institution_type AS type FROM acics_institutions WHERE id=? OR official_id=?`).bind(c.req.param('id'),c.req.param('id')).first<any>()
  if(!institution)return c.json({error:'Institution not found.'},404)
  let sql=`SELECT c.*,i.official_id AS institution_official_id,i.name AS institution_name,i.state AS institution_state,i.district AS institution_district,i.institution_type,b.name AS bureau_name,b.code AS bureau_code FROM acics_complaints c JOIN acics_institutions i ON i.id=c.institution_id LEFT JOIN acics_bureaus b ON b.id=c.assigned_bureau_id WHERE c.institution_id=?`,args:any[]=[institution.id]
  if(profile.role==='BUREAU_OFFICER'){sql+=' AND c.assigned_bureau_id=?';args.push(profile.bureau_id)}else if(profile.role==='OFFICIAL'){sql+=' AND c.assigned_officer_id=?';args.push(profile.sub)}
  const cases=await db.prepare(`${sql} ORDER BY c.submitted_at DESC`).bind(...args).all<any>()
  return privateJson(c,{institution,cases:cases.results.map(r=>mapCase(r,profile))})
})
acics.get('/overlaps',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role==='COMPLAINANT')return c.json({error:'Overlap review is restricted to authorized staff.'},403)
  let sql=`SELECT o.*,a.complaint_number AS number_a,a.subject AS subject_a,a.description AS description_a,a.category AS category_a,a.status AS status_a,a.assigned_bureau_id AS bureau_a,ba.code AS bureau_code_a,b.complaint_number AS number_b,b.subject AS subject_b,b.description AS description_b,b.category AS category_b,b.status AS status_b,b.assigned_bureau_id AS bureau_b,bb.code AS bureau_code_b,i.official_id AS institution_official_id,i.name AS institution_name FROM acics_overlaps o JOIN acics_complaints a ON a.id=o.case_a JOIN acics_complaints b ON b.id=o.case_b JOIN acics_institutions i ON i.id=o.institution_id LEFT JOIN acics_bureaus ba ON ba.id=a.assigned_bureau_id LEFT JOIN acics_bureaus bb ON bb.id=b.assigned_bureau_id WHERE 1=1`,args:any[]=[]
  if(profile.role==='BUREAU_OFFICER'){sql+=' AND (a.assigned_bureau_id=? OR b.assigned_bureau_id=?)';args.push(profile.bureau_id,profile.bureau_id)}else if(profile.role==='OFFICIAL'){sql+=' AND (a.assigned_officer_id=? OR b.assigned_officer_id=?)';args.push(profile.sub,profile.sub)}
  const review=text(c.req.query('status'),20);if(review){sql+=' AND o.review_status=?';args.push(review)}
  const rows=await db.prepare(`${sql} ORDER BY CASE o.review_status WHEN 'PENDING' THEN 0 ELSE 1 END,o.created_at DESC LIMIT 100`).bind(...args).all<any>()
  return privateJson(c,{items:rows.results.map(o=>({id:o.id,caseA:{id:o.case_a,number:o.number_a,subject:o.subject_a,description:o.description_a,category:o.category_a,status:o.status_a,bureau:o.bureau_code_a},caseB:{id:o.case_b,number:o.number_b,subject:o.subject_b,description:o.description_b,category:o.category_b,status:o.status_b,bureau:o.bureau_code_b},institution:{id:o.institution_id,officialId:o.institution_official_id,name:o.institution_name},score:o.overall_score,ruleScore:o.rule_score,semanticScore:o.semantic_score,matchingReasons:JSON.parse(o.reasons),reviewStatus:o.review_status,reviewNotes:o.review_notes,createdAt:o.created_at}))})
})
acics.patch('/overlaps/:id/review',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(!['ADMIN','OFFICIAL','BUREAU_OFFICER'].includes(profile.role))return c.json({error:'Overlap review is restricted to authorized staff.'},403)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const decision=text(body.decision||body.status,20),notes=text(body.notes,1000)
  if(!['CONFIRMED','REJECTED','INVESTIGATE'].includes(decision))return c.json({error:'Decision must be CONFIRMED, REJECTED, or INVESTIGATE.'},400)
  const row=await db.prepare(`SELECT * FROM acics_overlaps WHERE id=?`).bind(c.req.param('id')).first<any>()
  if(!row)return c.json({error:'Overlap alert not found.'},404)
  if(profile.role==='BUREAU_OFFICER'){
    const count=await db.prepare(`SELECT COUNT(*) AS n FROM acics_complaints WHERE (id IN (?,?) AND assigned_bureau_id=?)`).bind(row.case_a,row.case_b,profile.bureau_id).first<any>()
    if(!count?.n)return c.json({error:'You do not have permission to review this overlap.'},403)
  }
  const now=Date.now(),status=decision==='INVESTIGATE'?'INVESTIGATE':decision
  await db.prepare(`UPDATE acics_overlaps SET review_status=?,reviewed_by=?,reviewed_at=?,review_notes=?,updated_at=? WHERE id=?`).bind(status,profile.sub,now,notes,now,row.id).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),row.case_a,profile.sub,'OVERLAP_REVIEW',row.review_status,status,notes,'INTERNAL',now).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),row.case_b,profile.sub,'OVERLAP_REVIEW',row.review_status,status,notes,'INTERNAL',now).run()
  return privateJson(c,{ok:true,reviewStatus:status})
})
acics.get('/analytics',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  let where='',args:any[]=[]
  if(profile.role==='COMPLAINANT'){where='WHERE c.complainant_id=?';args=[profile.sub]}else if(profile.role==='OFFICIAL'){where='WHERE c.assigned_officer_id=?';args=[profile.sub]}else if(profile.role==='BUREAU_OFFICER'){where='WHERE c.assigned_bureau_id=?';args=[profile.bureau_id]}
  const [totals,statuses,bureaus,alerts,users,institutions,activity]=await db.batch([
    db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN c.status NOT IN ('RESOLVED','CLOSED','REJECTED') THEN 1 ELSE 0 END) AS open,SUM(CASE WHEN c.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS resolved,SUM(CASE WHEN c.due_at<? AND c.status NOT IN ('RESOLVED','CLOSED','REJECTED') THEN 1 ELSE 0 END) AS overdue FROM acics_complaints c ${where}`).bind(Date.now(),...args),
    db.prepare(`SELECT c.status,COUNT(*) AS count FROM acics_complaints c ${where} GROUP BY c.status ORDER BY count DESC`).bind(...args),
    db.prepare(`SELECT b.code,COUNT(c.id) AS count FROM acics_bureaus b LEFT JOIN acics_complaints c ON c.assigned_bureau_id=b.id ${profile.role==='BUREAU_OFFICER'?'AND c.assigned_bureau_id=?':''} GROUP BY b.id ORDER BY count DESC`).bind(...(profile.role==='BUREAU_OFFICER'?[profile.bureau_id]:[])),
    db.prepare(`SELECT COUNT(*) AS count FROM acics_overlaps o JOIN acics_complaints a ON a.id=o.case_a JOIN acics_complaints b ON b.id=o.case_b WHERE o.review_status='PENDING' ${profile.role==='BUREAU_OFFICER'?'AND (a.assigned_bureau_id=? OR b.assigned_bureau_id=?)':profile.role==='OFFICIAL'?'AND (a.assigned_officer_id=? OR b.assigned_officer_id=?)':''}`).bind(...(profile.role==='BUREAU_OFFICER'?[profile.bureau_id,profile.bureau_id]:profile.role==='OFFICIAL'?[profile.sub,profile.sub]:[])),
    db.prepare(`SELECT COUNT(*) AS count FROM acics_users WHERE active=1`),db.prepare(`SELECT COUNT(*) AS count FROM acics_institutions WHERE active=1`),
    db.prepare(`SELECT a.action_type,a.remarks,a.created_at,u.full_name AS actor,c.complaint_number FROM acics_actions a JOIN acics_users u ON u.sub=a.actor_id JOIN acics_complaints c ON c.id=a.complaint_id ORDER BY a.created_at DESC LIMIT 8`),
  ])
  return privateJson(c,{totals:totals.results[0],statuses:statuses.results,bureaus:bureaus.results,pendingOverlapReviews:Number((alerts.results[0] as any).count),users:Number((users.results[0] as any).count),institutions:Number((institutions.results[0] as any).count),recentActivity:profile.role==='ADMIN'?activity.results:[] ,role:profile.role,synthetic:true})
})
acics.get('/notifications',async c=>{
  const rows=await c.get('db').prepare(`SELECT id,complaint_id AS complaintId,type,title,message,read_at AS readAt,created_at AS createdAt FROM acics_notifications WHERE recipient_id=? ORDER BY created_at DESC LIMIT 100`).bind(c.get('user').sub).all<any>()
  return privateJson(c,{items:rows.results})
})
acics.patch('/notifications/:id/read',async c=>{
  const result=await c.get('db').prepare(`UPDATE acics_notifications SET read_at=? WHERE id=? AND recipient_id=?`).bind(Date.now(),c.req.param('id'),c.get('user').sub).run()
  if(!result.meta.changes)return c.json({error:'Notification not found.'},404)
  return privateJson(c,{ok:true})
})
acics.patch('/notifications/read-all',async c=>{
  const db=c.get('db'),user=c.get('user')
  await db.prepare(`UPDATE acics_notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL`).bind(Date.now(),user.sub).run()
  return privateJson(c,{ok:true})
})
function readRoles(input:any):AcicsRole[]|null {
  const raw=Array.isArray(input)?input:typeof input==='string'?[input]:null
  if(!raw||!raw.length)return null
  if(raw.some(r=>!ROLES.includes(r)))return null
  return [...new Set(raw)] as AcicsRole[]
}
function temporaryPassword(){
  const bytes=crypto.getRandomValues(new Uint8Array(9))
  return `Acics#${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`
}
async function rolesFor(db:D1Database,subs:string[]){
  const map=new Map<string,string[]>()
  if(!subs.length)return map
  const rows=await db.prepare(`SELECT user_sub,role FROM acics_user_roles WHERE user_sub IN (${subs.map(()=>'?').join(',')})`).bind(...subs).all<any>()
  for(const row of rows.results||[]){const list=map.get(row.user_sub)||[];list.push(row.role);map.set(row.user_sub,list)}
  return map
}
acics.get('/admin/users',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role!=='ADMIN')return c.json({error:'Administrator access required.'},403)
  const q=text(c.req.query('q'),100),role=text(c.req.query('role'),32),status=text(c.req.query('status'),32)
  let sql=`SELECT u.sub,u.full_name AS fullName,u.email,u.role,u.bureau_id AS bureauId,u.active,u.account_status AS accountStatus,u.designation,u.institution_id AS institutionId,u.requested_role AS requestedRole,u.created_at AS createdAt,u.updated_at AS updatedAt,b.code AS bureau,b.name AS bureauName,i.name AS institutionName FROM acics_users u LEFT JOIN acics_bureaus b ON b.id=u.bureau_id LEFT JOIN acics_institutions i ON i.id=u.institution_id WHERE 1=1`
  const args:unknown[]=[]
  if(q){sql+=' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.sub LIKE ?)';args.push(`%${q}%`,`%${q}%`,`%${q}%`)}
  if(role){sql+=' AND (u.role=? OR EXISTS(SELECT 1 FROM acics_user_roles r WHERE r.user_sub=u.sub AND r.role=?))';args.push(role,role)}
  if(status){sql+=' AND u.account_status=?';args.push(status)}
  sql+=' ORDER BY CASE u.account_status WHEN \'PENDING_APPROVAL\' THEN 0 WHEN \'PENDING_VERIFICATION\' THEN 1 ELSE 2 END,u.full_name'
  const rows=await db.prepare(sql).bind(...args).all<any>()
  const roleMap=await rolesFor(db,rows.results.map(r=>r.sub))
  return privateJson(c,{items:rows.results.map(r=>{
    const roles=[...new Set([...(roleMap.get(r.sub)||[]),...(r.role?[r.role]:[])])]
    return {...r,roles,role:roles[0]||''}
  })})
})
acics.post('/admin/users',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role!=='ADMIN')return c.json({error:'Administrator access required.'},403)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const fullName=text(body.fullName,120),email=text(body.email,160).toLowerCase()
  const roles=readRoles(body.roles??body.role)
  const bureauId=body.bureauId?text(body.bureauId,64):null
  const designation=body.designation?text(body.designation,120):null
  const institutionId=body.institutionId?text(body.institutionId,64):null
  if(fullName.length<2||!email.includes('@')||!roles){
    return c.json({error:'Provide a valid full name, email address, and at least one valid role.'},400)
  }
  if(roles.includes('BUREAU_OFFICER')&&!bureauId){
    return c.json({error:'Bureau officers must be assigned to an active bureau.'},400)
  }
  const existing=await db.prepare(`SELECT sub FROM acics_users WHERE email=?`).bind(email).first<any>()
  if(existing)return c.json({error:'A user with this email address already exists.'},409)
  const newSub=`user-${id()}`,now=Date.now(),initialPassword=temporaryPassword(),creds=await hashPassword(initialPassword)
  await db.prepare(`INSERT INTO acics_users (sub,full_name,email,role,bureau_id,password_hash,password_salt,active,account_status,designation,institution_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,'ACTIVE',?,?,?,?)`).bind(newSub,fullName,email,roles[0],bureauId,creds.hash,creds.salt,designation,institutionId,now,now).run()
  for(const role of roles){
    await db.prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub,role,granted_by,granted_at) VALUES (?,?,?,?)`).bind(newSub,role,profile.sub,now).run()
  }
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),'SYSTEM',profile.sub,'USER_CREATED',roles.join(','),`Created user ${fullName} (${email}) with roles ${roles.join(', ')}`,'INTERNAL',now).run()
  return privateJson(c,{ok:true,user:{sub:newSub,fullName,email,role:roles[0],roles,bureauId,accountStatus:'ACTIVE',active:1,designation,institutionId},initialPassword},201)
})
acics.patch('/admin/users/:sub',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role!=='ADMIN')return c.json({error:'Administrator access required.'},403)
  const targetSub=c.req.param('sub')
  const targetUser=await db.prepare(`SELECT * FROM acics_users WHERE sub=?`).bind(targetSub).first<any>()
  if(!targetUser)return c.json({error:'User not found.'},404)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const currentRolesRaw=[...new Set([...(await rolesFor(db,[targetSub])).get(targetSub)||[],...(targetUser.role?[targetUser.role]:[])])]
  const requestedRoles=body.roles!==undefined?readRoles(body.roles):body.role!==undefined?readRoles(body.role):currentRolesRaw as AcicsRole[]
  if(!requestedRoles)return c.json({error:'Provide at least one valid portal role.'},400)
  const fullName=body.fullName!==undefined?text(body.fullName,120):targetUser.full_name
  const bureauId=body.bureauId!==undefined?(body.bureauId?text(body.bureauId,64):null):targetUser.bureau_id
  const designation=body.designation!==undefined?(body.designation?text(body.designation,120):null):targetUser.designation
  const institutionId=body.institutionId!==undefined?(body.institutionId?text(body.institutionId,64):null):targetUser.institution_id
  const currentStatus=(targetUser.account_status as string)||(targetUser.active?'ACTIVE':'SUSPENDED')
  const nextStatus=body.accountStatus!==undefined?text(body.accountStatus,32):body.active!==undefined?(Boolean(body.active)?'ACTIVE':'SUSPENDED'):currentStatus
  if(!ACCOUNT_STATUSES.includes(nextStatus as any))return c.json({error:'Invalid account status.'},400)
  if(requestedRoles.includes('BUREAU_OFFICER')&&!bureauId){
    return c.json({error:'Bureau officers must be assigned to an active bureau.'},400)
  }
  if(targetSub===profile.sub){
    if(!requestedRoles.includes('ADMIN')||nextStatus!=='ACTIVE'){
      return c.json({error:'Administrators cannot remove their own admin role or deactivate their own account.'},403)
    }
  }
  const now=Date.now(),active=nextStatus==='ACTIVE'?1:0
  await db.prepare(`UPDATE acics_users SET full_name=?,role=?,bureau_id=?,designation=?,institution_id=?,active=?,account_status=?,updated_at=? WHERE sub=?`).bind(fullName,requestedRoles[0]??'',bureauId,designation,institutionId,active,nextStatus,now,targetSub).run()
  await db.prepare(`DELETE FROM acics_user_roles WHERE user_sub=?`).bind(targetSub).run()
  for(const role of requestedRoles){
    await db.prepare(`INSERT OR IGNORE INTO acics_user_roles (user_sub,role,granted_by,granted_at) VALUES (?,?,?,?)`).bind(targetSub,role,profile.sub,now).run()
  }
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,previous_value,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),'SYSTEM',profile.sub,'USER_UPDATED',`${currentRolesRaw.join(',')}:${currentStatus}`,`${requestedRoles.join(',')}:${nextStatus}`,`Updated user ${targetSub}`,'INTERNAL',now).run()
  return privateJson(c,{ok:true,user:{sub:targetSub,fullName,email:targetUser.email,role:requestedRoles[0],roles:requestedRoles,bureauId,accountStatus:nextStatus,active,designation,institutionId}})
})
acics.post('/admin/institutions',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role!=='ADMIN')return c.json({error:'Administrator access required.'},403)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const name=text(body.name,180),officialId=text(body.officialId,64),state=text(body.state,80),district=text(body.district,80),institutionType=text(body.type||body.institutionType,80)
  if(name.length<3||officialId.length<3||!state||!district){
    return c.json({error:'Provide institution name, official identifier, state, and district.'},400)
  }
  const existing=await db.prepare(`SELECT id FROM acics_institutions WHERE official_id=?`).bind(officialId).first<any>()
  if(existing)return c.json({error:'An institution with this identifier already exists.'},409)
  const newId=`inst-${id()}`,now=Date.now()
  await db.prepare(`INSERT INTO acics_institutions (id,official_id,name,normalized_name,state,district,institution_type,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)`).bind(newId,officialId,name,normalize(name),state,district,institutionType||'Technical institute',now,now).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),'SYSTEM',profile.sub,'INSTITUTION_CREATED',officialId,`Added institution ${name} (${officialId})`,'INTERNAL',now).run()
  return privateJson(c,{ok:true,institution:{id:newId,officialId,name,state,district,type:institutionType}},201)
})
acics.patch('/admin/institutions/:id',async c=>{
  const db=c.get('db'),profile=c.get('profile')
  if(profile.role!=='ADMIN')return c.json({error:'Administrator access required.'},403)
  const inst=await db.prepare(`SELECT * FROM acics_institutions WHERE id=? OR official_id=?`).bind(c.req.param('id'),c.req.param('id')).first<any>()
  if(!inst)return c.json({error:'Institution not found.'},404)
  let body:any;try{body=await c.req.json()}catch{return c.json({error:'A valid JSON request is required.'},400)}
  const name=body.name!==undefined?text(body.name,180):inst.name
  const state=body.state!==undefined?text(body.state,80):inst.state
  const district=body.district!==undefined?text(body.district,80):inst.district
  const type=body.type!==undefined?text(body.type,80):inst.institution_type
  const active=body.active!==undefined?(Boolean(body.active)?1:0):inst.active
  const now=Date.now()
  await db.prepare(`UPDATE acics_institutions SET name=?,normalized_name=?,state=?,district=?,institution_type=?,active=?,updated_at=? WHERE id=?`).bind(name,normalize(name),state,district,type,active,now,inst.id).run()
  await db.prepare(`INSERT INTO acics_actions (id,complaint_id,actor_id,action_type,new_value,remarks,visibility,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),'SYSTEM',profile.sub,'INSTITUTION_UPDATED',inst.official_id,`Updated institution ${name}`,'INTERNAL',now).run()
  return privateJson(c,{ok:true,institution:{id:inst.id,officialId:inst.official_id,name,state,district,type,active}})
})
acics.get('/admin/audit-logs',async c=>{
  const profile=c.get('profile');if(profile.role!=='ADMIN')return c.json({error:'Administrator access required.'},403)
  const rows=await c.get('db').prepare(`SELECT a.id,a.complaint_id AS complaintId,c.complaint_number AS complaintNumber,a.actor_id AS actorId,u.full_name AS actor,a.action_type AS actionType,a.previous_value AS previousValue,a.new_value AS newValue,a.remarks,a.visibility,a.created_at AS createdAt FROM acics_actions a LEFT JOIN acics_users u ON u.sub=a.actor_id LEFT JOIN acics_complaints c ON c.id=a.complaint_id ORDER BY a.created_at DESC LIMIT 200`).all<any>()
  return privateJson(c,{items:rows.results})
})

