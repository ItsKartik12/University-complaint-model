import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  CircleHelp,
  Eye,
  EyeOff,
  Info,
  Landmark,
  Loader2,
  Lock,
  LogOut,
  Network,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'

import { useQueryClient } from '@tanstack/react-query'

import { api, ApiError, checkPortalAccess, devSession, getActivePortal, login, logout, requestAccount, setActivePortal, useAuthStatus, useOnboardingOptions } from '../lib/api'
import type { AcicsRole, PortalDecision, PortalKey } from '../lib/api'
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Select } from '../components/ui'

const ROLE_LABELS: Record<AcicsRole, string> = {
  COMPLAINANT: 'Complainant',
  OFFICIAL: 'Official / Case Officer',
  ADMIN: 'Administrator',
  BUREAU_OFFICER: 'Bureau Coordination Officer',
}

const PORTAL_ORDER: PortalKey[] = ['complainant', 'official', 'admin', 'bureau']

const PORTAL_ICONS: Record<PortalKey, typeof Users> = {
  complainant: UserRound,
  official: BriefcaseBusiness,
  admin: ShieldCheck,
  bureau: Network,
}

const FALLBACK_PORTALS: { key: PortalKey; label: string; description: string; eligibility: string[] }[] = [
  {
    key: 'complainant',
    label: 'Complainant Portal',
    description: 'Submit grievances, upload supporting evidence, track complaint progress, and receive official updates.',
    eligibility: ['Faculty members', 'Teachers', 'Heads of departments', 'Heads of institutions', 'Other authorised institutional staff'],
  },
  {
    key: 'official',
    label: 'Official / Case Officer Portal',
    description: 'Review assigned grievances, process cases, record remarks, and update case status.',
    eligibility: ['Authorised case officers', 'Institutional officials'],
  },
  {
    key: 'admin',
    label: 'Administrator Portal',
    description: 'Manage authorised users, institutions, permissions, configuration, and audit records.',
    eligibility: ['Explicitly appointed administrators'],
  },
  {
    key: 'bureau',
    label: 'Bureau Coordination Portal',
    description: 'Coordinate cases across authorised bureaus, review potential overlaps, and record coordination decisions.',
    eligibility: ['Authorised bureau coordination officers'],
  },
]

const PORTAL_COPY: Record<PortalKey, string> = {
  complainant: 'Submit grievances, track complaint progress, and review updates.',
  official: 'Review assigned cases, process complaints, and record case actions.',
  admin: 'Manage users, institutions, access permissions, and audit records.',
  bureau: 'Coordinate authorized cases, review potential overlaps, and manage coordination activities.',
}

const STEPS = ['Select portal', 'Sign in', 'Verify eligibility', 'Access decision']
const DEV_STEPS = ['Select portal', 'Development sign-in', 'Verify access', 'Enter portal']

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong. Please try again.'

const isPortal = (value: string | null): value is PortalKey =>
  value === 'complainant' || value === 'official' || value === 'admin' || value === 'bureau'

function initialPortalFromUrl(): PortalKey | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('portal')
  return isPortal(value) ? value : null
}

function oauthNoticeFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const auth = params.get('auth')
  if (auth === 'denied') return `Google sign-in completed, but this account is not authorised for that portal (${params.get('code') ?? 'access denied'}).`
  if (auth === 'pending') return 'Your Google identity was recorded. An administrator must verify the account before portal access is granted.'
  if (auth === 'account_exists') return 'An ACICS account already exists for that email address. Sign in with your existing credentials instead.'
  return null
}

export function PortalAccess({ onSignedIn, initialRequest = false }: { onSignedIn: () => void; initialRequest?: boolean }) {
  const { data: status } = useAuthStatus()
  const { data: onboarding } = useOnboardingOptions()
  const qc = useQueryClient()
  const panelRef = useRef<HTMLElement | null>(null)

  const devMode = Boolean(status?.devAuthEnabled)
  const [portal, setPortal] = useState<PortalKey | null>(initialPortalFromUrl() ?? getActivePortal())
  const [notice] = useState(oauthNoticeFromUrl)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [decision, setDecision] = useState<PortalDecision | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const [showAccountRequest, setShowAccountRequest] = useState(initialRequest)
  const [requestSent, setRequestSent] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('auth') && !url.searchParams.has('signed_in') && !url.searchParams.has('portal')) return
    url.searchParams.delete('auth')
    url.searchParams.delete('code')
    url.searchParams.delete('signed_in')
    url.searchParams.delete('portal')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const portals = useMemo(() => {
    if (status?.portals?.length) {
      return [...status.portals].sort((a, b) => PORTAL_ORDER.indexOf(a.key) - PORTAL_ORDER.indexOf(b.key))
    }
    return FALLBACK_PORTALS
  }, [status])

  const selected = portals.find((p) => p.key === portal) ?? null

  const choosePortal = (key: PortalKey) => {
    setPortal(key)
    setDecision(null)
    setShowAccountRequest(false)
    setStep(2)
    window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const decide = async (portalKey: PortalKey) => {
    setStep(3)
    // The visible delay keeps the eligibility checklist honest: each row below
    // reflects a real server round-trip, not a client-side guess.
    const [result] = await Promise.all([
      checkPortalAccess(portalKey),
      new Promise((resolve) => setTimeout(resolve, 420)),
    ])
    setHasSession(true)
    return result
  }

  const enterPortal = async (portalKey: PortalKey) => {
    const result = await decide(portalKey)
    if (result.allowed) {
      setDecision(result)
      setStep(4)
      setActivePortal(portalKey)
      await qc.invalidateQueries({ queryKey: ['auth'] })
      await qc.invalidateQueries({ queryKey: ['acics'] })
      window.setTimeout(() => onSignedIn(), 700)
    } else {
      setDecision(result)
      setStep(4)
    }
  }

  const submitCredentials = async (email: string, password: string) => {
    if (!portal) return
    try {
      const result = await login(email, password, portal)
      if (result.access && !result.access.allowed) {
        setHasSession(true)
        setDecision({ ...result.access, portal })
        setStep(4)
        return
      }
      await enterPortal(portal)
    } catch (error) {
      setStep(2)
      if (error instanceof ApiError && error.status === 403) {
        // Authentication succeeded far enough for the server to evaluate the
        // account; show the eligibility decision instead of a bare error.
        setHasSession(false)
        setDecision({
          allowed: false,
          code: error.code ?? 'ACCESS_NOT_GRANTED',
          error: error.message,
          portal,
        })
        setStep(4)
        return
      }
      throw error
    }
  }

  const submitDevSession = async (identifier: string, displayName: string) => {
    if (!portal) return
    const result = await devSession(identifier, displayName, portal)
    setHasSession(true)
    if (result.access && !result.access.allowed) {
      setDecision({ ...result.access, portal })
      setStep(4)
      return
    }
    await enterPortal(portal)
  }

  const signOut = async () => {
    try {
      await logout()
    } finally {
      setActivePortal(null)
      setHasSession(false)
      setDecision(null)
      setStep(1)
      await qc.invalidateQueries({ queryKey: ['auth'] })
      await qc.invalidateQueries({ queryKey: ['acics'] })
    }
  }

  const requestComplainantAccess = () => {
    setShowAccountRequest(true)
    setRequestSent(false)
    setStep(2)
    window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <GovStrip />
      <GovHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-9 sm:px-6 lg:py-14">
          <section aria-labelledby="portal-access-heading" className="mx-auto max-w-3xl text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-saffron">Portal access</p>
            <h1 id="portal-access-heading" className="mt-3 text-balance text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy-deep sm:text-[38px]">
              Welcome to ACICS
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">
              {devMode
                ? 'Choose the portal you want to explore. Local development access is enabled while real authentication is being prepared.'
                : 'Choose the portal you want to use. Access is verified against your authorised account before any case information is shown.'}
            </p>
          </section>

          <fieldset className="mt-8">
            <legend className="sr-only">Choose the portal you want to enter</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {portals.map((item) => (
                <PortalCard
                  key={item.key}
                  item={item}
                  selected={portal === item.key}
                  onSelect={() => choosePortal(item.key)}
                />
              ))}
            </div>
          </fieldset>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10">
            <section ref={panelRef} aria-label="Portal sign in" className="scroll-mt-6">
              {notice && (
                <div role="status" className="mb-4 rounded-control border border-[#e68a24]/40 bg-[#fdf1e2] p-3 text-[12px] leading-relaxed text-[#102a43]">
                  {notice}
                </div>
              )}
              <StepIndicator step={step} labels={devMode ? DEV_STEPS : STEPS} />
              <Card className="mt-4 overflow-hidden border border-line shadow-sm">
                {showAccountRequest ? (
                  <AccountRequestForm
                    options={onboarding}
                    sent={requestSent}
                    onSent={() => setRequestSent(true)}
                    onBack={() => setShowAccountRequest(false)}
                  />
                ) : step === 1 ? (
                  <div className="p-5 sm:p-6">
                    <h2 className="text-[16px] font-semibold text-navy-deep">Select a portal to continue</h2>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                      Choose a portal card above. Portal selection only tells us where you are trying to go — access is always
                      decided from your server-side account.
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {portals.map((item) => (
                        <Button key={item.key} className="justify-between" onClick={() => choosePortal(item.key)}>
                          {item.label.replace(' Portal', '')} <ArrowRight />
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : step === 2 && selected ? (
                  devMode ? (
                    <DevSignInPanel
                      portal={selected}
                      onBack={() => setStep(1)}
                      onSubmit={submitDevSession}
                      onRequestAccess={requestComplainantAccess}
                    />
                  ) : (
                    <SignInPanel
                      portal={selected}
                      googleConfigured={Boolean(status?.googleConfigured)}
                      onBack={() => setStep(1)}
                      onSubmit={submitCredentials}
                      onForgot={() => setForgotOpen(true)}
                    />
                  )
                ) : step === 3 && selected ? (
                  <EligibilityChecklist portal={selected} />
                ) : (
                  <DecisionPanel
                    decision={decision}
                    portal={selected}
                    hasSession={hasSession}
                    onRetry={() => { setDecision(null); setStep(1) }}
                    onRequestAccess={requestComplainantAccess}
                    onSignOut={signOut}
                  />
                )}
              </Card>
              <p className="mt-4 text-center text-[11.5px] leading-relaxed text-faint">
                This is a demonstration deployment. Accounts, institutions, and cases in the dataset are synthetic. Do not enter
                real confidential information.
              </p>
            </section>

            <aside className="space-y-4">
              <div className="rounded-card border border-line bg-surface p-5">
                <h2 className="text-[13px] font-semibold text-navy-deep">How access is decided</h2>
                <div className="mt-4 space-y-3.5">
                  <Assurance icon={<ShieldCheck />} title="Server-side eligibility" body="Roles, account status, and bureau assignment are verified on the server for every request." />
                  <Assurance icon={<Lock />} title="Identity is not authorisation" body="Signing in proves who you are. It does not grant a privileged portal." />
                  <Assurance icon={<Landmark />} title="Administrator-controlled provisioning" body="Official, Bureau, and Administrator roles are assigned by authorised administrators." />
                </div>
              </div>

              <div className="rounded-card border border-line bg-surface p-5">
                <p className="text-[13px] font-semibold text-navy-deep">Faculty and institutional staff</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Eligible complainants can request access. Designation and institution are verified by an administrator before
                  the Complainant Portal is enabled.
                </p>
                <Button className="mt-3" size="sm" onClick={requestComplainantAccess}>
                  Request Complainant Portal access <ArrowRight />
                </Button>
              </div>

              {devMode && (
                <div className="rounded-card border border-success/25 bg-success-soft p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-success">Local development mode</p>
                  <p className="mt-2 text-[12px] leading-relaxed text-navy-deep">
                    Any non-empty user ID or email opens a synthetic session with all four portals. This mode is enforced by the
                    backend, is unavailable in production, and is not a verified identity. Real sign-in will be added later.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>
      <GovFooter />
      <ForgotPasswordDialog open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  )
}

export function GovStrip() {
  return (
    <div className="bg-navy-deep text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[11px] sm:px-6">
        <span className="tracking-wide">AICTE · Complaint intelligence and coordination</span>
        <span className="flex items-center gap-1.5 text-white/75">
          <Info className="size-3" aria-hidden /> Prototype deployment · not connected to live AICTE systems
        </span>
      </div>
      <div className="flex h-[3px]" aria-hidden>
        <span className="w-1/3 bg-saffron" />
        <span className="w-1/3 bg-white/25" />
        <span className="w-1/3 bg-success" />
      </div>
    </div>
  )
}

export function GovHeader() {
  const { data: status } = useAuthStatus()
  const [helpOpen, setHelpOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const devMode = Boolean(status?.devAuthEnabled)

  return (
    <header className="border-b border-white/10 bg-navy text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-control border border-white/20 bg-white/10 text-white" aria-hidden>
          <Landmark className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[17px] font-semibold leading-tight tracking-[0.01em]">ACICS</p>
            {devMode && (
              <span className="rounded-[4px] border border-saffron/60 bg-saffron/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-saffron">
                Local development mode
              </span>
            )}
          </div>
          <p className="truncate text-[11.5px] text-white/80">AICTE Complaint Intelligence &amp; Coordination System</p>
          <p className="mt-0.5 hidden text-[11px] text-white/60 sm:block">
            Grievance redressal, case coordination, and institutional oversight in one platform.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Help"
            onClick={() => setHelpOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-[11.5px] font-medium text-white/85 hover:bg-white/10 hover:text-white"
          >
            <CircleHelp className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Help</span>
          </button>
          <button
            type="button"
            aria-label="About"
            onClick={() => setAboutOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-[11.5px] font-medium text-white/85 hover:bg-white/10 hover:text-white"
          >
            <Info className="size-3.5" aria-hidden /> <span className="hidden sm:inline">About</span>
          </button>
        </div>
      </div>
      <div className="flex h-[3px]" aria-hidden>
        <span className="w-1/4 bg-saffron" />
        <span className="flex-1 bg-white/15" />
        <span className="w-1/4 bg-success" />
      </div>

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Help and guidance" description="Using the ACICS prototype portals." width={560}>
        <div className="space-y-4 text-[12.5px] leading-relaxed text-fg">
          {devMode ? (
            <div className="rounded-control border border-success/25 bg-success-soft p-3 text-[12px]">
              <p className="font-semibold text-success">Local development access is enabled</p>
              <p className="mt-1">
                Enter any non-empty user ID or email on the sign-in panel. A synthetic account with all four portal roles is
                created for exploration. This is not real authentication and is refused when the backend is in production mode.
              </p>
            </div>
          ) : (
            <p>Sign in with the credentials issued by your ACICS administrator. If you do not yet have an account, request Complainant Portal access and an administrator will review it.</p>
          )}
          <div>
            <p className="font-semibold text-navy-deep">Moving between portals</p>
            <p className="mt-1">Once signed in, use the portal switcher in the sidebar (or the mobile menu) to change views. Only portals granted to your account are listed.</p>
          </div>
          <div>
            <p className="font-semibold text-navy-deep">Prototype boundaries</p>
            <p className="mt-1">Complaint data is synthetic. Uploads are not stored, notifications are in-app only, and deadlines are illustrative rather than official AICTE service standards.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setHelpOpen(false)}>Close</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="About ACICS" description="AICTE Complaint Intelligence & Coordination System." width={560}>
        <div className="space-y-4 text-[12.5px] leading-relaxed text-fg">
          <p>ACICS is a prototype platform for complaint intake, case processing, administrative oversight, and bureau coordination across technical institutions.</p>
          <div>
            <p className="font-semibold text-navy-deep">Not an official service</p>
            <p className="mt-1">This deployment is not connected to live AICTE or Government of India systems and does not use official emblems. Accounts, institutions, cases, and deadlines are synthetic.</p>
          </div>
          <div>
            <p className="font-semibold text-navy-deep">Security model</p>
            <p className="mt-1">Portal access is decided server-side from account status, assigned roles, and bureau scope. Selecting a portal never grants access, and development mode cannot be enabled on a production deployment.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setAboutOpen(false)}>Close</Button>
          </div>
        </div>
      </Dialog>
    </header>
  )
}

export function GovFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-[11.5px] leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} ACICS prototype deployment. Not an official Government of India service.</p>
        <p className="text-faint">Synthetic data · prototype deadlines · no live AICTE integration</p>
      </div>
    </footer>
  )
}

function StepIndicator({ step, labels = STEPS }: { step: 1 | 2 | 3 | 4; labels?: string[] }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Access steps">
      {labels.map((label, index) => {
        const value = (index + 1) as 1 | 2 | 3 | 4
        const state = value < step ? 'done' : value === step ? 'current' : 'todo'
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={
                state === 'done'
                  ? 'grid size-5 shrink-0 place-items-center rounded-full bg-success text-white'
                  : state === 'current'
                    ? 'grid size-5 shrink-0 place-items-center rounded-full bg-navy text-white text-[10px] font-semibold'
                    : 'grid size-5 shrink-0 place-items-center rounded-full border border-line text-[10px] font-semibold text-faint'
              }
            >
              {state === 'done' ? <Check className="size-3" aria-hidden /> : value}
            </span>
            <span className={`truncate text-[10.5px] ${state === 'current' ? 'font-semibold text-navy-deep' : 'text-faint'}`}>{label}</span>
            {index < labels.length - 1 && <span className="ml-auto hidden h-px flex-1 bg-line sm:block" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

function PortalCard({
  item,
  selected,
  onSelect,
}: {
  item: { key: PortalKey; label: string; description: string; eligibility: string[] }
  selected: boolean
  onSelect: () => void
}) {
  const Icon = PORTAL_ICONS[item.key] ?? Users
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative flex h-full w-full flex-col rounded-card border bg-surface p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 ${
        selected ? 'border-navy ring-1 ring-navy/25' : 'border-line hover:border-line-strong'
      }`}
    >
      <span className="flex items-start gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-control border ${
            selected ? 'border-navy/25 bg-accent-soft text-navy' : 'border-line bg-surface-2 text-navy'
          }`}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block text-[14px] font-semibold leading-snug text-navy-deep">{item.label}</span>
            {selected && <CheckCircle2 className="size-4 shrink-0 text-navy" aria-hidden />}
          </span>
          <span className="mt-1.5 block min-h-[36px] text-[12px] leading-relaxed text-muted">{PORTAL_COPY[item.key]}</span>
        </span>
      </span>
      <span className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[12px] font-semibold text-navy">
        <span>{selected ? 'Selected' : 'Enter portal'}</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  )
}

function Assurance({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-control border border-line bg-surface text-navy [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-[12.5px] font-semibold text-navy-deep">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  )
}

function DevSignInPanel({
  portal,
  onBack,
  onSubmit,
  onRequestAccess,
}: {
  portal: { key: PortalKey; label: string }
  onBack: () => void
  onSubmit: (identifier: string, displayName: string) => Promise<void>
  onRequestAccess: () => void
}) {
  const [identifier, setIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!identifier.trim()) {
      setError('Enter a user ID or email address to continue.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(identifier.trim(), displayName.trim())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5 sm:p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-navy-deep">
        <ArrowLeft className="size-3.5" aria-hidden /> Change portal
      </button>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-navy-deep">Sign in to the {portal.label}</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            Local development access needs no account or password. Enter any non-empty ID or email to open a synthetic session.
          </p>
        </div>
        <Badge tone="success">LOCAL DEVELOPMENT MODE</Badge>
      </div>

      <div className="mt-4 rounded-control border border-success/25 bg-success-soft p-3 text-[11.5px] leading-relaxed text-navy-deep">
        <p className="font-semibold text-success">Development sign-in</p>
        <p className="mt-1">
          This session is synthetic, labelled, and refused when the backend runs with <span className="font-mono text-[10.5px]">APP_ENV=production</span>.
          It creates an account with all four portal roles so you can explore every view. Real authentication will be added later.
        </p>
      </div>

      {error && (
        <div role="alert" aria-live="assertive" className="mt-4 flex items-start gap-2 rounded-control border border-danger/25 bg-danger-soft p-3 text-[12px] leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3.5" noValidate>
        <Field label="User ID or email address">
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. reviewer@example.org or officer-01"
            autoComplete="username"
            autoFocus
            disabled={busy}
            required
          />
        </Field>
        <Field label="Display name (optional)">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Shown in the workspace header"
            autoComplete="name"
            disabled={busy}
          />
        </Field>

        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {busy ? 'Opening development session…' : 'Continue to portal'}
          {!busy && <ArrowRight />}
        </Button>
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        Need a real Complainant account instead?{' '}
        <button type="button" onClick={onRequestAccess} className="font-medium text-navy underline">
          Request Complainant Portal access
        </button>
        . Mock sign-in is for interface testing only and must never be described as verified identity.
      </p>
    </div>
  )
}

function SignInPanel({
  portal,
  googleConfigured,
  onBack,
  onSubmit,
  onForgot,
}: {
  portal: { key: PortalKey; label: string }
  googleConfigured: boolean
  onBack: () => void
  onSubmit: (email: string, password: string) => Promise<void>
  onForgot: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter the email address and password registered with your ACICS account.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(email.trim(), password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5 sm:p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-navy-deep">
        <ArrowLeft className="size-3.5" aria-hidden /> Change portal
      </button>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-navy-deep">Sign in to the {portal.label}</h2>
          <p className="mt-1 text-[12.5px] text-muted">Use your official credentials. Portal access is verified after sign-in.</p>
        </div>
        <Badge tone="accent">{portal.label.replace(' Portal', '')}</Badge>
      </div>

      {error && (
        <div role="alert" aria-live="assertive" className="mt-4 flex items-start gap-2 rounded-control border border-danger/25 bg-danger-soft p-3 text-[12px] leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3.5" noValidate>
        <Field label="Email address">
          <Input
            type="email"
            autoComplete="email"
            required
            placeholder="name@institution.ac.in"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="signin-password" className="text-[13px] font-medium text-fg">Password</label>
            <button type="button" onClick={onForgot} className="text-[11.5px] font-medium text-navy hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="pr-10"
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-muted hover:bg-surface-2 hover:text-fg"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {busy ? 'Verifying credentials…' : 'Sign in and verify eligibility'}
          {!busy && <ArrowRight />}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {googleConfigured ? (
        <Button className="w-full" onClick={() => { window.location.href = `/api/auth/google?portal=${portal.key}` }}>
          <GoogleMark /> Continue with Google
        </Button>
      ) : (
        <div className="rounded-control border border-line bg-surface-2 p-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-navy-deep">
            <GoogleMark /> Continue with Google
            <span className="ml-auto rounded-[4px] bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Not configured</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Google OAuth is prepared but no client credentials are configured for this environment. When enabled, sign-in will use
            OpenID Connect with state and nonce validation, and accounts will link by Google subject — never by email address alone.
          </p>
        </div>
      )}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  )
}

function EligibilityChecklist({ portal }: { portal: { key: PortalKey; label: string } }) {
  const rows = ['Identity authenticated', 'Account status verified', `Role and portal eligibility checked`, 'Bureau scope validated where required']
  return (
    <div className="p-5 sm:p-6" aria-live="polite" aria-busy>
      <h2 className="text-[16px] font-semibold text-navy-deep">Verifying eligibility</h2>
      <p className="mt-1 text-[12.5px] text-muted">Checking your account against server-side records for the {portal.label}.</p>
      <ul className="mt-5 space-y-3">
        {rows.map((row, index) => (
          <motion.li
            key={row}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.12 }}
            className="flex items-center gap-2.5 text-[12.5px] text-muted"
          >
            <Loader2 className="size-4 shrink-0 animate-spin text-navy" aria-hidden />
            {row}
          </motion.li>
        ))}
      </ul>
      <p className="mt-5 text-[11px] leading-relaxed text-faint">
        Portal selection is a request. Access is granted only when the account is active and holds the required role.
      </p>
    </div>
  )
}

function DecisionPanel({
  decision,
  portal,
  hasSession,
  onRetry,
  onRequestAccess,
  onSignOut,
}: {
  decision: PortalDecision | null
  portal: { key: PortalKey; label: string } | null
  hasSession: boolean
  onRetry: () => void
  onRequestAccess: () => void
  onSignOut: () => void
}) {
  if (!decision) return null
  const allowed = decision.allowed
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full ${allowed ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
          aria-hidden
        >
          {allowed ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
        </span>
        <div className="min-w-0">
          <h2 className={`text-[16px] font-semibold ${allowed ? 'text-success' : 'text-danger'}`}>
            {allowed ? 'Access granted' : 'Access not granted'}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {allowed
              ? `Opening the ${portal?.label ?? 'portal'} now.`
              : decision.error ?? 'Your account is not eligible for this portal.'}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-2 rounded-control border border-line bg-surface-2 p-3 text-[11.5px] sm:grid-cols-2">
        <div>
          <dt className="text-faint">Requested portal</dt>
          <dd className="mt-0.5 font-medium text-fg">{portal?.label ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-faint">Decision</dt>
          <dd className="mt-0.5 font-mono text-[11px] font-medium text-fg">{decision.code}</dd>
        </div>
        {decision.accountStatus && (
          <div>
            <dt className="text-faint">Account status</dt>
            <dd className="mt-0.5 font-medium text-fg">{decision.accountStatus.replaceAll('_', ' ').toLowerCase()}</dd>
          </div>
        )}
        {decision.roles && (
          <div>
            <dt className="text-faint">Assigned roles</dt>
            <dd className="mt-0.5 font-medium text-fg">{decision.roles.length ? decision.roles.map((role) => ROLE_LABELS[role]).join(', ') : 'None'}</dd>
          </div>
        )}
      </dl>

      {!allowed && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
          Signing in only proves identity. If you believe your role or account status is incorrect, contact your ACICS administrator
          — portal selection cannot grant access.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {!allowed && (
          <Button onClick={onRetry}>Choose another portal</Button>
        )}
        {!allowed && (
          <Button variant="primary" onClick={onRequestAccess}>
            Request Complainant access <ArrowRight />
          </Button>
        )}
        {hasSession && (
          <Button variant="ghost" onClick={onSignOut}><LogOut /> Sign out</Button>
        )}
      </div>
    </div>
  )
}

function AccountRequestForm({
  options,
  sent,
  onSent,
  onBack,
}: {
  options: { designations: string[]; institutions: { officialId: string; name: string; state: string }[] } | undefined
  sent: boolean
  onSent: () => void
  onBack: () => void
}) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '', designation: '', institutionOfficialId: '' })
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.fullName.trim().length < 2) return setError('Enter your full name as it appears in institutional records.')
    if (!form.email.includes('@')) return setError('Enter a valid email address.')
    if (form.password.length < 12) return setError('Choose a password of at least 12 characters.')
    if (form.password !== form.confirm) return setError('The passwords do not match.')
    if (!form.designation) return setError('Select your designation.')
    if (!form.institutionOfficialId) return setError('Select your institution.')
    if (!consent) return setError('Confirm that the information provided is accurate.')
    setBusy(true)
    try {
      await requestAccount({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        designation: form.designation,
        institutionOfficialId: form.institutionOfficialId,
      })
      onSent()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success" aria-hidden>
            <Check className="size-5" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-success">Request recorded</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              An ACICS administrator will verify your designation and institution. Access is not granted until that review is
              complete. You can close this page and sign in later.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onBack}>Return to sign in <ArrowRight /></Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 sm:p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-navy-deep">
        <ArrowLeft className="size-3.5" aria-hidden /> Back to sign in
      </button>
      <h2 className="mt-3 text-[16px] font-semibold text-navy-deep">Request Complainant Portal access</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        For faculty members, teachers, heads of departments, principals, and authorised institutional staff. Privileged roles cannot
        be requested here.
      </p>

      {error && (
        <div role="alert" aria-live="assertive" className="mt-4 rounded-control border border-danger/25 bg-danger-soft p-3 text-[12px] leading-relaxed text-danger">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3.5" noValidate>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={form.fullName} onChange={(e) => update('fullName', e.target.value)} placeholder="Dr. A. Sharma" autoComplete="name" disabled={busy} />
          </Field>
          <Field label="Email address">
            <Input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="name@institution.ac.in" autoComplete="email" disabled={busy} />
          </Field>
          <Field label="Designation">
            <Select value={form.designation} onChange={(e) => update('designation', e.target.value)} disabled={busy}>
              <option value="">Select designation</option>
              {(options?.designations ?? []).map((designation) => (
                <option key={designation} value={designation}>{designation}</option>
              ))}
            </Select>
          </Field>
          <Field label="Institution">
            <Select value={form.institutionOfficialId} onChange={(e) => update('institutionOfficialId', e.target.value)} disabled={busy}>
              <option value="">Select institution</option>
              {(options?.institutions ?? []).map((institution) => (
                <option key={institution.officialId} value={institution.officialId}>
                  {institution.name} ({institution.officialId})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Password" hint="At least 12 characters">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                autoComplete="new-password"
                disabled={busy}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-muted hover:bg-surface-2 hover:text-fg"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} autoComplete="new-password" disabled={busy} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted">
          <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I confirm the information is accurate and understand that an administrator must approve this request.</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onBack} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Submit request</Button>
        </div>
      </form>
    </div>
  )
}

function ForgotPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    try {
      await api('/auth/forgot-password', { method: 'POST', json: { email: email.trim() } })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => { onClose(); setSent(false); setError(null) }}
      title="Password recovery"
      description="Recovery guidance is queued for active accounts only."
      width={440}
    >
      {sent ? (
        <div className="space-y-3">
          <p className="rounded-control border border-success/25 bg-success-soft p-3 text-[12.5px] leading-relaxed text-success">
            If an active account is registered with this address, recovery guidance has been queued.
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted">
            Institutional and bureau officers may also contact the ACICS administrator directly for identity verification.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => { onClose(); setSent(false) }}>Close</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <p role="alert" className="rounded-control border border-danger/25 bg-danger-soft p-3 text-[12px] text-danger">{error}</p>}
          <Field label="Registered email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@institution.ac.in" autoComplete="email" disabled={busy} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Request recovery</Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
