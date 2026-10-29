import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  FileWarning,
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

import { api, ApiError, checkPortalAccess, demoLogin, login, logout, requestAccount, setActivePortal, useAuthStatus, useOnboardingOptions } from '../lib/api'
import type { AcicsRole, PortalDecision, PortalKey } from '../lib/api'
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, useToast } from '../components/ui'

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

const STEPS = ['Select portal', 'Sign in', 'Verify eligibility', 'Access decision']

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
  const toast = useToast()
  const qc = useQueryClient()

  const [portal, setPortal] = useState<PortalKey | null>(initialPortalFromUrl)
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

  const useDemoAccount = async (sub: string, roles: AcicsRole[]) => {
    const landingPortal = portal ?? portalForRoles(roles) ?? 'complainant'
    setPortal(landingPortal)
    try {
      await demoLogin(sub)
      await enterPortal(landingPortal)
    } catch (error) {
      toast(errorMessage(error), 'danger')
      setStep(2)
    }
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

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <GovStrip />
      <GovHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
            <section aria-labelledby="portal-access-heading">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-saffron">Secure access</p>
              <h1 id="portal-access-heading" className="mt-3 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy-deep sm:text-[34px]">
                One platform, four authorised portals
              </h1>
              <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">
                ACICS supports grievance redressal, case processing, bureau coordination, and administrative oversight. Portal
                selection only tells us where you are trying to go — access is always decided from your server-side account.
              </p>

              <div className="mt-7 space-y-3">
                <Assurance icon={<ShieldCheck />} title="Server-side eligibility" body="Roles, account status, and bureau assignment are verified on the server for every request." />
                <Assurance icon={<Lock />} title="Identity is not authorisation" body="A correct password proves who you are. It does not grant a privileged portal." />
                <Assurance icon={<Landmark />} title="Administrator-controlled provisioning" body="Complainant, Official, Bureau, and Administrator roles are assigned by authorised administrators." />
              </div>

              <div className="mt-8 rounded-card border border-line bg-surface p-4">
                <p className="text-[13px] font-semibold text-navy-deep">Faculty and institutional staff</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  Eligible complainants can request access and are verified against their stated designation and institution before
                  the Complainant Portal is enabled.
                </p>
                <Button className="mt-3" size="sm" onClick={() => { setShowAccountRequest(true); setRequestSent(false) }}>
                  Request Complainant Portal access <ArrowRight />
                </Button>
              </div>
            </section>

            <section aria-label="Portal sign in" className="lg:pt-1">
              {notice && (
                <div role="status" className="mb-4 rounded-control border border-[#e68a24]/40 bg-[#fdf1e2] p-3 text-[12px] leading-relaxed text-[#102a43]">
                  {notice}
                </div>
              )}
              <StepIndicator step={step} />
              <Card className="mt-4 overflow-hidden border border-line">
                {showAccountRequest ? (
                  <AccountRequestForm
                    options={onboarding}
                    sent={requestSent}
                    onSent={() => setRequestSent(true)}
                    onBack={() => setShowAccountRequest(false)}
                  />
                ) : step === 1 ? (
                  <div className="p-5 sm:p-6">
                    <h2 className="text-[16px] font-semibold text-navy-deep">Select a portal</h2>
                    <p className="mt-1 text-[12.5px] text-muted">Choosing a portal requests access to it. It does not grant access.</p>
                    <fieldset className="mt-4">
                      <legend className="sr-only">Choose the portal you want to enter</legend>
                      <div className="grid gap-2.5 sm:grid-cols-2">
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
                    <div className="mt-5 flex items-center justify-between gap-3">
                      <p className="text-[11.5px] leading-snug text-faint">
                        Privileged roles cannot be requested from this page.
                      </p>
                      <Button variant="primary" disabled={!portal} onClick={() => setStep(2)}>
                        Continue to sign in <ArrowRight />
                      </Button>
                    </div>
                  </div>
                ) : step === 2 && selected ? (
                  <SignInPanel
                    portal={selected}
                    googleConfigured={Boolean(status?.googleConfigured)}
                    devAuthEnabled={Boolean(status?.devAuthEnabled)}
                    demoAccounts={status?.demoAccounts ?? []}
                    onBack={() => setStep(1)}
                    onSubmit={submitCredentials}
                    onDemo={useDemoAccount}
                    onForgot={() => setForgotOpen(true)}
                  />
                ) : step === 3 && selected ? (
                  <EligibilityChecklist portal={selected} />
                ) : (
                  <DecisionPanel
                    decision={decision}
                    portal={selected}
                    hasSession={hasSession}
                    onRetry={() => { setDecision(null); setStep(1) }}
                    onRequestAccess={() => { setShowAccountRequest(true); setRequestSent(false) }}
                    onSignOut={signOut}
                  />
                )}
              </Card>

              <p className="mt-4 text-center text-[11.5px] leading-relaxed text-faint">
                This is a demonstration deployment. Accounts, institutions, and cases in the dataset are synthetic. Do not enter
                real confidential information.
              </p>
            </section>
          </div>
        </div>
      </main>
      <GovFooter />
      <ForgotPasswordDialog open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  )
}

function portalForRoles(roles: AcicsRole[]): PortalKey | null {
  if (roles.includes('ADMIN')) return 'admin'
  if (roles.includes('BUREAU_OFFICER')) return 'bureau'
  if (roles.includes('OFFICIAL')) return 'official'
  if (roles.includes('COMPLAINANT')) return 'complainant'
  return null
}

export function GovStrip() {
  return (
    <div className="bg-navy-deep text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[11px] sm:px-6">
        <span className="tracking-wide">Government of India · All India Council for Technical Education</span>
        <span className="flex items-center gap-1.5 text-white/75">
          <Lock className="size-3" aria-hidden /> Secure government portal
        </span>
      </div>
      <div className="h-[3px] bg-saffron" />
    </div>
  )
}

export function GovHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <span className="grid size-11 place-items-center rounded-control border border-line bg-accent-soft text-navy" aria-hidden>
          <Landmark className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-navy-deep">ACICS</p>
          <p className="truncate text-[11.5px] text-muted">AICTE Complaint Intelligence &amp; Coordination System</p>
        </div>
        <span className="ml-auto hidden rounded-[4px] border border-line px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted sm:inline">
          Restricted access
        </span>
      </div>
    </header>
  )
}

export function GovFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-[11.5px] leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} ACICS demonstration deployment. Not an official Government of India service.</p>
        <p className="text-faint">Synthetic data · prototype deadlines · no live AICTE integration</p>
      </div>
    </footer>
  )
}

function StepIndicator({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Access steps">
      {STEPS.map((label, index) => {
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
            {index < STEPS.length - 1 && <span className="ml-auto hidden h-px flex-1 bg-line sm:block" aria-hidden />}
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
    <label
      className={`group relative flex cursor-pointer gap-3 rounded-control border p-3 transition-colors ${
        selected ? 'border-navy bg-accent-soft ring-1 ring-navy/20' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
      }`}
    >
      <input type="radio" name="acics-portal" value={item.key} checked={selected} onChange={onSelect} className="sr-only" />
      <span
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-control border ${
          selected ? 'border-navy/20 bg-surface text-navy' : 'border-line bg-surface-2 text-muted'
        }`}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold leading-tight text-navy-deep">{item.label}</span>
        <span className="mt-1 block text-[11px] leading-snug text-muted">{item.description}</span>
        <span className="mt-1.5 block text-[10.5px] leading-snug text-faint">Eligible: {item.eligibility.join(' · ')}</span>
      </span>
      {selected && <CheckCircle2 className="absolute right-2.5 top-2.5 size-4 text-navy" aria-hidden />}
    </label>
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

function SignInPanel({
  portal,
  googleConfigured,
  devAuthEnabled,
  demoAccounts,
  onBack,
  onSubmit,
  onDemo,
  onForgot,
}: {
  portal: { key: PortalKey; label: string }
  googleConfigured: boolean
  devAuthEnabled: boolean
  demoAccounts: { sub: string; name: string; email: string; roles: AcicsRole[] }[]
  onBack: () => void
  onSubmit: (email: string, password: string) => Promise<void>
  onDemo: (sub: string, roles: AcicsRole[]) => Promise<void>
  onForgot: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState<string | null>(null)
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
            disabled={busy || Boolean(demoBusy)}
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
              disabled={busy || Boolean(demoBusy)}
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

        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={Boolean(demoBusy)}>
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

      {devAuthEnabled && demoAccounts.length > 0 && (
        <div className="mt-4 rounded-control border border-dashed border-saffron/50 bg-saffron-soft/60 p-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-navy-deep">
            <FileWarning className="size-3.5 text-saffron" aria-hidden /> Local development accounts
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Synthetic identities for testing only. They exist because this instance is running on a loopback origin without an OAuth
            provider. Disabled in production and whenever Google OAuth is configured.
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {demoAccounts.map((account) => (
              <button
                key={account.sub}
                type="button"
                disabled={Boolean(demoBusy) || busy}
                onClick={async () => {
                  setDemoBusy(account.sub)
                  try {
                    await onDemo(account.sub, account.roles)
                  } finally {
                    setDemoBusy(null)
                  }
                }}
                className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong disabled:opacity-60"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-navy">
                  {account.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-navy-deep">{account.name}</span>
                  <span className="block truncate text-[10.5px] text-muted">{account.roles.map((role) => ROLE_LABELS[role]).join(' + ')}</span>
                </span>
                {demoBusy === account.sub ? <Loader2 className="size-3.5 animate-spin text-muted" aria-hidden /> : <ChevronRight className="size-3.5 text-faint" aria-hidden />}
              </button>
            ))}
          </div>
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
        {!allowed && decision.code === 'PORTAL_NOT_AUTHORIZED' && (
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
