import { Activity, AlertTriangle, ArrowRight, Bell, Building2, Check, ChevronLeft, ChevronRight, ClipboardList, Eye, EyeOff, FileText, Landmark, Loader2, Lock, LogOut, Plus, Search, ShieldCheck, Users, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import { Badge, Button, Card, Checkbox, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '../components/ui'

type Role='COMPLAINANT'|'OFFICIAL'|'ADMIN'|'BUREAU_OFFICER'
type AcicsUser={user:{sub:string;name:string;email:string};role:Role;bureau:{id:string;name:string;code:string}|null;demo:boolean}
type Case={id:string;complaintNumber:string;subject:string;description:string;category:string;priority:string;status:string;institution:{id:string;officialId:string;name:string;state:string;district:string;type:string};assignedBureau?:{id:string;name:string;code:string}|null;assignedOfficer?:string|null;dueAt:number;overdue:boolean;publicRemarks:string;submittedAt:number;lastActionAt:number;resolvedAt:number|null}
type Alert={id:string;caseA:{id:string;number:string;subject:string;description:string;category:string;status:string;bureau:string};caseB:{id:string;number:string;subject:string;description:string;category:string;status:string;bureau:string};institution:{id:string;officialId:string;name:string};score:number;matchingReasons:string[];reviewStatus:string;reviewNotes:string;createdAt:number}
const NAV: Array<[string, string, (r: Role) => boolean]> = [
  ['Overview', 'overview', () => true],
  ['Case queue', 'complaints', () => true],
  ['Cross-bureau overlaps', 'overlaps', (r) => r !== 'COMPLAINANT'],
  ['Institutions', 'institutions', (r) => r !== 'COMPLAINANT'],
  ['User management', 'users', (r) => r === 'ADMIN'],
  ['Bureau directory', 'bureau', (r) => r !== 'COMPLAINANT'],
  ['Notifications', 'notifications', () => true],
  ['Audit log', 'audit', (r) => r === 'ADMIN'],
]
const STATUSES=['SUBMITTED','UNDER_REVIEW','UNDER_PROCESS','AWAITING_INFORMATION','TRANSFERRED','ESCALATED','RESOLVED','CLOSED','REJECTED']
const CATEGORIES=['Faculty and staffing','Infrastructure and facilities','Academic quality','Regulatory compliance','Student grievances','Institutional administration','Other']
const fmt=(stamp:number)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium'}).format(new Date(stamp))
const statusTone=(s:string):'neutral'|'accent'|'success'|'warning'|'danger'|'info'=>({SUBMITTED:'info',UNDER_REVIEW:'accent',UNDER_PROCESS:'accent',AWAITING_INFORMATION:'warning',TRANSFERRED:'info',ESCALATED:'danger',RESOLVED:'success',CLOSED:'neutral',REJECTED:'danger'} as any)[s]||'neutral'
const titleCase=(s:string)=>s.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(a)=>a.toUpperCase())
async function fetchJson<T>(path:string):Promise<T>{return api<T>(`/acics${path}`)}

export function Acics(){
 const qc=useQueryClient(),{data:me,isLoading,error,refetch}=useQuery({queryKey:['acics','me'],queryFn:()=>fetchJson<AcicsUser>('/me'),retry:false}),active=me as AcicsUser|undefined
 const [page,setPage]=useState('overview'),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[pageNo,setPageNo]=useState(1),[selected,setSelected]=useState<string|null>(null),[compose,setCompose]=useState(false),[alertSelected,setAlertSelected]=useState<string|null>(null),[institution,setInstitution]=useState<string|null>(null)
 const toast=useToast()

 useEffect(() => {
   if (active) {
     const currentNavItem = NAV.find(([_, key]) => key === page)
     if (currentNavItem && !currentNavItem[2](active.role)) {
       setPage('overview')
       setSelected(null)
     }
   }
 }, [active, page])

 const login=async(email:string,pass:string)=>{
   await api('/auth/login',{method:'POST',json:{email,password:pass}})
   await qc.invalidateQueries({queryKey:['acics']})
   await refetch()
   toast('Signed in successfully','neutral')
 }
 const logout=async()=>{
   try{
     await api('/auth/logout',{method:'POST'})
     await qc.clear()
     await refetch()
     toast('Signed out successfully','neutral')
   }catch(e){
     toast((e as Error).message,'danger')
   }
 }
 if(isLoading&&!active)return <div className="grid h-full place-items-center"><Skeleton className="h-10 w-48"/></div>
 if(error&&!active){
   if((error as any).status===401)return <AcicsSignIn onLogin={login} toast={toast}/>
   return <div className="mx-auto max-w-xl p-10"><h1 className="text-xl font-semibold">ACICS cannot load your account</h1><p className="mt-2 text-muted">{(error as Error).message}</p><Button className="mt-4" onClick={()=>refetch()}>Retry</Button></div>
 }
 if(!active)return <AcicsSignIn onLogin={login} toast={toast}/>
 return <div className="flex h-full min-h-0 bg-[#f4f6f8] text-[#263445]">
  <aside className="hidden w-[245px] shrink-0 flex-col border-r border-[#dce2e8] bg-white md:flex">
   <div className="flex h-[70px] items-center gap-3 border-b border-[#dce2e8] px-5"><div className="grid size-9 place-items-center rounded-md bg-[#17324d] text-white"><Landmark className="size-5"/></div><div><p className="text-sm font-semibold text-[#17324d]">ACICS</p><p className="text-[10px] tracking-wide text-[#687586]">COORDINATION PLATFORM</p></div></div>
   <div className="border-b border-[#dce2e8] px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-[#687586]">Workspace</p><div className="mt-2 flex items-center gap-2"><div className="grid size-8 place-items-center rounded bg-[#edf2f6] text-[#315f85]"><ShieldCheck className="size-4"/></div><div className="min-w-0"><p className="truncate text-xs font-medium">{active.role==='BUREAU_OFFICER'?active.bureau?.name:roleName(active.role)}</p><p className="text-[11px] text-[#687586]">{roleName(active.role)}</p></div></div></div>
   <nav className="flex-1 px-3 py-4">{NAV.filter(([, , check]) => check(active.role)).map(([label,key])=><button key={key} onClick={()=>{setPage(key);setSelected(null)}} className={`mb-1 flex h-10 w-full items-center gap-3 rounded px-3 text-left text-[13px] ${page===key?'bg-[#eaf0f5] font-semibold text-[#17324d]':'text-[#586779] hover:bg-[#f4f6f8]'}`}><NavIcon name={key}/>{label}</button>)}</nav>
   <div className="border-t border-[#dce2e8] p-3"><div className="px-2 py-2"><p className="truncate text-xs font-semibold">{active.user.name}</p><p className="truncate text-[11px] text-[#687586]">{active.user.email}</p></div><Button className="w-full justify-start" onClick={()=>void logout()}><LogOut/>Sign out</Button></div>
  </aside>
  <main className="min-w-0 flex-1 overflow-y-auto">
   <header className="sticky top-0 z-10 flex min-h-[62px] items-center justify-between border-b border-[#dce2e8] bg-white px-4 sm:px-7"><div><p className="text-[11px] text-[#687586]">AICTE / {roleName(active.role)} / <span className="text-[#263445]">{pageTitle(page)}</span></p><p className="mt-0.5 text-sm font-semibold text-[#17324d]">{pageTitle(page)}</p></div><div className="flex items-center gap-2"><Badge tone="accent">{roleName(active.role)}</Badge><Button size="icon-sm" aria-label="Notifications" onClick={()=>setPage('notifications')}><Bell/></Button><span className="hidden size-8 items-center justify-center rounded-full bg-[#315f85] text-xs font-semibold text-white sm:flex">{initials(active.user.name)}</span></div></header>
   <nav aria-label="Primary navigation" className="sticky top-[62px] z-[9] flex gap-1 overflow-x-auto border-b border-[#dce2e8] bg-white px-3 py-2 md:hidden">{NAV.filter(([, , check]) => check(active.role)).map(([label,key])=><button key={key} onClick={()=>setPage(key)} className={`shrink-0 rounded px-3 py-2 text-xs ${page===key?'bg-[#eaf0f5] font-semibold text-[#17324d]':'text-[#586779]'}`}>{label}</button>)}</nav>
   <div className="mx-auto max-w-[1380px] p-4 sm:p-7">
    {page==='overview'&&<Overview user={active} go={setPage}/>}
    {page==='complaints'&&<ComplaintQueue user={active} query={query} setQuery={setQuery} status={status} setStatus={setStatus} category={category} setCategory={setCategory} pageNo={pageNo} setPageNo={setPageNo} onOpen={setSelected} onNew={()=>setCompose(true)}/>}
    {page==='overlaps'&&<Overlaps onSelect={setAlertSelected}/>}
    {page==='institutions'&&<Institutions onOpen={setInstitution} query={query} setQuery={setQuery} role={active.role} toast={toast}/>}
    {page==='users'&&<AdminUsers toast={toast}/>}
    {page==='notifications'&&<Notifications toast={toast}/>}
    {page==='audit'&&<Audit onCase={setSelected}/>}
    {page==='settings'&&<Settings user={active}/>}
    {page==='bureau'&&<Bureaus/>}
   </div>
  </main>
  {selected&&<CaseDrawer id={selected} user={active} onClose={()=>setSelected(null)} toast={toast}/>}
  {alertSelected&&<OverlapDrawer id={alertSelected} onClose={()=>setAlertSelected(null)} toast={toast}/>}
  {institution&&<InstitutionDrawer id={institution} onClose={()=>setInstitution(null)} onCase={setSelected}/>}
  {compose&&<SubmitForm onClose={()=>setCompose(false)} toast={toast}/>}
 </div>
}
function initials(s:string){return s.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}
function roleName(r:Role){return ({COMPLAINANT:'Complainant Portal',OFFICIAL:'Official Workspace',ADMIN:'Administration',BUREAU_OFFICER:'Bureau Workspace'} as const)[r]}
function pageTitle(p:string){return Object.fromEntries(NAV.map(([l,k])=>[k,l]))[p]||'Settings'}
function NavIcon({name}:{name:string}){const C:any=({overview:Activity,complaints:ClipboardList,overlaps:AlertTriangle,institutions:Building2,notifications:Bell,audit:ShieldCheck,settings:Users} as any)[name]||FileText;return <C className="size-4"/>}

function AcicsSignIn({onLogin,toast}:{onLogin:(email:string,pass:string)=>Promise<void>;toast:(m:string,t?:'neutral'|'danger')=>void}){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [showPassword,setShowPassword]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [forgotOpen,setForgotOpen]=useState(false)
  const [forgotEmail,setForgotEmail]=useState('')
  const [forgotSent,setForgotSent]=useState(false)
  const [forgotBusy,setForgotBusy]=useState(false)

  const handleSubmit=async(e:React.FormEvent)=>{
    e.preventDefault()
    setError(null)
    if(!email.trim()||!password){
      setError('Please provide your registered email address and password.')
      return
    }
    setBusy(true)
    try{
      await onLogin(email.trim(),password)
    }catch(err:any){
      setError(err.message||'Invalid email or password.')
    }finally{
      setBusy(false)
    }
  }

  const handleForgotSubmit=async(e:React.FormEvent)=>{
    e.preventDefault()
    if(!forgotEmail.trim()||!forgotEmail.includes('@')){
      toast('Please enter a valid institutional or personal email address.','danger')
      return
    }
    setForgotBusy(true)
    try{
      await api('/auth/forgot-password',{method:'POST',json:{email:forgotEmail.trim()}})
      setForgotSent(true)
      toast('Password recovery guidance dispatched.','neutral')
    }catch(err:any){
      toast((err as Error).message||'Unable to request password recovery.','danger')
    }finally{
      setForgotBusy(false)
    }
  }

  const handleGoogleClick=async()=>{
    try{
      const res=await fetch('/api/auth/google',{headers:{accept:'application/json'}})
      if(res.status===501){
        const body=(await res.json().catch(()=>({}))) as { message?: string }
        toast(body.message||'Google OAuth is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.','danger')
      }else if(res.ok&&res.redirected){
        window.location.href=res.url
      }else{
        toast('Google Sign-In is awaiting OAuth credential configuration.','danger')
      }
    }catch{
      toast('Google OAuth provider service unavailable. Use email/password.','danger')
    }
  }

  return <div className="flex min-h-full items-center justify-center bg-[#f4f6f8] px-4 py-8">
    <Card className="w-full max-w-[480px] overflow-hidden border border-[#dce2e8] bg-white shadow-md">
      <div className="bg-[#17324d] px-7 py-6 text-white">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg bg-white/10 text-white ring-1 ring-white/20">
            <Landmark className="size-6"/>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">ACICS</h1>
            <p className="text-xs text-white/80">AICTE Complaint Intelligence & Coordination System</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-white/80">
          A secure institutional platform for grievance redressal, inter-bureau coordination, and oversight.
        </p>
      </div>

      <div className="p-7">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-[#17324d]">Sign in to your account</h2>
          <p className="mt-1 text-xs text-[#586779]">
            Enter your official credentials to access your designated role portal.
          </p>
        </div>

        {error&&<div role="alert" className="mb-5 flex items-start gap-2.5 rounded-md border border-[#e8c8c2] bg-[#fdf1ef] p-3 text-xs text-[#994b3e]"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#a14537]"/><div className="flex-1 leading-relaxed">{error}</div></div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="acics-email" className="block text-xs font-medium text-[#263445]">Email address</label>
            <div className="relative mt-1">
              <Input id="acics-email" type="email" autoComplete="email" required placeholder="name@example.test or institutional email" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy} className="w-full text-xs"/>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="acics-password" className="block text-xs font-medium text-[#263445]">Password</label>
              <button type="button" onClick={()=>{setForgotOpen(true);setForgotSent(false);setForgotEmail(email)}} className="text-[11px] font-medium text-[#315f85] hover:underline">Forgot password?</button>
            </div>
            <div className="relative mt-1">
              <Input id="acics-password" type={showPassword?'text':'password'} autoComplete="current-password" required placeholder="Enter your password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} className="w-full pr-10 text-xs"/>
              <button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#687586] hover:text-[#263445]">
                {showPassword?<EyeOff className="size-4"/>:<Eye className="size-4"/>}
              </button>
            </div>
          </div>

          <Button type="submit" variant="primary" disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 py-2.5 text-xs font-semibold">
            {busy?<><Loader2 className="size-4 animate-spin"/><span>Verifying credentials...</span></>:<><Lock className="size-3.5"/><span>Sign In</span><ArrowRight className="size-4"/></>}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#dce2e8]"/>
          <span className="text-[11px] font-medium text-[#687586]">OR</span>
          <div className="h-px flex-1 bg-[#dce2e8]"/>
        </div>

        <button type="button" onClick={handleGoogleClick} disabled={busy} className="flex w-full items-center justify-center gap-2.5 rounded-md border border-[#dce2e8] bg-white py-2 text-xs font-medium text-[#263445] shadow-xs hover:bg-[#f8fafb] hover:border-[#ccd4dc] disabled:opacity-50">
          <svg className="size-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Continue with Google</span>
        </button>

        <div className="mt-6 rounded border border-[#e1e6eb] bg-[#f8fafb] p-3 text-[11px] leading-relaxed text-[#586779]">
          <div className="flex items-center gap-1.5 font-medium text-[#17324d]">
            <ShieldCheck className="size-3.5 text-[#315f85]"/>
            <span>Role-Based Access Control</span>
          </div>
          <p className="mt-1">
            Your server-assigned role (Complainant, Case Officer, Bureau Officer, or Admin) is verified and loaded from database records upon authentication.
          </p>
        </div>
      </div>
    </Card>

    {forgotOpen&&<Drawer open={forgotOpen} title="Password Recovery" onClose={()=>setForgotOpen(false)}>
      {forgotSent?<div className="space-y-4 p-4">
        <div className="rounded border border-[#c8dfd8] bg-[#f0f8f5] p-3 text-xs leading-relaxed text-[#218c87]">
          <p className="font-semibold">Recovery Guidance Dispatched</p>
          <p className="mt-1">If an active account is registered under <strong>{forgotEmail}</strong>, instructions to reset your password have been queued.</p>
        </div>
        <p className="text-[11px] text-[#687586]">Institutional and Bureau users may also contact the AICTE central coordinator at admin@aicte-india.org.</p>
        <Button className="w-full" variant="primary" onClick={()=>setForgotOpen(false)}>Back to Sign In</Button>
      </div>:<form onSubmit={handleForgotSubmit} className="space-y-4 p-4">
        <p className="text-xs text-[#586779]">Enter the email address associated with your ACICS account. We will dispatch instructions to restore access.</p>
        <Field label="Registered email">
          <Input type="email" required placeholder="name@example.test" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} className="w-full text-xs"/>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={()=>setForgotOpen(false)} disabled={forgotBusy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={forgotBusy}>{forgotBusy?'Sending...':'Request Reset'}</Button>
        </div>
      </form>}
    </Drawer>}
  </div>
}
function Stat({label,value,hint}:{label:string;value:string|number;hint?:string}){return <Card className="border border-[#dce2e8] p-4 shadow-none"><p className="text-xs text-[#687586]">{label}</p><p className="mt-2 text-[25px] font-semibold leading-none text-[#17324d]">{value}</p>{hint&&<p className="mt-2 text-[11px] text-[#687586]">{hint}</p>}</Card>}
function Overview({user,go}:{user:AcicsUser;go:(p:string)=>void}){const {data,isLoading,error}=useAcics<any>('/analytics'),complainant=user.role==='COMPLAINANT',{data:cases}=useAcics<{items:Case[]}>('/complaints?pageSize=5'),stats=complainant?[['My complaints',data?.totals?.total??0,'Submitted by you'],['In review',cases?.items.filter(c=>['UNDER_REVIEW','UNDER_PROCESS'].includes(c.status)).length??0,'Being assessed'],['Need information',cases?.items.filter(c=>c.status==='AWAITING_INFORMATION').length??0,'Response may be needed'],['Resolved',data?.totals?.resolved??0,'Completed cases']]:[['Total cases',data?.totals?.total??0,'Within your authorized scope'],['Open cases',data?.totals?.open??0,'Require further action'],['Overdue',data?.totals?.overdue??0,'Demonstration rule'],['Overlap reviews',data?.pendingOverlapReviews??0,'Pending staff review']];return <><PageHeader title={complainant?`Welcome, ${user.user.name.split(' ')[0]}`:`${user.bureau?.code||roleName(user.role)} overview`} subtitle={complainant?'Your complaints and their latest progress.':'Current workload from persisted synthetic demonstration records.'} actions={complainant?<Button variant="primary" onClick={()=>go('complaints')}>My complaints <ArrowRight/></Button>:<Button onClick={()=>go('complaints')}>Open case queue <ArrowRight/></Button>}/><div className="mt-3 flex items-center gap-2 rounded border border-[#dce2e8] bg-white px-3 py-2 text-[11px] text-[#687586]"><span className="size-2 rounded-full bg-[#218c87]"/>Synthetic demonstration data · prototype deadlines are not official AICTE service standards.</div>{error&&<ErrorBox message={(error as Error).message}/>}<div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{stats.map(([label,value,hint])=>isLoading?<Skeleton key={label} className="h-28"/>:<Stat key={label} label={label as string} value={value as number} hint={hint as string}/>)}</div><div className="mt-4 grid gap-4 lg:grid-cols-3"><Card className="border border-[#dce2e8] p-5 shadow-none lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">{complainant?'Recent complaints':'Case status distribution'}</h2><p className="mt-1 text-xs text-[#687586]">{complainant?'Your latest submissions':'Current authorized case scope'}</p></div>{!complainant&&<Button size="sm" onClick={()=>go('complaints')}>Case queue</Button>}</div>{complainant?<CaseTable rows={cases?.items||[]} onOpen={()=>go('complaints')}/>:<div className="mt-5 space-y-3">{(data?.statuses||[]).map((s:any)=>{const pct=Math.round(s.count/Math.max(1,Number(data?.totals?.total||1))*100);return <div key={s.status}><div className="mb-1 flex justify-between text-xs"><span>{titleCase(s.status)}</span><span className="tabular-nums text-[#687586]">{s.count}</span></div><div className="h-2 overflow-hidden rounded bg-[#edf0f3]"><div className="h-full bg-[#315f85]" style={{width:`${pct}%`}}/></div></div>})}</div>}</Card><Card className="border border-[#dce2e8] p-5 shadow-none"><h2 className="text-sm font-semibold">{user.role==='ADMIN'?'System scope':'Actions'}</h2>{user.role==='ADMIN'?<div className="mt-4 grid grid-cols-2 gap-2"><MiniStat label="Active users" value={data?.users??0}/><MiniStat label="Institutions" value={data?.institutions??0}/><MiniStat label="Open cases" value={data?.totals?.open??0}/><MiniStat label="Pending review" value={data?.pendingOverlapReviews??0}/></div>:<div className="mt-4 flex flex-col gap-2"><Button className="justify-start" onClick={()=>go('overlaps')}><AlertTriangle/>Review overlap alerts</Button><Button className="justify-start" onClick={()=>go('institutions')}><Building2/>Institution profiles</Button><Button className="justify-start" onClick={()=>go('notifications')}><Bell/>Notifications</Button></div>}<p className="mt-5 border-t border-[#dce2e8] pt-3 text-[11px] leading-relaxed text-[#687586]">An overlap is decision support, not proof of duplication or legal validity.</p></Card></div><Card className="mt-4 border border-[#dce2e8] p-5 shadow-none"><h2 className="text-sm font-semibold">Recently updated cases</h2><CaseTable rows={cases?.items||[]} onOpen={()=>go('complaints')}/></Card></>}
function MiniStat({label,value}:{label:string;value:number}){return <div className="rounded bg-[#f4f6f8] p-3"><p className="text-[10px] text-[#687586]">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>}
function ErrorBox({message}:{message:string}){return <div role="alert" className="mt-4 rounded border border-[#e8c8c2] bg-[#fdf1ef] p-3 text-xs text-[#994b3e]">Unable to load this section: {message}</div>}
function useAcics<T>(path:string){return useQuery({queryKey:['acics',path],queryFn:()=>fetchJson<T>(path),staleTime:10_000})}

function ComplaintQueue({user,query,setQuery,status,setStatus,category,setCategory,pageNo,setPageNo,onOpen,onNew}:{user:AcicsUser;query:string;setQuery:(v:string)=>void;status:string;setStatus:(v:string)=>void;category:string;setCategory:(v:string)=>void;pageNo:number;setPageNo:(v:number)=>void;onOpen:(id:string)=>void;onNew:()=>void}){
 const params=new URLSearchParams({page:String(pageNo),pageSize:'12'});if(query)params.set('q',query);if(status)params.set('status',status);if(category)params.set('category',category)
 const {data,isLoading,error}=useAcics<{items:Case[];total:number;page:number;pageSize:number}>(`/complaints?${params}`),canSubmit=user.role==='COMPLAINANT'
 return <><PageHeader title={canSubmit?'My complaints':'Assigned complaints'} subtitle={`${data?.total??0} cases · ${canSubmit?'Only your submissions are shown.':'Scoped to your authorized assignment.'}`} actions={canSubmit&&<Button variant="primary" onClick={onNew}>Submit a complaint</Button>}/><div className="mt-5 flex flex-wrap gap-2"><label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 size-4 text-[#687586]"/><Input aria-label="Search cases" className="pl-9" placeholder="Search ID, subject, institution" value={query} onChange={e=>{setQuery(e.target.value);setPageNo(1)}}/></label><Select aria-label="Filter by status" className="w-[190px]" value={status} onChange={e=>{setStatus(e.target.value);setPageNo(1)}}><option value="">All statuses</option>{STATUSES.map(s=><option key={s} value={s}>{titleCase(s)}</option>)}</Select><Select aria-label="Filter by category" className="w-[220px]" value={category} onChange={e=>{setCategory(e.target.value);setPageNo(1)}}><option value="">All categories</option>{CATEGORIES.map(s=><option key={s}>{s}</option>)}</Select><Button onClick={()=>{setQuery('');setStatus('');setCategory('');setPageNo(1)}}>Reset</Button></div>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 overflow-hidden border border-[#dce2e8] shadow-none">{isLoading?<div className="space-y-2 p-5"><Skeleton className="h-10"/><Skeleton className="h-10"/><Skeleton className="h-10"/></div>:<CaseTable rows={data?.items||[]} onOpen={onOpen}/>}<div className="flex items-center justify-between border-t border-[#dce2e8] px-4 py-3 text-xs text-[#687586]"><span>Page {pageNo} of {Math.max(1,Math.ceil((data?.total||0)/12))}</span><div className="flex gap-2"><Button size="sm" disabled={pageNo<=1} onClick={()=>setPageNo(pageNo-1)}><ChevronLeft/>Previous</Button><Button size="sm" disabled={pageNo>=Math.ceil((data?.total||0)/12)} onClick={()=>setPageNo(pageNo+1)}>Next<ChevronRight/></Button></div></div></Card></>}
function CaseTable({rows,onOpen}:{rows:Case[];onOpen:(id:string)=>void}){if(!rows.length)return <EmptyState icon={<ClipboardList/>} title="No complaints found" description="Try adjusting the filters or submit a new complaint."/>;return <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="sticky top-0 bg-[#f8fafb] text-[#687586]"><tr className="h-10 border-b border-[#dce2e8]"><th className="px-4 font-medium">Complaint</th><th className="px-3 font-medium">Institution</th><th className="px-3 font-medium">Category</th><th className="px-3 font-medium">Bureau</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Due date</th></tr></thead><tbody className="divide-y divide-[#e7ebef]">{rows.map(r=><tr key={r.id} onClick={()=>onOpen(r.id)} className="h-[58px] cursor-pointer hover:bg-[#f8fafb]"><td className="px-4"><span className="block font-semibold text-[#17324d]">{r.complaintNumber}</span><span className="mt-0.5 block max-w-[280px] truncate text-[#586779]">{r.subject}</span></td><td className="max-w-[180px] truncate px-3">{r.institution.name}</td><td className="max-w-[180px] truncate px-3">{r.category}</td><td className="px-3">{r.assignedBureau?.code||'—'}</td><td className="px-3"><Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge></td><td className={`px-3 ${r.overdue?'font-semibold text-[#a14537]':''}`}>{r.overdue?'Overdue · ':''}{fmt(r.dueAt)}</td></tr>)}</tbody></table></div>}

function SubmitForm({onClose,toast}:{onClose:()=>void;toast:(m:string,t?:'neutral'|'danger')=>void}){
  const [form,setForm]=useState({subject:'',institutionOfficialId:'',category:'',description:'',incidentDate:'',consent:false})
  const [submitted,setSubmitted]=useState<{complaintNumber:string}|null>(null)
  const [validation,setValidation]=useState('')
  const [review,setReview]=useState(false)
  const [fileName,setFileName]=useState('')
  const qc=useQueryClient()
  const {data:instData}=useAcics<{items:any[]}>('/institutions-list')

  const send=async()=>{const result=await api<{item:{complaintNumber:string}}>('/acics/complaints',{method:'POST',json:form});await qc.invalidateQueries({queryKey:['acics']});return result}
  const set=(key:string,value:any)=>setForm(f=>({...f,[key]:value}))
  if(submitted)return <Modal title="Complaint received" onClose={onClose}><div className="rounded border border-[#c8dfd8] bg-[#f0f8f5] p-4 text-sm"><Check className="mb-2 size-5 text-[#218c87]"/><p>Your synthetic demonstration complaint has been registered.</p><p className="mt-2 font-semibold">Reference: {submitted.complaintNumber}</p><p className="mt-2 text-xs text-[#687586]">Keep this ID to track progress from My complaints. This prototype does not connect to AICTE systems.</p></div><Button className="mt-4 w-full" variant="primary" onClick={onClose}>Done</Button></Modal>
  return <Modal title={review?'Review complaint':'Submit a complaint'} onClose={onClose}><p className="mb-4 text-xs text-[#687586]">Fields marked required. Category labels are suggested prototype defaults, not official AICTE classifications.</p>{!review?<div className="space-y-4"><Field label="Complaint subject"><Input required minLength={8} maxLength={180} value={form.subject} onChange={e=>set('subject',e.target.value)} placeholder="Summarize the concern"/></Field><Field label="Institution" hint="Select an AICTE-listed institution or enter identifier"><Select required value={form.institutionOfficialId} onChange={e=>set('institutionOfficialId',e.target.value)}><option value="">Choose institution</option>{instData?.items?.map(i=><option key={i.id} value={i.officialId}>{i.name} ({i.officialId})</option>)}</Select></Field><Field label="Complaint category"><Select required value={form.category} onChange={e=>set('category',e.target.value)}><option value="">Choose category</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</Select></Field><Field label="Detailed description" hint={`${form.description.length}/5000 · At least 30 characters`}><Textarea required minLength={30} maxLength={5000} rows={5} value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Describe what happened, when, and the impact."/></Field><Field label="Incident date (optional)"><Input type="date" value={form.incidentDate} onChange={e=>set('incidentDate',e.target.value)}/></Field><Field label="Supporting document (optional)" hint="Prototype file selection only; confidential document storage is not enabled for case evidence."><Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setFileName(e.target.files?.[0]?.name||'')}/>{fileName&&<span className="text-xs">Selected: {fileName}</span>}</Field><label className="flex items-start gap-2 text-xs leading-relaxed"><Checkbox checked={form.consent} onChange={e=>set('consent',e.target.checked)}/><span>I confirm the information is accurate to the best of my knowledge and consent to its processing for this prototype.</span></label>{validation&&<ErrorBox message={validation}/>}<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={()=>{if(form.subject.trim().length<8||!form.institutionOfficialId.trim()||!form.category||form.description.trim().length<30||!form.consent){setValidation('Complete the subject, institution identifier, category, a 30-character description, and the declaration. Your entered data is preserved.');return}setValidation('');setReview(true)}}>Review submission <ArrowRight/></Button></div></div>:<div><Card className="border border-[#dce2e8] p-4 shadow-none"><p className="text-[11px] text-[#687586]">SUBJECT</p><p className="mt-1 font-medium">{form.subject}</p><p className="mt-4 text-[11px] text-[#687586]">INSTITUTION</p><p className="mt-1">{form.institutionOfficialId}</p><p className="mt-4 text-[11px] text-[#687586]">CATEGORY</p><p className="mt-1">{form.category}</p><p className="mt-4 text-[11px] text-[#687586]">DESCRIPTION</p><p className="mt-1 whitespace-pre-wrap text-sm">{form.description}</p>{fileName&&<p className="mt-4 text-xs">Selected file (not uploaded): {fileName}</p>}</Card>{validation&&<ErrorBox message={validation}/>}<div className="mt-4 flex justify-between"><Button onClick={()=>setReview(false)}><ChevronLeft/>Edit</Button><Button variant="primary" onClick={async()=>{try{const result=await send();setSubmitted(result.item);toast('Complaint submitted successfully')}catch(e){setValidation((e as Error).message)}}}>Confirm and submit</Button></div></div>}</Modal>
}

function CaseDrawer({id,user,onClose,toast}:{id:string;user:AcicsUser;onClose:()=>void;toast:(m:string,t?:'neutral'|'danger')=>void}){
  const {data,isLoading,error}=useAcics<{item:Case;actions:any[];related:any[]}>(`/complaints/${id}`)
  const {data:bureausData}=useAcics<{items:any[]}>('/bureaus')
  const {data:officersData}=useAcics<{items:any[]}>('/officers')
  const qc=useQueryClient()
  const [remarks,setRemarks]=useState('')
  const [next,setNext]=useState('')
  const [targetBureau,setTargetBureau]=useState('')
  const [assignOfficer,setAssignOfficer]=useState('')
  const [visibility,setVisibility]=useState('INTERNAL')
  const item=data?.item,allowed=user.role!=='COMPLAINANT'
  const canTransition=(s:string)=>({SUBMITTED:['UNDER_REVIEW','REJECTED'],UNDER_REVIEW:['UNDER_PROCESS','AWAITING_INFORMATION','TRANSFERRED','ESCALATED','REJECTED'],UNDER_PROCESS:['AWAITING_INFORMATION','TRANSFERRED','ESCALATED','RESOLVED'],AWAITING_INFORMATION:['UNDER_PROCESS','RESOLVED'],TRANSFERRED:['UNDER_REVIEW','UNDER_PROCESS','ESCALATED'],ESCALATED:['UNDER_PROCESS','RESOLVED'],RESOLVED:['CLOSED','UNDER_PROCESS'],CLOSED:[],REJECTED:[]} as any)[s]||[]
  const action=async(path:string,body:any)=>{await api(`/acics${path}`,{method:'POST',json:body});await qc.invalidateQueries({queryKey:['acics']});setRemarks('');toast('Case action recorded')}
  const doAssign=async()=>{
    try{
      await api(`/acics/complaints/${id}/assign`,{method:'PATCH',json:{officerId:assignOfficer||null,remarks:`Assigned to officer ${assignOfficer||'unassigned'}`}})
      await qc.invalidateQueries({queryKey:['acics']})
      toast('Officer assignment updated')
    }catch(e){toast((e as Error).message,'danger')}
  }

  return <Drawer open onClose={onClose} title={item?.complaintNumber||'Complaint details'} width={620}>
    {isLoading?<div className="space-y-3 p-6"><Skeleton className="h-8"/><Skeleton className="h-20"/></div>:error?<div className="p-6"><ErrorBox message={(error as Error).message}/></div>:item&&<div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(item.status)}>{titleCase(item.status)}</Badge>
        <Badge tone={item.priority==='HIGH'?'danger':'neutral'}>{item.priority} priority</Badge>
        {item.overdue&&<Badge tone="danger">Overdue</Badge>}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[#17324d]">{item.subject}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#4c5d70]">{item.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded border border-[#dce2e8] bg-[#f8fafb] p-3 text-xs">
        <div><p className="text-[#687586]">Institution</p><button className="mt-1 text-left font-semibold text-[#315f85] underline" onClick={()=>{onClose()}}>{item.institution.name}</button></div>
        <div><p className="text-[#687586]">Identifier</p><p className="mt-1 font-medium">{item.institution.officialId}</p></div>
        <div><p className="text-[#687586]">Category</p><p className="mt-1">{item.category}</p></div>
        <div><p className="text-[#687586]">Assigned bureau</p><p className="mt-1">{item.assignedBureau?.name||'Not disclosed'}</p></div>
        <div><p className="text-[#687586]">Submitted</p><p className="mt-1">{fmt(item.submittedAt)}</p></div>
        <div><p className="text-[#687586]">Due date · prototype</p><p className={`mt-1 ${item.overdue?'font-semibold text-[#a14537]':''}`}>{fmt(item.dueAt)}</p></div>
      </div>
      {item.publicRemarks&&<div className="rounded border border-[#dce2e8] p-3"><p className="text-xs font-semibold">Public update</p><p className="mt-1 text-sm">{item.publicRemarks}</p></div>}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Case history</h3>
        <ol className="space-y-3 border-l border-[#dce2e8] pl-4">
          {data?.actions.map(a=><li key={a.id} className="relative text-xs">
            <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-[#315f85]"/>
            <p className="font-medium">{a.actionType.replaceAll('_',' ')}</p>
            <p className="mt-0.5 text-[#687586]">{a.actor} · {fmt(a.createdAt)} {a.visibility==='INTERNAL'&&allowed?'· Internal':''}</p>
            {a.remarks&&<p className="mt-1 text-[#4c5d70]">{a.remarks}</p>}
          </li>)}
        </ol>
      </section>
      {allowed&&<><section className="border-t border-[#dce2e8] pt-4">
        <h3 className="text-sm font-semibold">Process case</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px]">
          <Select aria-label="Next status" value={next} onChange={e=>setNext(e.target.value)}>
            <option value="">Choose permitted status</option>
            {canTransition(item.status).map((s:string)=><option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <Select aria-label="Remark visibility" value={visibility} onChange={e=>setVisibility(e.target.value)}>
            <option value="INTERNAL">Internal note</option>
            <option value="PUBLIC">Public update</option>
          </Select>
        </div>
        {next==='TRANSFERRED'&&<div className="mt-3">
          <Field label="Destination bureau" hint="Select target coordinating bureau for transfer">
            <Select value={targetBureau} onChange={e=>setTargetBureau(e.target.value)}>
              <option value="">Choose bureau</option>
              {bureausData?.items?.filter(b=>b.id!==item.assignedBureau?.id).map(b=><option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </Select>
          </Field>
        </div>}
        <Textarea className="mt-2" rows={3} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Add a case remark, information request, or action rationale"/>
        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={!remarks.trim()} onClick={()=>action(`/complaints/${id}/actions`,{remarks,visibility})}>Add remark</Button>
          <Button variant="primary" disabled={!next||(next==='TRANSFERRED'&&!targetBureau)} onClick={async()=>{
            try{
              await api(`/acics/complaints/${id}/status`,{method:'PATCH',json:{status:next,remarks,visibility,targetBureauId:targetBureau||undefined}})
              await qc.invalidateQueries({queryKey:['acics']})
              setNext('')
              setTargetBureau('')
              setRemarks('')
              toast('Status updated and audit event added')
            }catch(e){toast((e as Error).message,'danger')}
          }}>Update status</Button>
        </div>
      </section>
      {(user.role==='ADMIN'||user.role==='BUREAU_OFFICER')&&<section className="border-t border-[#dce2e8] pt-4">
        <h3 className="text-sm font-semibold">Assign case officer</h3>
        <div className="mt-2 flex gap-2">
          <Select aria-label="Assign officer" className="flex-1" value={assignOfficer||item.assignedOfficer||''} onChange={e=>setAssignOfficer(e.target.value)}>
            <option value="">Unassigned</option>
            {officersData?.items?.map(o=><option key={o.sub} value={o.sub}>{o.fullName} ({o.role}{o.bureauCode?` · ${o.bureauCode}`:''})</option>)}
          </Select>
          <Button onClick={doAssign}>Assign</Button>
        </div>
      </section>}</>}
      <section className="border-t border-[#dce2e8] pt-4">
        <h3 className="text-sm font-semibold">{user.role==='COMPLAINANT'?'Respond to information request':'Coordination notes'}</h3>
        <Textarea className="mt-2" rows={3} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Write a response or note"/>
        <div className="mt-2 flex justify-end">
          <Button variant="primary" disabled={remarks.trim().length<3} onClick={async()=>{
            if(user.role==='COMPLAINANT'&&item.status==='AWAITING_INFORMATION'){
              await api(`/acics/complaints/${id}/status`,{method:'PATCH',json:{status:'UNDER_PROCESS',remarks,visibility:'PUBLIC'}});
              await qc.invalidateQueries({queryKey:['acics']});
              setRemarks('');
              toast('Information sent; case returned to processing')
            }else action(`/complaints/${id}/actions`,{remarks})
          }}>Send response</Button>
        </div>
      </section>
    </div>}
  </Drawer>
}

function Overlaps({onSelect}:{onSelect:(id:string)=>void}){const {data,isLoading,error}=useAcics<{items:Alert[]}>('/overlaps');const [filter,setFilter]=useState('PENDING');const rows=(data?.items||[]).filter(a=>!filter||a.reviewStatus===filter);return <><PageHeader title="Cross-bureau overlap center" subtitle="Explainable, rule-based candidate pairs for human review. Records remain separate."/><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[#687586]">Exact synthetic institution ID is required; category and text overlap explain prioritization. Scores are not proof of duplication.</p><Select className="w-48" aria-label="Review status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All alerts</option>{['PENDING','CONFIRMED','REJECTED','INVESTIGATE'].map(s=><option key={s}>{s}</option>)}</Select></div>{error&&<ErrorBox message={(error as Error).message}/>}<div className="mt-4 space-y-3">{isLoading?<Skeleton className="h-32"/>:rows.map(a=><Card key={a.id} className="border border-[#dce2e8] p-4 shadow-none"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Badge tone={a.reviewStatus==='PENDING'?'warning':a.reviewStatus==='CONFIRMED'?'success':'neutral'}>{titleCase(a.reviewStatus)}</Badge><span className="text-xs text-[#687586]">{Math.round(a.score*100)}% rule score · {fmt(a.createdAt)}</span></div><h3 className="mt-2 text-sm font-semibold">{a.institution.name}</h3><p className="mt-0.5 text-[11px] text-[#687586]">Institution identifier: {a.institution.officialId}</p></div><Button onClick={()=>onSelect(a.id)}>Compare cases <ArrowRight/></Button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><PairSummary data={a.caseA}/><PairSummary data={a.caseB}/></div><div className="mt-3 flex flex-wrap gap-1.5">{a.matchingReasons.map(r=><Badge key={r} tone="info">{r}</Badge>)}</div></Card>)}{!isLoading&&!rows.length&&<EmptyState icon={<AlertTriangle/>} title="No alerts in this view" description="Potential cross-bureau relationships will appear here for staff review."/>}</div></>}
function PairSummary({data}:{data:Alert['caseA']}){return <div className="rounded border border-[#e3e8ed] bg-[#fafbfc] p-3"><p className="text-[11px] font-semibold text-[#315f85]">{data.number} · {data.bureau}</p><p className="mt-1 text-xs font-medium">{data.subject}</p><p className="mt-1 line-clamp-2 text-[11px] text-[#687586]">{data.description}</p><p className="mt-2 text-[10px] text-[#687586]">{data.category} · {titleCase(data.status)}</p></div>}
function OverlapDrawer({id,onClose,toast}:{id:string;onClose:()=>void;toast:(m:string,t?:'neutral'|'danger')=>void}){const {data,isLoading,error}=useAcics<{items:Alert[]}>(`/overlaps`),alert=data?.items.find(a=>a.id===id),[notes,setNotes]=useState(''),qc=useQueryClient();const decide=async(decision:string)=>{try{await api(`/acics/overlaps/${id}/review`,{method:'PATCH',json:{decision,notes}});await qc.invalidateQueries({queryKey:['acics']});toast(`Relationship marked ${decision.toLowerCase()}; audit history recorded`);onClose()}catch(e){toast((e as Error).message,'danger')}};return <Modal title="Compare potential overlap" onClose={onClose} width={840}>{isLoading?<Skeleton className="h-40"/>:error?<ErrorBox message={(error as Error).message}/>:alert&&<><div className="rounded border border-[#dce2e8] bg-[#f8fafb] p-3 text-xs"><p className="font-semibold">{alert.institution.name} · {alert.institution.officialId}</p><p className="mt-1 text-[#687586]">Rule-based score: {Math.round(alert.score*100)}%. A relationship does not merge records or change either status.</p><div className="mt-2 flex flex-wrap gap-1">{alert.matchingReasons.map(r=><Badge key={r} tone="info">{r}</Badge>)}</div></div><div className="mt-3 grid gap-3 md:grid-cols-2"><CaseCompare item={alert.caseA}/><CaseCompare item={alert.caseB}/></div><Field label="Coordination / review note"><Textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Record why this relationship is confirmed or rejected"/></Field><div className="mt-4 flex flex-wrap justify-end gap-2"><Button onClick={onClose}>Close</Button><Button onClick={()=>decide('INVESTIGATE')}>Further investigation</Button><Button onClick={()=>decide('REJECTED')}>Reject false match</Button><Button variant="primary" onClick={()=>decide('CONFIRMED')}>Confirm relationship</Button></div></>}</Modal>}
function CaseCompare({item}:{item:Alert['caseA']}){return <div className="rounded border border-[#dce2e8] p-4"><div className="flex justify-between"><Badge>{item.number}</Badge><Badge tone={statusTone(item.status)}>{titleCase(item.status)}</Badge></div><p className="mt-3 font-semibold">{item.subject}</p><p className="mt-1 text-[11px] text-[#687586]">{item.bureau} · {item.category}</p><p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed">{item.description}</p></div>}

function Institutions({onOpen,query,setQuery,role,toast}:{onOpen:(id:string)=>void;query:string;setQuery:(q:string)=>void;role:Role;toast:(m:string,t?:'neutral'|'danger')=>void}){
  const {data,isLoading,error}=useAcics<{items:any[]}>(`/institutions?q=${encodeURIComponent(query)}`)
  const [adding,setAdding]=useState(false)
  const [newInst,setNewInst]=useState({name:'',officialId:'',state:'',district:'',type:'Technical institute'})
  const qc=useQueryClient()

  const createInst=async()=>{
    try{
      await api('/acics/admin/institutions',{method:'POST',json:newInst})
      await qc.invalidateQueries({queryKey:['acics']})
      setAdding(false)
      setNewInst({name:'',officialId:'',state:'',district:'',type:'Technical institute'})
      toast('Institution added successfully')
    }catch(e){toast((e as Error).message,'danger')}
  }

  return <><PageHeader title="Institution profiles" subtitle="Unified view using verified synthetic institution identifiers; names alone do not merge records." actions={role==='ADMIN'&&<Button variant="primary" onClick={()=>setAdding(true)}><Plus/> Add institution</Button>}/><label className="relative mt-4 block max-w-lg"><Search className="absolute left-3 top-2.5 size-4 text-[#687586]"/><Input className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or institution identifier"/></label>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 overflow-hidden border border-[#dce2e8] shadow-none">{isLoading?<Skeleton className="m-4 h-28"/>:<div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-[#f8fafb] text-[#687586]"><tr className="h-10 border-b"><th className="px-4">Institution</th><th className="px-3">Identifier</th><th className="px-3">Location</th><th className="px-3">Cases</th><th className="px-3">Open</th><th/></tr></thead><tbody className="divide-y">{data?.items.map(i=><tr key={i.id} className="h-14 hover:bg-[#f8fafb]"><td className="px-4 font-medium">{i.name}</td><td className="px-3 font-mono text-[11px]">{i.officialId}</td><td className="px-3">{i.district}, {i.state}</td><td className="px-3">{i.complaintCount||0}</td><td className="px-3">{i.openCount||0}</td><td className="pr-3"><Button size="sm" onClick={()=>onOpen(i.id)}>View profile</Button></td></tr>)}</tbody></table></div>}</Card>
  {adding&&<Modal title="Add institution" onClose={()=>setAdding(false)}>
    <div className="space-y-4">
      <Field label="Institution name"><Input value={newInst.name} onChange={e=>setNewInst(i=>({...i,name:e.target.value}))} placeholder="Apex Technical University"/></Field>
      <Field label="Official identifier" hint="Unique AICTE-format code"><Input value={newInst.officialId} onChange={e=>setNewInst(i=>({...i,officialId:e.target.value}))} placeholder="AICTE-DEMO-011"/></Field>
      <Field label="State"><Input value={newInst.state} onChange={e=>setNewInst(i=>({...i,state:e.target.value}))} placeholder="Karnataka"/></Field>
      <Field label="District"><Input value={newInst.district} onChange={e=>setNewInst(i=>({...i,district:e.target.value}))} placeholder="Bengaluru"/></Field>
      <Field label="Institution type">
        <Select value={newInst.type} onChange={e=>setNewInst(i=>({...i,type:e.target.value}))}>
          <option>Public technical institute</option>
          <option>Private engineering college</option>
          <option>Technical university</option>
          <option>Management institute</option>
          <option>Public polytechnic</option>
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={()=>setAdding(false)}>Cancel</Button>
        <Button variant="primary" disabled={!newInst.name.trim()||!newInst.officialId.trim()} onClick={createInst}>Add institution</Button>
      </div>
    </div>
  </Modal>}
  </>
}

function InstitutionDrawer({id,onClose,onCase}:{id:string;onClose:()=>void;onCase:(id:string)=>void}){const {data,isLoading,error}=useAcics<any>(`/institutions/${id}`);return <Drawer open onClose={onClose} title="Institution profile" width={650}>{isLoading?<Skeleton className="m-6 h-40"/>:error?<div className="p-5"><ErrorBox message={(error as Error).message}/></div>:data&&<div className="p-5"><h2 className="text-lg font-semibold">{data.institution.name}</h2><p className="mt-1 text-xs text-[#687586]">{data.institution.officialId} · {data.institution.type} · {data.institution.district}, {data.institution.state}</p><div className="mt-4 grid grid-cols-2 gap-3"><Stat label="Related cases" value={data.cases.length}/><Stat label="Open" value={data.cases.filter((c:Case)=>!['RESOLVED','CLOSED','REJECTED'].includes(c.status)).length}/></div><h3 className="mt-6 text-sm font-semibold">Case history</h3><div className="mt-2">{data.cases.length?<CaseTable rows={data.cases} onOpen={id=>{onClose();onCase(id)}}/>:<p className="py-6 text-center text-xs text-[#687586]">No authorized cases for this institution.</p>}</div></div>}</Drawer>}

function AdminUsers({toast}:{toast:(m:string,t?:'neutral'|'danger')=>void}){
  const qc=useQueryClient()
  const [q,setQ]=useState('')
  const [roleFilter,setRoleFilter]=useState('')
  const [adding,setAdding]=useState(false)
  const [editing,setEditing]=useState<any|null>(null)
  const {data,isLoading,error}=useAcics<{items:any[]}>(`/admin/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(roleFilter)}`)
  const {data:bureaus}=useAcics<{items:any[]}>('/bureaus')
  const [newUser,setNewUser]=useState({fullName:'',email:'',role:'OFFICIAL',bureauId:''})
  const [editForm,setEditForm]=useState({fullName:'',role:'OFFICIAL',bureauId:'',active:1})

  const createUser=async()=>{
    try{
      await api('/acics/admin/users',{method:'POST',json:newUser})
      await qc.invalidateQueries({queryKey:['acics']})
      setAdding(false)
      setNewUser({fullName:'',email:'',role:'OFFICIAL',bureauId:''})
      toast('User created successfully')
    }catch(e){
      toast((e as Error).message,'danger')
    }
  }

  const updateUser=async()=>{
    if(!editing)return
    try{
      await api(`/acics/admin/users/${editing.sub}`,{method:'PATCH',json:editForm})
      await qc.invalidateQueries({queryKey:['acics']})
      setEditing(null)
      toast('User updated successfully')
    }catch(e){
      toast((e as Error).message,'danger')
    }
  }

  return (
    <>
      <PageHeader title="User and role management" subtitle="Manage authorized personnel, bureau assignments, and role access." actions={<Button variant="primary" onClick={()=>setAdding(true)}><Plus/> Add user</Button>}/>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-[#687586]"/>
          <Input aria-label="Search users" className="pl-9" placeholder="Search by name, email, or ID" value={q} onChange={e=>setQ(e.target.value)}/>
        </label>
        <Select aria-label="Filter role" className="w-48" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          <option value="COMPLAINANT">Complainant</option>
          <option value="OFFICIAL">Official</option>
          <option value="BUREAU_OFFICER">Bureau Officer</option>
          <option value="ADMIN">Administrator</option>
        </Select>
      </div>
      {error&&<ErrorBox message={(error as Error).message}/>}
      <Card className="mt-4 overflow-x-auto border border-[#dce2e8] shadow-none">
        {isLoading?<Skeleton className="m-4 h-32"/>:(
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-[#f8fafb] text-[#687586]">
              <tr className="h-10 border-b">
                <th className="px-4">Name / ID</th>
                <th className="px-3">Email</th>
                <th className="px-3">Role</th>
                <th className="px-3">Bureau</th>
                <th className="px-3">Status</th>
                <th className="px-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items.map(u=>(
                <tr key={u.sub} className="h-12 hover:bg-[#f8fafb]">
                  <td className="px-4">
                    <span className="block font-semibold text-[#17324d]">{u.fullName}</span>
                    <span className="block text-[10px] text-[#687586] font-mono">{u.sub}</span>
                  </td>
                  <td className="px-3">{u.email}</td>
                  <td className="px-3"><Badge tone={u.role==='ADMIN'?'accent':u.role==='BUREAU_OFFICER'?'info':'neutral'}>{titleCase(u.role)}</Badge></td>
                  <td className="px-3">{u.bureau||'—'}</td>
                  <td className="px-3"><Badge tone={u.active?'success':'danger'}>{u.active?'Active':'Deactivated'}</Badge></td>
                  <td className="px-3">
                    <Button size="sm" onClick={()=>{setEditing(u);setEditForm({fullName:u.fullName,role:u.role,bureauId:u.bureauId||'',active:u.active})}}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {adding&&<Modal title="Add new user" onClose={()=>setAdding(false)}>
        <div className="space-y-4">
          <Field label="Full name"><Input value={newUser.fullName} onChange={e=>setNewUser(u=>({...u,fullName:e.target.value}))} placeholder="Dr. S. Sharma"/></Field>
          <Field label="Email address"><Input type="email" value={newUser.email} onChange={e=>setNewUser(u=>({...u,email:e.target.value}))} placeholder="s.sharma@aicte.test"/></Field>
          <Field label="System role">
            <Select value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))}>
              <option value="COMPLAINANT">Complainant</option>
              <option value="OFFICIAL">Official</option>
              <option value="BUREAU_OFFICER">Bureau Officer</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
          {newUser.role==='BUREAU_OFFICER'&&<Field label="Bureau assignment">
            <Select value={newUser.bureauId} onChange={e=>setNewUser(u=>({...u,bureauId:e.target.value}))}>
              <option value="">Select bureau</option>
              {bureaus?.items.map(b=><option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </Select>
          </Field>}
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={()=>setAdding(false)}>Cancel</Button>
            <Button variant="primary" disabled={!newUser.fullName.trim()||!newUser.email.trim()} onClick={createUser}>Create user</Button>
          </div>
        </div>
      </Modal>}
      {editing&&<Modal title={`Edit user: ${editing.fullName}`} onClose={()=>setEditing(null)}>
        <div className="space-y-4">
          <Field label="Full name"><Input value={editForm.fullName} onChange={e=>setEditForm(f=>({...f,fullName:e.target.value}))}/></Field>
          <Field label="System role">
            <Select value={editForm.role} onChange={e=>setEditForm(f=>({...f,role:e.target.value}))}>
              <option value="COMPLAINANT">Complainant</option>
              <option value="OFFICIAL">Official</option>
              <option value="BUREAU_OFFICER">Bureau Officer</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
          {editForm.role==='BUREAU_OFFICER'&&<Field label="Bureau assignment">
            <Select value={editForm.bureauId} onChange={e=>setEditForm(f=>({...f,bureauId:e.target.value}))}>
              <option value="">Select bureau</option>
              {bureaus?.items.map(b=><option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </Select>
          </Field>}
          <Field label="Account status">
            <Select value={String(editForm.active)} onChange={e=>setEditForm(f=>({...f,active:Number(e.target.value)}))}>
              <option value="1">Active</option>
              <option value="0">Deactivated</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={()=>setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={updateUser}>Save changes</Button>
          </div>
        </div>
      </Modal>}
    </>
  )
}

function Notifications({toast}:{toast:(m:string,t?:'neutral'|'danger')=>void}){
  const {data,isLoading,error}=useAcics<{items:any[]}>('/notifications'),qc=useQueryClient();
  const markAll=async()=>{
    try{
      await api('/acics/notifications/read-all',{method:'PATCH'})
      await qc.invalidateQueries({queryKey:['acics']})
      toast('All notifications marked as read')
    }catch(e){toast((e as Error).message,'danger')}
  }
  return <><PageHeader title="Notifications" subtitle="In-app confirmations and case updates for this signed-in identity." actions={Boolean(data?.items?.some(n=>!n.readAt))&&<Button onClick={markAll}>Mark all as read</Button>}/>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 divide-y border border-[#dce2e8] shadow-none">{isLoading?<Skeleton className="m-4 h-20"/>:data?.items.length?data.items.map(n=><div key={n.id} className="flex items-start gap-3 p-4"><span className={`mt-1 size-2 rounded-full ${n.readAt?'bg-[#dce2e8]':'bg-[#218c87]'}`}/><div className="min-w-0 flex-1"><p className="text-sm font-medium">{n.title}</p><p className="mt-1 text-xs text-[#586779]">{n.message}</p><p className="mt-1 text-[10px] text-[#687586]">{fmt(n.createdAt)}</p></div>{!n.readAt&&<Button size="sm" onClick={async()=>{await api(`/acics/notifications/${n.id}/read`,{method:'PATCH'});await qc.invalidateQueries({queryKey:['acics']});toast('Marked as read')}}>Mark read</Button>}</div>):<EmptyState icon={<Bell/>} title="No notifications" description="Updates about your cases will appear here."/>}</Card></>
}

function Audit({onCase}:{onCase:(id:string)=>void}){const {data,isLoading,error}=useAcics<{items:any[]}>('/admin/audit-logs');return <><PageHeader title="Audit log" subtitle="Append-only record of case and overlap review actions. Available to administrators."/>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 overflow-x-auto border border-[#dce2e8] shadow-none">{isLoading?<Skeleton className="m-4 h-28"/>:<table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-[#f8fafb] text-[#687586]"><tr className="h-10 border-b"><th className="px-4">Timestamp</th><th className="px-3">Actor</th><th className="px-3">Action</th><th className="px-3">Case</th><th className="px-3">Outcome / note</th></tr></thead><tbody className="divide-y">{data?.items.map(a=><tr key={a.id} className="h-12"><td className="px-4">{fmt(a.createdAt)}</td><td className="px-3">{a.actor||a.actorId}</td><td className="px-3">{a.actionType.replaceAll('_',' ')}</td><td className="px-3"><button className="text-[#315f85] underline" onClick={()=>onCase(a.complaintId)}>{a.complaintNumber||a.complaintId}</button></td><td className="max-w-[300px] truncate px-3">{a.newValue||a.remarks||'—'}</td></tr>)}</tbody></table>}</Card></>}

function Settings({user}:{user:AcicsUser}){const {data}=useAcics<any>('/analytics');return <><PageHeader title="Account and prototype settings" subtitle="Identity and data are scoped to this local database. No AICTE integration is configured."/><div className="mt-4 grid gap-4 md:grid-cols-2"><Card className="border border-[#dce2e8] p-5 shadow-none"><h2 className="text-sm font-semibold">Current identity</h2><p className="mt-3 text-sm">{user.user.name}</p><p className="text-xs text-[#687586]">{user.user.email}</p><div className="mt-3"><Badge>{roleName(user.role)}</Badge>{user.bureau&&<Badge className="ml-2">{user.bureau.code}</Badge>}</div></Card><Card className="border border-[#dce2e8] p-5 shadow-none"><h2 className="text-sm font-semibold">Prototype policy</h2><ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-[#586779]"><li>Case due dates use an illustrative 30-day default, not an official deadline.</li><li>Overlap detection uses exact synthetic institution IDs and lexical token similarity. No semantic AI model is configured.</li><li>Complaint attachments are not stored; confidential file handling requires a secured storage policy.</li><li>All case text and people in the preloaded dataset are synthetic.</li></ul></Card></div><Card className="mt-4 border border-[#dce2e8] p-5 shadow-none"><h2 className="text-sm font-semibold">System counts</h2><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Users" value={data?.users??0}/><Stat label="Institutions" value={data?.institutions??0}/><Stat label="Cases in scope" value={data?.totals?.total??0}/><Stat label="Open cases" value={data?.totals?.open??0}/></div></Card></>}

function Bureaus(){const {data,error}=useAcics<{items:any[]}>('/bureaus');return <><PageHeader title="Bureau directory" subtitle="Configured coordinating units and permitted case categories."/>{error&&<ErrorBox message={(error as Error).message}/>}<div className="mt-4 grid gap-3 md:grid-cols-2">{data?.items.map(b=><Card key={b.id} className="border border-[#dce2e8] p-4 shadow-none"><div className="flex items-center justify-between"><div><p className="font-semibold">{b.name}</p><p className="mt-1 text-xs text-[#687586]">{b.code} • {b.active?'Active':'Disabled'}</p></div><Badge>{b.caseCount} cases</Badge></div><div className="mt-3 flex flex-wrap gap-1">{b.permittedCategories.map((c:string)=><Badge key={c} tone="neutral">{c}</Badge>)}</div></Card>)}</div></>}

function Modal({title,onClose,children,width=560}:{title:string;onClose:()=>void;children:any;width?:number}){return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17283b]/30 p-3 sm:items-center" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-md border border-[#dce2e8] bg-white p-5 shadow-xl" style={{maxWidth:width}}><header className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-[#17324d]">{title}</h2><Button size="icon-sm" aria-label="Close" onClick={onClose}><X/></Button></header>{children}</section></div>}

