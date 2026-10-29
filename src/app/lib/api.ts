import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Activity, Company, Contact, Deal, Me, Overview, StoredFile, Task } from '../../shared/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

const API_BASE_URL = ((import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '')

const PORTAL_STORAGE_KEY = 'acics:portal'

export type AcicsRole = 'COMPLAINANT' | 'OFFICIAL' | 'ADMIN' | 'BUREAU_OFFICER'
export type PortalKey = 'complainant' | 'official' | 'admin' | 'bureau'

/** The portal is a client-side scope hint; the server re-validates it against the account. */
export function getActivePortal(): PortalKey | null {
  const isPortal = (value: unknown): value is PortalKey =>
    value === 'complainant' || value === 'official' || value === 'admin' || value === 'bureau'
  try {
    const stored = localStorage.getItem(PORTAL_STORAGE_KEY)
    if (isPortal(stored)) return stored
    // OAuth returns to /?portal=... so a multi-role account lands back in the
    // portal it originally requested.
    const fromUrl = new URLSearchParams(window.location.search).get('portal')
    if (isPortal(fromUrl)) {
      localStorage.setItem(PORTAL_STORAGE_KEY, fromUrl)
      return fromUrl
    }
    return null
  } catch {
    return null
  }
}

export function setActivePortal(portal: PortalKey | null) {
  try {
    if (portal) localStorage.setItem(PORTAL_STORAGE_KEY, portal)
    else localStorage.removeItem(PORTAL_STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
}

export interface AuthAccount {
  authenticated: true
  sub: string
  name: string
  email: string
  roles: AcicsRole[]
  role: AcicsRole
  accountStatus: 'PENDING_VERIFICATION' | 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED'
  designation: string | null
  institution: { id: string; name: string | null } | null
  bureau: { id: string; name: string | null; code: string | null } | null
  demo: boolean
  activePortal: PortalKey | null
  user: { sub: string; name: string; email: string; role: AcicsRole }
}

export interface AuthStatus {
  mode: 'freebuff' | 'development' | 'off'
  database: boolean
  files: boolean
  googleConfigured: boolean
  devAuthEnabled: boolean
  appEnv: string
  portals: { key: PortalKey; role: AcicsRole; label: string; description: string; eligibility: string[] }[]
  demoAccounts: { sub: string; name: string; email: string; roles: AcicsRole[] }[]
}

export interface PortalDecision {
  allowed: boolean
  code: string
  portal: PortalKey
  role?: AcicsRole
  error?: string
  accountStatus?: string
  roles?: AcicsRole[]
  account?: Record<string, unknown>
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const targetUrl = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${API_BASE_URL}${cleanPath}`
  const portal = getActivePortal()
  const response = await fetch(targetUrl, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      accept: 'application/json',
      ...(portal ? { 'x-acics-portal': portal } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!response.ok) {
    let message = response.statusText
    let code: string | undefined
    try {
      const body = (await response.json()) as { error?: string; message?: string; code?: string }
      message = body.message ?? body.error ?? message
      code = body.code ?? body.error
    } catch {
      /* no body */
    }
    throw new ApiError(response.status, message, code)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

// Queries

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), retry: false, staleTime: 60_000 })
export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview') })

export interface ContactsQuery {
  q?: string
  status?: string
  companyId?: string
  sort?: 'activity' | 'name'
  page?: number
}
export const useContacts = (query: ContactsQuery) =>
  useQuery({
    queryKey: ['contacts', query],
    queryFn: () => {
      const params = new URLSearchParams()
      if (query.q) params.set('q', query.q)
      if (query.status) params.set('status', query.status)
      if (query.companyId) params.set('companyId', query.companyId)
      if (query.sort) params.set('sort', query.sort)
      if (query.page) params.set('page', String(query.page))
      return api<{ items: Contact[]; total: number; page: number; pageSize: number }>(`/contacts?${params}`)
    },
    placeholderData: (previous) => previous,
  })

export const useContact = (id: string | undefined) =>
  useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<{ contact: Contact; activities: Activity[]; deals: Deal[]; files: StoredFile[] }>(`/contacts/${id}`),
    enabled: Boolean(id),
  })

export const useCompanies = (q = '') =>
  useQuery({
    queryKey: ['companies', q],
    queryFn: () => api<{ items: Company[] }>(`/companies?q=${encodeURIComponent(q)}`),
    placeholderData: (previous) => previous,
  })

export const useCompany = (id: string | undefined) =>
  useQuery({
    queryKey: ['company', id],
    queryFn: () => api<{ company: Company; contacts: Contact[]; deals: Deal[]; activities: Activity[] }>(`/companies/${id}`),
    enabled: Boolean(id),
  })

export const useDeals = () => useQuery({ queryKey: ['deals'], queryFn: () => api<{ items: Deal[] }>('/deals') })
export const useDeal = (id: string | null) =>
  useQuery({
    queryKey: ['deal', id],
    queryFn: () => api<{ deal: Deal; activities: Activity[]; files: StoredFile[] }>(`/deals/${id}`),
    enabled: Boolean(id),
  })
export const useTasks = () => useQuery({ queryKey: ['tasks'], queryFn: () => api<{ items: Task[] }>('/tasks') })

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () =>
      api<{
        contacts: { id: string; name: string; email: string | null; hue: number }[]
        companies: { id: string; name: string; domain: string | null; hue: number }[]
        deals: { id: string; title: string; stage: string; value: number }[]
      }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  })

// Mutations. Each invalidates the lists it can affect; detail pages refetch
// through their own keys.

export function useInvalidate() {
  const client = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })))
}

export function useApiMutation<TInput, TResult>(
  run: (input: TInput) => Promise<TResult>,
  invalidates: string[],
  options?: { onSuccess?: (result: TResult, input: TInput) => void },
) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: run,
    onSuccess: async (result, input) => {
      await invalidate(...invalidates)
      options?.onSuccess?.(result, input)
    },
  })
}

export async function uploadFile(
  file: File,
  target: { contactId?: string; dealId?: string; companyId?: string },
): Promise<StoredFile> {
  const form = new FormData()
  form.set('file', file)
  if (target.contactId) form.set('contactId', target.contactId)
  if (target.dealId) form.set('dealId', target.dealId)
  if (target.companyId) form.set('companyId', target.companyId)
  const result = await api<{ file: StoredFile }>('/files', { method: 'POST', body: form })
  return result.file
}

export async function uploadAvatar(contactId: string, file: File): Promise<string> {
  const form = new FormData()
  form.set('file', file)
  const result = await api<{ avatarKey: string }>(`/files/avatar/${contactId}`, { method: 'PUT', body: form })
  return result.avatarKey
}

// Authentication and portal eligibility

export const useAuthStatus = () =>
  useQuery({ queryKey: ['auth', 'status'], queryFn: () => api<AuthStatus>('/auth/status'), staleTime: 60_000 })

export const useAuthMe = () =>
  useQuery({ queryKey: ['auth', 'me'], queryFn: () => api<AuthAccount>('/auth/me'), retry: false, staleTime: 30_000 })

export interface LoginResult {
  ok: true
  user: { sub: string; name: string; email: string; role: AcicsRole }
  role: AcicsRole
  roles: AcicsRole[]
  accountStatus: string
  bureau: { id: string; code: string | null; name: string | null } | null
  portal: PortalKey | null
  access: PortalDecision | null
  demo: boolean
}

export const login = (email: string, password: string, portal: PortalKey) =>
  api<LoginResult>('/auth/login', { method: 'POST', json: { email, password, portal } })

export const logout = () => api<{ ok: true }>('/auth/logout', { method: 'POST' })

export const checkPortalAccess = (portal: PortalKey) =>
  api<PortalDecision>('/auth/portal-access', { method: 'POST', json: { portal } })

export interface AccountRequestInput {
  fullName: string
  email: string
  password: string
  designation: string
  institutionOfficialId: string
}

export const requestAccount = (input: AccountRequestInput) =>
  api<{ ok: true; status: string; message: string }>('/auth/account-request', { method: 'POST', json: input })

export interface OnboardingOptions {
  designations: string[]
  institutions: { officialId: string; name: string; state: string }[]
  requestedPortal: string
  googleConfigured: boolean
  devAuthEnabled: boolean
}

export const useOnboardingOptions = () =>
  useQuery({ queryKey: ['auth', 'onboarding'], queryFn: () => api<OnboardingOptions>('/auth/onboarding/options'), staleTime: 60_000 })
