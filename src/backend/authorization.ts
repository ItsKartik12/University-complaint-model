// Central authorization service for ACICS.
//
// Portal selection is a *request* for access. Every decision here is derived
// from the server-side account record: account status, assigned roles, and
// (for bureau officers) a bureau assignment. Nothing the browser sends can
// grant a role — the optional `x-acics-portal` header only narrows the current
// session to a role the account already holds.

export type AcicsRole = 'COMPLAINANT' | 'OFFICIAL' | 'ADMIN' | 'BUREAU_OFFICER'

export const ACICS_ROLES: AcicsRole[] = ['COMPLAINANT', 'OFFICIAL', 'ADMIN', 'BUREAU_OFFICER']

export type AccountStatus =
  | 'PENDING_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REJECTED'

export const ACCOUNT_STATUSES: AccountStatus[] = [
  'PENDING_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
]

export const PORTALS = {
  complainant: {
    role: 'COMPLAINANT',
    label: 'Complainant Portal',
    description: 'Submit grievances, upload supporting evidence, track complaint progress, and receive official updates.',
    eligibility: ['Faculty members', 'Teachers', 'Heads of departments', 'Heads of institutions', 'Other authorised institutional staff'],
  },
  official: {
    role: 'OFFICIAL',
    label: 'Official / Case Officer Portal',
    description: 'Review assigned grievances, process cases, record remarks, and update case status.',
    eligibility: ['Authorised case officers', 'Institutional officials'],
  },
  admin: {
    role: 'ADMIN',
    label: 'Administrator Portal',
    description: 'Manage authorised users, institutions, permissions, configuration, and audit records.',
    eligibility: ['Explicitly appointed administrators'],
  },
  bureau: {
    role: 'BUREAU_OFFICER',
    label: 'Bureau Coordination Portal',
    description: 'Coordinate cases across authorised bureaus, review potential overlaps, and record coordination decisions.',
    eligibility: ['Authorised bureau coordination officers'],
  },
} as const satisfies Record<string, { role: AcicsRole; label: string; description: string; eligibility: readonly string[] }>

export type PortalKey = keyof typeof PORTALS

export const PORTAL_KEYS = Object.keys(PORTALS) as PortalKey[]

/** Designations that may request Complainant Portal access through onboarding. */
export const COMPLAINANT_DESIGNATIONS = [
  'Faculty member',
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'Head of Department',
  'Principal',
  'Director',
  'Institution staff',
  'Other authorised complainant',
] as const

const ROLE_PRIORITY: AcicsRole[] = ['ADMIN', 'BUREAU_OFFICER', 'OFFICIAL', 'COMPLAINANT']

export interface AcicsAccount {
  sub: string
  fullName: string
  email: string
  roles: AcicsRole[]
  primaryRole: AcicsRole | null
  accountStatus: AccountStatus
  bureauId: string | null
  bureauName: string | null
  bureauCode: string | null
  designation: string | null
  institutionId: string | null
  institutionName: string | null
  googleLinked: boolean
  demo: boolean
}

export interface AccessDecision {
  allowed: boolean
  code: string
  message: string
  portal?: PortalKey
  role?: AcicsRole
}

export function isPortalKey(value: unknown): value is PortalKey {
  return typeof value === 'string' && Object.hasOwn(PORTALS, value)
}

export function isAcicsRole(value: unknown): value is AcicsRole {
  return typeof value === 'string' && (ACICS_ROLES as string[]).includes(value)
}

function normalizeStatus(raw: unknown, active: unknown): AccountStatus {
  if (typeof raw === 'string' && (ACCOUNT_STATUSES as string[]).includes(raw)) return raw as AccountStatus
  return Number(active) === 1 ? 'ACTIVE' : 'SUSPENDED'
}

/** Reads the requested portal from the request header. Never trusts its value as a grant. */
export function readPortalHeader(request: Request): PortalKey | 'invalid' | null {
  const raw = request.headers.get('x-acics-portal')
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  return isPortalKey(value) ? value : 'invalid'
}

export async function loadAccount(db: D1Database, sub: string): Promise<AcicsAccount | null> {
  const row = (await db
    .prepare(
      `SELECT u.sub, u.full_name, u.email, u.role, u.bureau_id, u.account_status, u.designation,
              u.institution_id, u.google_sub, u.active,
              b.name AS bureau_name, b.code AS bureau_code, i.name AS institution_name
       FROM acics_users u
       LEFT JOIN acics_bureaus b ON b.id = u.bureau_id
       LEFT JOIN acics_institutions i ON i.id = u.institution_id
       WHERE u.sub = ?`
    )
    .bind(sub)
    .first()) as any

  if (!row) return null

  let granted: string[] = []
  try {
    const roleRows = await db
      .prepare('SELECT role FROM acics_user_roles WHERE user_sub = ?')
      .bind(sub)
      .all<any>()
    granted = (roleRows.results || []).map((r) => String(r.role))
  } catch {
    granted = []
  }

  const roles = [...new Set([...granted, String(row.role ?? '')])]
    .filter(isAcicsRole)
    .sort((a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b))

  return {
    sub: row.sub,
    fullName: row.full_name,
    email: row.email,
    roles,
    primaryRole: roles[0] ?? null,
    accountStatus: normalizeStatus(row.account_status, row.active),
    bureauId: row.bureau_id ?? null,
    bureauName: row.bureau_name ?? null,
    bureauCode: row.bureau_code ?? null,
    designation: row.designation ?? null,
    institutionId: row.institution_id ?? null,
    institutionName: row.institution_name ?? null,
    googleLinked: Boolean(row.google_sub),
    demo: String(sub).startsWith('demo-'),
  }
}

const STATUS_MESSAGES: Record<Exclude<AccountStatus, 'ACTIVE'>, string> = {
  PENDING_VERIFICATION: 'Your account is awaiting identity verification by an ACICS administrator.',
  PENDING_APPROVAL: 'Your account request is awaiting approval by an ACICS administrator.',
  SUSPENDED: 'This account has been suspended. Contact your ACICS administrator if you believe this is an error.',
  REJECTED: 'This account request was not approved. Contact your ACICS administrator for assistance.',
}

export function accountStatusMessage(status: AccountStatus): string {
  return status === 'ACTIVE' ? 'Account active.' : STATUS_MESSAGES[status]
}

/** Evaluates whether an account may enter a portal. Order matters for auditability. */
export function canAccessPortal(account: AcicsAccount | null, portal: PortalKey): AccessDecision {
  if (!account) {
    return {
      allowed: false,
      code: 'ACCOUNT_NOT_PROVISIONED',
      message: 'No ACICS account is linked to this identity. Request access or contact your administrator.',
      portal,
    }
  }
  if (account.accountStatus !== 'ACTIVE') {
    return {
      allowed: false,
      code: `ACCOUNT_${account.accountStatus}`,
      message: accountStatusMessage(account.accountStatus),
      portal,
    }
  }
  if (!account.roles.length) {
    return {
      allowed: false,
      code: 'ACCOUNT_NO_ROLE',
      message: 'This account has no portal role assigned. Contact your ACICS administrator.',
      portal,
    }
  }
  const role = PORTALS[portal].role
  if (!account.roles.includes(role)) {
    return {
      allowed: false,
      code: 'PORTAL_NOT_AUTHORIZED',
      message: `Your account is authenticated, but you are not currently authorised to access the ${PORTALS[portal].label}. Contact your system administrator if you believe this is an error.`,
      portal,
    }
  }
  if (role === 'BUREAU_OFFICER' && !account.bureauId) {
    return {
      allowed: false,
      code: 'BUREAU_NOT_ASSIGNED',
      message: 'A bureau assignment is required before the Bureau Coordination Portal can be used.',
      portal,
    }
  }
  return { allowed: true, code: 'ALLOWED', message: 'Access granted.', portal, role }
}

export interface ResolvedRole {
  role: AcicsRole | null
  portal: PortalKey | null
  denied?: AccessDecision
}

/** Resolves the effective role for this request from the portal header or primary role. */
export function resolveActiveRole(account: AcicsAccount, request: Request): ResolvedRole {
  const requested = readPortalHeader(request)
  if (requested === 'invalid') {
    return {
      role: null,
      portal: null,
      denied: { allowed: false, code: 'PORTAL_UNKNOWN', message: 'The requested portal is not recognised.' },
    }
  }
  if (requested) {
    const decision = canAccessPortal(account, requested)
    return decision.allowed
      ? { role: decision.role!, portal: requested }
      : { role: null, portal: requested, denied: decision }
  }
  return { role: account.primaryRole, portal: null }
}
