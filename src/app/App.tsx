import { useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Loader2, LogOut, ShieldAlert } from 'lucide-react'

import { ToastProvider, Button, Card } from './components/ui'
import { Acics } from './pages/Acics'
import { GovFooter, GovHeader, GovStrip, PortalAccess } from './pages/PortalAccess'
import { ApiError, getActivePortal, logout, setActivePortal, useAuthMe } from './lib/api'

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
})

function Gate() {
  const me = useAuthMe()
  const qc = useQueryClient()
  const [showAccess, setShowAccess] = useState(false)
  const [requestMode, setRequestMode] = useState(false)
  const clearedPortal = useRef(false)

  const status = me.error instanceof ApiError ? me.error.status : null
  const code = me.error instanceof ApiError ? me.error.code : null

  // A stale portal preference from a previous account must not lock the user
  // out; drop it and re-evaluate with the account's primary role.
  useEffect(() => {
    if (status === 403 && (code === 'PORTAL_NOT_AUTHORIZED' || code === 'PORTAL_UNKNOWN') && getActivePortal() && !clearedPortal.current) {
      clearedPortal.current = true
      setActivePortal(null)
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    }
  }, [status, code, qc])

  const signedIn = async () => {
    clearedPortal.current = false
    // Keep the resolved account while refetching: resetting here flashes the
    // "Verifying your session" gate between the granted screen and the workspace.
    await qc.invalidateQueries({ queryKey: ['auth'] })
    await qc.invalidateQueries({ queryKey: ['acics'] })
  }

  const signedOut = async () => {
    clearedPortal.current = false
    // resetQueries, not invalidateQueries: after sign-out the cached account
    // must be dropped, otherwise a failed refetch keeps rendering the old
    // session's workspace.
    await qc.resetQueries({ queryKey: ['auth'] })
    await qc.invalidateQueries({ queryKey: ['acics'] })
  }

  if (me.isLoading) {
    return (
      <AuthShell>
        <Card className="border border-line p-8">
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin text-navy" aria-hidden />
            Verifying your session and account status…
          </div>
        </Card>
      </AuthShell>
    )
  }

  if (me.data) {
    return <Acics account={me.data} onSwitchPortal={signedIn} onSignedOut={signedOut} />
  }

  if (status === 401 || showAccess) {
    return <PortalAccess key={requestMode ? 'request' : 'access'} initialRequest={requestMode} onSignedIn={signedIn} />
  }

  if (status === 403) {
    return <AccessHeld code={code ?? null} message={me.error instanceof Error ? me.error.message : 'Portal access is not available for this account.'} onSignOut={async () => { await logout(); setActivePortal(null); await signedOut() }} onRequestAccess={() => { setRequestMode(true); setShowAccess(true) }} />
  }
  return (
    <AuthShell>
      <Card className="border border-line p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger" aria-hidden>
            <ShieldAlert className="size-4.5" />
          </span>
          <div>
            <h1 className="text-[16px] font-semibold text-navy-deep">Unable to verify access</h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              {me.error instanceof Error ? me.error.message : 'The authorization service did not respond.'}
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => me.refetch()}>Try again</Button>
              <Button variant="ghost" onClick={() => { setRequestMode(false); setShowAccess(true) }}>Open sign in</Button>
            </div>
          </div>
        </div>
      </Card>
    </AuthShell>
  )
}

function AccessHeld({ code, message, onSignOut, onRequestAccess }: { code: string | null; message: string; onSignOut: () => void; onRequestAccess: () => void }) {
  const pending = code === 'ACCOUNT_PENDING_APPROVAL' || code === 'ACCOUNT_PENDING_VERIFICATION' || code === 'ACCOUNT_NOT_PROVISIONED'
  return (
    <AuthShell>
      <Card className="border border-line p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-warning" aria-hidden>
            <ShieldAlert className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-saffron">Access pending review</p>
            <h1 className="mt-1 text-[18px] font-semibold text-navy-deep">
              {code === 'ACCOUNT_SUSPENDED' ? 'This account is suspended' : code === 'ACCOUNT_REJECTED' ? 'This request was not approved' : 'Your account is not active yet'}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{message}</p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              Authentication succeeded, but portal access is decided by account status and assigned roles. Contact your ACICS
              administrator if you need help with this decision.
            </p>
            {code && <p className="mt-3 font-mono text-[11px] text-faint">Reference: {code}</p>}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {(pending || code === 'ACCOUNT_NO_ROLE') && <Button onClick={onRequestAccess}>Request access</Button>}
          <Button variant={pending ? 'ghost' : 'primary'} onClick={onSignOut}>
            <LogOut /> Sign out
          </Button>
        </div>
      </Card>
    </AuthShell>
  )
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <GovStrip />
      <GovHeader />
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-lg">{children}</div>
      </main>
      <GovFooter />
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </QueryClientProvider>
  )
}
