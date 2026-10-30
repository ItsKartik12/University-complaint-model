// Types shared by the backend (src/backend) and the frontend (src/frontend).

export type ContactStatus = 'lead' | 'active' | 'customer' | 'churned'
export const CONTACT_STATUSES: ContactStatus[] = ['lead', 'active', 'customer', 'churned']

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'
export const DEAL_STAGES: { key: DealStage; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
]

export type ActivityKind = 'note' | 'call' | 'email' | 'meeting' | 'stage' | 'file' | 'created'

export interface Company {
  id: string
  name: string
  domain: string | null
  industry: string | null
  size: string | null
  location: string | null
  hue: number
  createdAt: number
  updatedAt: number
  contactCount?: number
  dealCount?: number
  openValue?: number
}

export interface Contact {
  id: string
  companyId: string | null
  companyName?: string | null
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  title: string | null
  status: ContactStatus
  avatarKey: string | null
  hue: number
  lastActivityAt: number
  createdAt: number
  updatedAt: number
}

export interface Deal {
  id: string
  title: string
  companyId: string | null
  companyName?: string | null
  contactId: string | null
  contactName?: string | null
  contactHue?: number | null
  value: number
  stage: DealStage
  position: number
  closeDate: string | null
  createdAt: number
  updatedAt: number
}

export interface Activity {
  id: string
  kind: ActivityKind
  body: string
  contactId: string | null
  dealId: string | null
  companyId: string | null
  contactName?: string | null
  dealTitle?: string | null
  createdAt: number
}

export interface Task {
  id: string
  title: string
  dueAt: number | null
  doneAt: number | null
  contactId: string | null
  dealId: string | null
  contactName?: string | null
  dealTitle?: string | null
  createdAt: number
}

export interface StoredFile {
  id: string
  name: string
  size: number
  mime: string
  contactId: string | null
  dealId: string | null
  companyId: string | null
  createdAt: number
}

export interface Me {
  user: { sub: string; name?: string; email?: string; picture?: string }
  workspace: { name: string; seededAt: number | null }
  capabilities: { database: boolean; files: boolean; auth: 'freebuff' | 'development' }
}

export interface Overview {
  kpis: {
    pipelineValue: number
    wonThisMonth: number
    wonLastMonth: number
    openDeals: number
    newContacts: number
    tasksDue: number
  }
  revenueSeries: { label: string; value: number }[]
  stageTotals: { stage: DealStage; count: number; value: number }[]
  recentActivity: Activity[]
  upcomingTasks: Task[]
}

// ---------------------------------------------------------------------------
// ACICS Domain Types (SIH26264)
// ---------------------------------------------------------------------------

export type AcicsRole = 'COMPLAINANT' | 'OFFICIAL' | 'ADMIN' | 'BUREAU_OFFICER'

export interface AcicsUser {
  user: {
    sub: string
    name: string
    email: string
  }
  role: AcicsRole
  bureau: {
    id: string
    name: string
    code: string
  } | null
  demo: boolean
}

export interface AcicsInstitution {
  id: string
  officialId: string
  name: string
  state: string
  district: string
  type?: string
  institutionType?: string
  active?: boolean | number
  openCases?: number
  totalCases?: number
}

export interface AcicsBureau {
  id: string
  code: string
  name: string
  description?: string
  active?: boolean | number
  permittedCategories?: string[]
}

export interface AcicsCase {
  id: string
  complaintNumber: string
  subject: string
  description: string
  category: string
  priority: string
  status: string
  institution: {
    id: string
    officialId: string
    name: string
    state: string
    district: string
    type: string
  }
  assignedBureau?: {
    id: string
    name: string
    code: string
  } | null
  assignedOfficer?: string | null
  dueAt: number
  overdue: boolean
  publicRemarks: string
  submittedAt: number
  lastActionAt: number
  resolvedAt: number | null
}

export interface AcicsAlert {
  id: string
  caseA: {
    id: string
    number: string
    subject: string
    description: string
    category: string
    status: string
    bureau: string
  }
  caseB: {
    id: string
    number: string
    subject: string
    description: string
    category: string
    status: string
    bureau: string
  }
  institution: {
    id: string
    officialId: string
    name: string
  }
  score: number
  matchingReasons: string[]
  reviewStatus: string
  reviewNotes: string
  createdAt: number
}

export interface AcicsAction {
  id: string
  actorId?: string
  actor?: string
  actorName?: string
  actionType: string
  previousValue?: string | null
  newValue?: string | null
  remarks?: string
  visibility?: 'PUBLIC' | 'INTERNAL'
  createdAt: number
}

export interface AcicsNotification {
  id: string
  recipientId: string
  complaintId?: string | null
  type: string
  title: string
  message: string
  read: boolean
  createdAt: number
}

