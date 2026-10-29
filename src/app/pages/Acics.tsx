import { Activity, AlertTriangle, ArrowRight, Bell, Building2, Check, ChevronLeft, ChevronRight, ClipboardList, FileText, Landmark, LogOut, Plus, Search, ShieldCheck, Users, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api, setActivePortal } from '../lib/api'
import type { AcicsRole, AuthAccount, PortalKey } from '../lib/api'
import { Badge, Button, Card, Checkbox, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '../components/ui'

type Role=AcicsRole
type AcicsUser={user:{sub:string;name:string;email:string};role:Role;roles:Role[];accountStatus:string;designation?:string|null;institution?:{id:string;name:string|null}|null;bureau:{id:string;name:string|null;code:string|null}|null;demo:boolean}
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

export function Acics({account,onSwitchPortal}:{account:AuthAccount;onSwitchPortal:()=>void}){
 const qc=useQueryClient(),active=account as unknown as AcicsUser
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

 const logout=async()=>{
   try{
     await api('/auth/logout',{method:'POST'})
     setActivePortal(null)
     await qc.clear()
     onSwitchPortal()
     toast('Signed out successfully','neutral')
   }catch(e){
     toast((e as Error).message,'danger')
   }
 }
 const switchPortal=async(portal:PortalKey)=>{
   setActivePortal(portal)
   await qc.invalidateQueries({queryKey:['auth']})
   await qc.invalidateQueries({queryKey:['acics']})
   onSwitchPortal()
 }
 return <div className="flex h-full min-h-0 bg-[#f3f6f9] text-[#1f2937]">
  <aside className="hidden w-[245px] shrink-0 flex-col border-r border-[#d5dde5] bg-white md:flex">
   <div className="flex h-[70px] items-center gap-3 border-b border-[#d5dde5] px-5"><div className="grid size-9 place-items-center rounded-md bg-[#102a43] text-white"><Landmark className="size-5"/></div><div><p className="text-sm font-semibold text-[#102a43]">ACICS</p><p className="text-[10px] tracking-wide text-[#5b6573]">COORDINATION PLATFORM</p></div></div>
   <div className="border-b border-[#d5dde5] px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-[#5b6573]">Workspace</p><div className="mt-2 flex items-center gap-2"><div className="grid size-8 place-items-center rounded bg-[#eef2f6] text-[#163a5f]"><ShieldCheck className="size-4"/></div><div className="min-w-0"><p className="truncate text-xs font-medium">{active.role==='BUREAU_OFFICER'?active.bureau?.name:roleName(active.role)}</p><p className="text-[11px] text-[#5b6573]">{roleName(active.role)}</p></div></div>{active.designation&&<p className="mt-2 truncate text-[11px] text-[#5b6573]">{active.designation}{active.institution?.name?` · ${active.institution.name}`:''}</p>}</div>
   <nav className="flex-1 px-3 py-4">{NAV.filter(([, , check]) => check(active.role)).map(([label,key])=><button key={key} onClick={()=>{setPage(key);setSelected(null)}} className={`mb-1 flex h-10 w-full items-center gap-3 rounded px-3 text-left text-[13px] ${page===key?'bg-[#e8eef4] font-semibold text-[#102a43]':'text-[#5b6573] hover:bg-[#f3f6f9]'}`}><NavIcon name={key}/>{label}</button>)}</nav>
   {active.roles.length>1&&<div className="border-t border-[#d5dde5] p-3"><p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5b6573]">Switch portal</p><Select aria-label="Switch portal" value={PORTAL_OF[active.role]} onChange={e=>void switchPortal(e.target.value as PortalKey)}>{active.roles.map(r=><option key={r} value={PORTAL_OF[r]}>{roleName(r)}</option>)}</Select><p className="mt-1.5 px-1 text-[10.5px] leading-snug text-[#5b6573]">Only portals granted to this account are listed.</p></div>}
   <div className="border-t border-[#d5dde5] p-3"><div className="px-2 py-2"><p className="truncate text-xs font-semibold">{active.user.name}</p><p className="truncate text-[11px] text-[#5b6573]">{active.user.email}</p></div><Button className="w-full justify-start" onClick={()=>void logout()}><LogOut/>Sign out</Button></div>
  </aside>
  <main className="min-w-0 flex-1 overflow-y-auto">
   <header className="sticky top-0 z-10 flex min-h-[62px] items-center justify-between border-b border-t-[3px] border-[#d5dde5] border-t-[#e68a24] bg-white px-4 sm:px-7"><div><p className="text-[11px] text-[#5b6573]">AICTE / {roleName(active.role)} / <span className="text-[#1f2937]">{pageTitle(page)}</span></p><p className="mt-0.5 text-sm font-semibold text-[#102a43]">{pageTitle(page)}</p></div><div className="flex items-center gap-2"><Badge tone="accent">{roleName(active.role)}</Badge><Button size="icon-sm" aria-label="Notifications" onClick={()=>setPage('notifications')}><Bell/></Button><span className="hidden size-8 items-center justify-center rounded-full bg-[#163a5f] text-xs font-semibold text-white sm:flex">{initials(active.user.name)}</span></div></header>
   <nav aria-label="Primary navigation" className="sticky top-[62px] z-[9] flex gap-1 overflow-x-auto border-b border-[#d5dde5] bg-white px-3 py-2 md:hidden">{NAV.filter(([, , check]) => check(active.role)).map(([label,key])=><button key={key} onClick={()=>setPage(key)} className={`shrink-0 rounded px-3 py-2 text-xs ${page===key?'bg-[#e8eef4] font-semibold text-[#102a43]':'text-[#5b6573]'}`}>{label}</button>)}</nav>
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
const PORTAL_OF:Record<Role,PortalKey>={COMPLAINANT:'complainant',OFFICIAL:'official',ADMIN:'admin',BUREAU_OFFICER:'bureau'}
function pageTitle(p:string){return Object.fromEntries(NAV.map(([l,k])=>[k,l]))[p]||'Settings'}
function NavIcon({name}:{name:string}){const C:any=({overview:Activity,complaints:ClipboardList,overlaps:AlertTriangle,institutions:Building2,notifications:Bell,audit:ShieldCheck,settings:Users} as any)[name]||FileText;return <C className="size-4"/>}

function Stat({label,value,hint}:{label:string;value:string|number;hint?:string}){return <Card className="border border-[#d5dde5] p-4 shadow-none"><p className="text-xs text-[#5b6573]">{label}</p><p className="mt-2 text-[25px] font-semibold leading-none text-[#102a43]">{value}</p>{hint&&<p className="mt-2 text-[11px] text-[#5b6573]">{hint}</p>}</Card>}
function Overview({user,go}:{user:AcicsUser;go:(p:string)=>void}){const {data,isLoading,error}=useAcics<any>('/analytics'),complainant=user.role==='COMPLAINANT',{data:cases}=useAcics<{items:Case[]}>('/complaints?pageSize=5'),stats=complainant?[['My complaints',data?.totals?.total??0,'Submitted by you'],['In review',cases?.items.filter(c=>['UNDER_REVIEW','UNDER_PROCESS'].includes(c.status)).length??0,'Being assessed'],['Need information',cases?.items.filter(c=>c.status==='AWAITING_INFORMATION').length??0,'Response may be needed'],['Resolved',data?.totals?.resolved??0,'Completed cases']]:[['Total cases',data?.totals?.total??0,'Within your authorized scope'],['Open cases',data?.totals?.open??0,'Require further action'],['Overdue',data?.totals?.overdue??0,'Demonstration rule'],['Overlap reviews',data?.pendingOverlapReviews??0,'Pending staff review']];return <><PageHeader title={complainant?`Welcome, ${user.user.name.split(' ')[0]}`:`${user.bureau?.code||roleName(user.role)} overview`} subtitle={complainant?'Your complaints and their latest progress.':'Current workload from persisted synthetic demonstration records.'} actions={complainant?<Button variant="primary" onClick={()=>go('complaints')}>My complaints <ArrowRight/></Button>:<Button onClick={()=>go('complaints')}>Open case queue <ArrowRight/></Button>}/><div className="mt-3 flex items-center gap-2 rounded border border-[#d5dde5] bg-white px-3 py-2 text-[11px] text-[#5b6573]"><span className="size-2 rounded-full bg-[#237a4b]"/>Synthetic demonstration data · prototype deadlines are not official AICTE service standards.</div>{error&&<ErrorBox message={(error as Error).message}/>}<div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{stats.map(([label,value,hint])=>isLoading?<Skeleton key={label} className="h-28"/>:<Stat key={label} label={label as string} value={value as number} hint={hint as string}/>)}</div><div className="mt-4 grid gap-4 lg:grid-cols-3"><Card className="border border-[#d5dde5] p-5 shadow-none lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">{complainant?'Recent complaints':'Case status distribution'}</h2><p className="mt-1 text-xs text-[#5b6573]">{complainant?'Your latest submissions':'Current authorized case scope'}</p></div>{!complainant&&<Button size="sm" onClick={()=>go('complaints')}>Case queue</Button>}</div>{complainant?<CaseTable rows={cases?.items||[]} onOpen={()=>go('complaints')}/>:<div className="mt-5 space-y-3">{(data?.statuses||[]).map((s:any)=>{const pct=Math.round(s.count/Math.max(1,Number(data?.totals?.total||1))*100);return <div key={s.status}><div className="mb-1 flex justify-between text-xs"><span>{titleCase(s.status)}</span><span className="tabular-nums text-[#5b6573]">{s.count}</span></div><div className="h-2 overflow-hidden rounded bg-[#e8edf2]"><div className="h-full bg-[#163a5f]" style={{width:`${pct}%`}}/></div></div>})}</div>}</Card><Card className="border border-[#d5dde5] p-5 shadow-none"><h2 className="text-sm font-semibold">{user.role==='ADMIN'?'System scope':'Actions'}</h2>{user.role==='ADMIN'?<div className="mt-4 grid grid-cols-2 gap-2"><MiniStat label="Active users" value={data?.users??0}/><MiniStat label="Institutions" value={data?.institutions??0}/><MiniStat label="Open cases" value={data?.totals?.open??0}/><MiniStat label="Pending review" value={data?.pendingOverlapReviews??0}/></div>:<div className="mt-4 flex flex-col gap-2"><Button className="justify-start" onClick={()=>go('overlaps')}><AlertTriangle/>Review overlap alerts</Button><Button className="justify-start" onClick={()=>go('institutions')}><Building2/>Institution profiles</Button><Button className="justify-start" onClick={()=>go('notifications')}><Bell/>Notifications</Button></div>}<p className="mt-5 border-t border-[#d5dde5] pt-3 text-[11px] leading-relaxed text-[#5b6573]">An overlap is decision support, not proof of duplication or legal validity.</p></Card></div><Card className="mt-4 border border-[#d5dde5] p-5 shadow-none"><h2 className="text-sm font-semibold">Recently updated cases</h2><CaseTable rows={cases?.items||[]} onOpen={()=>go('complaints')}/></Card></>}
function MiniStat({label,value}:{label:string;value:number}){return <div className="rounded bg-[#f3f6f9] p-3"><p className="text-[10px] text-[#5b6573]">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>}
function ErrorBox({message}:{message:string}){return <div role="alert" className="mt-4 rounded border border-[#f0c4bf] bg-[#fbeae8] p-3 text-xs text-[#b42318]">Unable to load this section: {message}</div>}
function useAcics<T>(path:string){return useQuery({queryKey:['acics',path],queryFn:()=>fetchJson<T>(path),staleTime:10_000})}

function ComplaintQueue({user,query,setQuery,status,setStatus,category,setCategory,pageNo,setPageNo,onOpen,onNew}:{user:AcicsUser;query:string;setQuery:(v:string)=>void;status:string;setStatus:(v:string)=>void;category:string;setCategory:(v:string)=>void;pageNo:number;setPageNo:(v:number)=>void;onOpen:(id:string)=>void;onNew:()=>void}){
 const params=new URLSearchParams({page:String(pageNo),pageSize:'12'});if(query)params.set('q',query);if(status)params.set('status',status);if(category)params.set('category',category)
 const {data,isLoading,error}=useAcics<{items:Case[];total:number;page:number;pageSize:number}>(`/complaints?${params}`),canSubmit=user.role==='COMPLAINANT'
 return <><PageHeader title={canSubmit?'My complaints':'Assigned complaints'} subtitle={`${data?.total??0} cases · ${canSubmit?'Only your submissions are shown.':'Scoped to your authorized assignment.'}`} actions={canSubmit&&<Button variant="primary" onClick={onNew}>Submit a complaint</Button>}/><div className="mt-5 flex flex-wrap gap-2"><label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 size-4 text-[#5b6573]"/><Input aria-label="Search cases" className="pl-9" placeholder="Search ID, subject, institution" value={query} onChange={e=>{setQuery(e.target.value);setPageNo(1)}}/></label><Select aria-label="Filter by status" className="w-[190px]" value={status} onChange={e=>{setStatus(e.target.value);setPageNo(1)}}><option value="">All statuses</option>{STATUSES.map(s=><option key={s} value={s}>{titleCase(s)}</option>)}</Select><Select aria-label="Filter by category" className="w-[220px]" value={category} onChange={e=>{setCategory(e.target.value);setPageNo(1)}}><option value="">All categories</option>{CATEGORIES.map(s=><option key={s}>{s}</option>)}</Select><Button onClick={()=>{setQuery('');setStatus('');setCategory('');setPageNo(1)}}>Reset</Button></div>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 overflow-hidden border border-[#d5dde5] shadow-none">{isLoading?<div className="space-y-2 p-5"><Skeleton className="h-10"/><Skeleton className="h-10"/><Skeleton className="h-10"/></div>:<CaseTable rows={data?.items||[]} onOpen={onOpen}/>}<div className="flex items-center justify-between border-t border-[#d5dde5] px-4 py-3 text-xs text-[#5b6573]"><span>Page {pageNo} of {Math.max(1,Math.ceil((data?.total||0)/12))}</span><div className="flex gap-2"><Button size="sm" disabled={pageNo<=1} onClick={()=>setPageNo(pageNo-1)}><ChevronLeft/>Previous</Button><Button size="sm" disabled={pageNo>=Math.ceil((data?.total||0)/12)} onClick={()=>setPageNo(pageNo+1)}>Next<ChevronRight/></Button></div></div></Card></>}
function CaseTable({rows,onOpen}:{rows:Case[];onOpen:(id:string)=>void}){if(!rows.length)return <EmptyState icon={<ClipboardList/>} title="No complaints found" description="Try adjusting the filters or submit a new complaint."/>;return <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="sticky top-0 bg-[#f8fafc] text-[#5b6573]"><tr className="h-10 border-b border-[#d5dde5]"><th className="px-4 font-medium">Complaint</th><th className="px-3 font-medium">Institution</th><th className="px-3 font-medium">Category</th><th className="px-3 font-medium">Bureau</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Due date</th></tr></thead><tbody className="divide-y divide-[#e6ebf1]">{rows.map(r=><tr key={r.id} onClick={()=>onOpen(r.id)} className="h-[58px] cursor-pointer hover:bg-[#f8fafc]"><td className="px-4"><span className="block font-semibold text-[#102a43]">{r.complaintNumber}</span><span className="mt-0.5 block max-w-[280px] truncate text-[#5b6573]">{r.subject}</span></td><td className="max-w-[180px] truncate px-3">{r.institution.name}</td><td className="max-w-[180px] truncate px-3">{r.category}</td><td className="px-3">{r.assignedBureau?.code||'—'}</td><td className="px-3"><Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge></td><td className={`px-3 ${r.overdue?'font-semibold text-[#b42318]':''}`}>{r.overdue?'Overdue · ':''}{fmt(r.dueAt)}</td></tr>)}</tbody></table></div>}

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
  if(submitted)return <Modal title="Complaint received" onClose={onClose}><div className="rounded border border-[#b9dcc9] bg-[#e7f3ed] p-4 text-sm"><Check className="mb-2 size-5 text-[#237a4b]"/><p>Your synthetic demonstration complaint has been registered.</p><p className="mt-2 font-semibold">Reference: {submitted.complaintNumber}</p><p className="mt-2 text-xs text-[#5b6573]">Keep this ID to track progress from My complaints. This prototype does not connect to AICTE systems.</p></div><Button className="mt-4 w-full" variant="primary" onClick={onClose}>Done</Button></Modal>
  return <Modal title={review?'Review complaint':'Submit a complaint'} onClose={onClose}><p className="mb-4 text-xs text-[#5b6573]">Fields marked required. Category labels are suggested prototype defaults, not official AICTE classifications.</p>{!review?<div className="space-y-4"><Field label="Complaint subject"><Input required minLength={8} maxLength={180} value={form.subject} onChange={e=>set('subject',e.target.value)} placeholder="Summarize the concern"/></Field><Field label="Institution" hint="Select an AICTE-listed institution or enter identifier"><Select required value={form.institutionOfficialId} onChange={e=>set('institutionOfficialId',e.target.value)}><option value="">Choose institution</option>{instData?.items?.map(i=><option key={i.id} value={i.officialId}>{i.name} ({i.officialId})</option>)}</Select></Field><Field label="Complaint category"><Select required value={form.category} onChange={e=>set('category',e.target.value)}><option value="">Choose category</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</Select></Field><Field label="Detailed description" hint={`${form.description.length}/5000 · At least 30 characters`}><Textarea required minLength={30} maxLength={5000} rows={5} value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Describe what happened, when, and the impact."/></Field><Field label="Incident date (optional)"><Input type="date" value={form.incidentDate} onChange={e=>set('incidentDate',e.target.value)}/></Field><Field label="Supporting document (optional)" hint="Prototype file selection only; confidential document storage is not enabled for case evidence."><Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setFileName(e.target.files?.[0]?.name||'')}/>{fileName&&<span className="text-xs">Selected: {fileName}</span>}</Field><label className="flex items-start gap-2 text-xs leading-relaxed"><Checkbox checked={form.consent} onChange={e=>set('consent',e.target.checked)}/><span>I confirm the information is accurate to the best of my knowledge and consent to its processing for this prototype.</span></label>{validation&&<ErrorBox message={validation}/>}<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={()=>{if(form.subject.trim().length<8||!form.institutionOfficialId.trim()||!form.category||form.description.trim().length<30||!form.consent){setValidation('Complete the subject, institution identifier, category, a 30-character description, and the declaration. Your entered data is preserved.');return}setValidation('');setReview(true)}}>Review submission <ArrowRight/></Button></div></div>:<div><Card className="border border-[#d5dde5] p-4 shadow-none"><p className="text-[11px] text-[#5b6573]">SUBJECT</p><p className="mt-1 font-medium">{form.subject}</p><p className="mt-4 text-[11px] text-[#5b6573]">INSTITUTION</p><p className="mt-1">{form.institutionOfficialId}</p><p className="mt-4 text-[11px] text-[#5b6573]">CATEGORY</p><p className="mt-1">{form.category}</p><p className="mt-4 text-[11px] text-[#5b6573]">DESCRIPTION</p><p className="mt-1 whitespace-pre-wrap text-sm">{form.description}</p>{fileName&&<p className="mt-4 text-xs">Selected file (not uploaded): {fileName}</p>}</Card>{validation&&<ErrorBox message={validation}/>}<div className="mt-4 flex justify-between"><Button onClick={()=>setReview(false)}><ChevronLeft/>Edit</Button><Button variant="primary" onClick={async()=>{try{const result=await send();setSubmitted(result.item);toast('Complaint submitted successfully')}catch(e){setValidation((e as Error).message)}}}>Confirm and submit</Button></div></div>}</Modal>
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
        <h2 className="text-lg font-semibold text-[#102a43]">{item.subject}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#3f4a58]">{item.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded border border-[#d5dde5] bg-[#f8fafc] p-3 text-xs">
        <div><p className="text-[#5b6573]">Institution</p><button className="mt-1 text-left font-semibold text-[#163a5f] underline" onClick={()=>{onClose()}}>{item.institution.name}</button></div>
        <div><p className="text-[#5b6573]">Identifier</p><p className="mt-1 font-medium">{item.institution.officialId}</p></div>
        <div><p className="text-[#5b6573]">Category</p><p className="mt-1">{item.category}</p></div>
        <div><p className="text-[#5b6573]">Assigned bureau</p><p className="mt-1">{item.assignedBureau?.name||'Not disclosed'}</p></div>
        <div><p className="text-[#5b6573]">Submitted</p><p className="mt-1">{fmt(item.submittedAt)}</p></div>
        <div><p className="text-[#5b6573]">Due date · prototype</p><p className={`mt-1 ${item.overdue?'font-semibold text-[#b42318]':''}`}>{fmt(item.dueAt)}</p></div>
      </div>
      {item.publicRemarks&&<div className="rounded border border-[#d5dde5] p-3"><p className="text-xs font-semibold">Public update</p><p className="mt-1 text-sm">{item.publicRemarks}</p></div>}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Case history</h3>
        <ol className="space-y-3 border-l border-[#d5dde5] pl-4">
          {data?.actions.map(a=><li key={a.id} className="relative text-xs">
            <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-[#163a5f]"/>
            <p className="font-medium">{a.actionType.replaceAll('_',' ')}</p>
            <p className="mt-0.5 text-[#5b6573]">{a.actor} · {fmt(a.createdAt)} {a.visibility==='INTERNAL'&&allowed?'· Internal':''}</p>
            {a.remarks&&<p className="mt-1 text-[#3f4a58]">{a.remarks}</p>}
          </li>)}
        </ol>
      </section>
      {allowed&&<><section className="border-t border-[#d5dde5] pt-4">
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
      {(user.role==='ADMIN'||user.role==='BUREAU_OFFICER')&&<section className="border-t border-[#d5dde5] pt-4">
        <h3 className="text-sm font-semibold">Assign case officer</h3>
        <div className="mt-2 flex gap-2">
          <Select aria-label="Assign officer" className="flex-1" value={assignOfficer||item.assignedOfficer||''} onChange={e=>setAssignOfficer(e.target.value)}>
            <option value="">Unassigned</option>
            {officersData?.items?.map(o=><option key={o.sub} value={o.sub}>{o.fullName} ({o.role}{o.bureauCode?` · ${o.bureauCode}`:''})</option>)}
          </Select>
          <Button onClick={doAssign}>Assign</Button>
        </div>
      </section>}</>}
      <section className="border-t border-[#d5dde5] pt-4">
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

function Overlaps({onSelect}:{onSelect:(id:string)=>void}){const {data,isLoading,error}=useAcics<{items:Alert[]}>('/overlaps');const [filter,setFilter]=useState('PENDING');const rows=(data?.items||[]).filter(a=>!filter||a.reviewStatus===filter);return <><PageHeader title="Cross-bureau overlap center" subtitle="Explainable, rule-based candidate pairs for human review. Records remain separate."/><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[#5b6573]">Exact synthetic institution ID is required; category and text overlap explain prioritization. Scores are not proof of duplication.</p><Select className="w-48" aria-label="Review status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All alerts</option>{['PENDING','CONFIRMED','REJECTED','INVESTIGATE'].map(s=><option key={s}>{s}</option>)}</Select></div>{error&&<ErrorBox message={(error as Error).message}/>}<div className="mt-4 space-y-3">{isLoading?<Skeleton className="h-32"/>:rows.map(a=><Card key={a.id} className="border border-[#d5dde5] p-4 shadow-none"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Badge tone={a.reviewStatus==='PENDING'?'warning':a.reviewStatus==='CONFIRMED'?'success':'neutral'}>{titleCase(a.reviewStatus)}</Badge><span className="text-xs text-[#5b6573]">{Math.round(a.score*100)}% rule score · {fmt(a.createdAt)}</span></div><h3 className="mt-2 text-sm font-semibold">{a.institution.name}</h3><p className="mt-0.5 text-[11px] text-[#5b6573]">Institution identifier: {a.institution.officialId}</p></div><Button onClick={()=>onSelect(a.id)}>Compare cases <ArrowRight/></Button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><PairSummary data={a.caseA}/><PairSummary data={a.caseB}/></div><div className="mt-3 flex flex-wrap gap-1.5">{a.matchingReasons.map(r=><Badge key={r} tone="info">{r}</Badge>)}</div></Card>)}{!isLoading&&!rows.length&&<EmptyState icon={<AlertTriangle/>} title="No alerts in this view" description="Potential cross-bureau relationships will appear here for staff review."/>}</div></>}
function PairSummary({data}:{data:Alert['caseA']}){return <div className="rounded border border-[#e2e8ee] bg-[#f8fafc] p-3"><p className="text-[11px] font-semibold text-[#163a5f]">{data.number} · {data.bureau}</p><p className="mt-1 text-xs font-medium">{data.subject}</p><p className="mt-1 line-clamp-2 text-[11px] text-[#5b6573]">{data.description}</p><p className="mt-2 text-[10px] text-[#5b6573]">{data.category} · {titleCase(data.status)}</p></div>}
function OverlapDrawer({id,onClose,toast}:{id:string;onClose:()=>void;toast:(m:string,t?:'neutral'|'danger')=>void}){const {data,isLoading,error}=useAcics<{items:Alert[]}>(`/overlaps`),alert=data?.items.find(a=>a.id===id),[notes,setNotes]=useState(''),qc=useQueryClient();const decide=async(decision:string)=>{try{await api(`/acics/overlaps/${id}/review`,{method:'PATCH',json:{decision,notes}});await qc.invalidateQueries({queryKey:['acics']});toast(`Relationship marked ${decision.toLowerCase()}; audit history recorded`);onClose()}catch(e){toast((e as Error).message,'danger')}};return <Modal title="Compare potential overlap" onClose={onClose} width={840}>{isLoading?<Skeleton className="h-40"/>:error?<ErrorBox message={(error as Error).message}/>:alert&&<><div className="rounded border border-[#d5dde5] bg-[#f8fafc] p-3 text-xs"><p className="font-semibold">{alert.institution.name} · {alert.institution.officialId}</p><p className="mt-1 text-[#5b6573]">Rule-based score: {Math.round(alert.score*100)}%. A relationship does not merge records or change either status.</p><div className="mt-2 flex flex-wrap gap-1">{alert.matchingReasons.map(r=><Badge key={r} tone="info">{r}</Badge>)}</div></div><div className="mt-3 grid gap-3 md:grid-cols-2"><CaseCompare item={alert.caseA}/><CaseCompare item={alert.caseB}/></div><Field label="Coordination / review note"><Textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Record why this relationship is confirmed or rejected"/></Field><div className="mt-4 flex flex-wrap justify-end gap-2"><Button onClick={onClose}>Close</Button><Button onClick={()=>decide('INVESTIGATE')}>Further investigation</Button><Button onClick={()=>decide('REJECTED')}>Reject false match</Button><Button variant="primary" onClick={()=>decide('CONFIRMED')}>Confirm relationship</Button></div></>}</Modal>}
function CaseCompare({item}:{item:Alert['caseA']}){return <div className="rounded border border-[#d5dde5] p-4"><div className="flex justify-between"><Badge>{item.number}</Badge><Badge tone={statusTone(item.status)}>{titleCase(item.status)}</Badge></div><p className="mt-3 font-semibold">{item.subject}</p><p className="mt-1 text-[11px] text-[#5b6573]">{item.bureau} · {item.category}</p><p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed">{item.description}</p></div>}

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

  return <><PageHeader title="Institution profiles" subtitle="Unified view using verified synthetic institution identifiers; names alone do not merge records." actions={role==='ADMIN'&&<Button variant="primary" onClick={()=>setAdding(true)}><Plus/> Add institution</Button>}/><label className="relative mt-4 block max-w-lg"><Search className="absolute left-3 top-2.5 size-4 text-[#5b6573]"/><Input className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or institution identifier"/></label>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 overflow-hidden border border-[#d5dde5] shadow-none">{isLoading?<Skeleton className="m-4 h-28"/>:<div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-[#f8fafc] text-[#5b6573]"><tr className="h-10 border-b"><th className="px-4">Institution</th><th className="px-3">Identifier</th><th className="px-3">Location</th><th className="px-3">Cases</th><th className="px-3">Open</th><th/></tr></thead><tbody className="divide-y">{data?.items.map(i=><tr key={i.id} className="h-14 hover:bg-[#f8fafc]"><td className="px-4 font-medium">{i.name}</td><td className="px-3 font-mono text-[11px]">{i.officialId}</td><td className="px-3">{i.district}, {i.state}</td><td className="px-3">{i.complaintCount||0}</td><td className="px-3">{i.openCount||0}</td><td className="pr-3"><Button size="sm" onClick={()=>onOpen(i.id)}>View profile</Button></td></tr>)}</tbody></table></div>}</Card>
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

function InstitutionDrawer({id,onClose,onCase}:{id:string;onClose:()=>void;onCase:(id:string)=>void}){const {data,isLoading,error}=useAcics<any>(`/institutions/${id}`);return <Drawer open onClose={onClose} title="Institution profile" width={650}>{isLoading?<Skeleton className="m-6 h-40"/>:error?<div className="p-5"><ErrorBox message={(error as Error).message}/></div>:data&&<div className="p-5"><h2 className="text-lg font-semibold">{data.institution.name}</h2><p className="mt-1 text-xs text-[#5b6573]">{data.institution.officialId} · {data.institution.type} · {data.institution.district}, {data.institution.state}</p><div className="mt-4 grid grid-cols-2 gap-3"><Stat label="Related cases" value={data.cases.length}/><Stat label="Open" value={data.cases.filter((c:Case)=>!['RESOLVED','CLOSED','REJECTED'].includes(c.status)).length}/></div><h3 className="mt-6 text-sm font-semibold">Case history</h3><div className="mt-2">{data.cases.length?<CaseTable rows={data.cases} onOpen={id=>{onClose();onCase(id)}}/>:<p className="py-6 text-center text-xs text-[#5b6573]">No authorized cases for this institution.</p>}</div></div>}</Drawer>}

const ROLE_OPTIONS: Array<[Role, string]> = [
  ['COMPLAINANT', 'Complainant'],
  ['OFFICIAL', 'Official / Case Officer'],
  ['BUREAU_OFFICER', 'Bureau Officer'],
  ['ADMIN', 'Administrator'],
]
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  PENDING_APPROVAL: 'warning',
  PENDING_VERIFICATION: 'warning',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
}

function RolePicker({ value, onChange, disabled }: { value: Role[]; onChange: (roles: Role[]) => void; disabled?: boolean }) {
  const toggle = (role: Role) => onChange(value.includes(role) ? value.filter((item) => item !== role) : [...value, role])
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {ROLE_OPTIONS.map(([role, label]) => (
        <label key={role} className="flex items-center gap-2 rounded-control border border-[#d5dde5] bg-white px-2.5 py-2 text-[12.5px]">
          <Checkbox checked={value.includes(role)} disabled={disabled} onChange={() => toggle(role)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

function AdminUsers({ toast }: { toast: (m: string, t?: 'neutral' | 'danger') => void }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [busySub, setBusySub] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data, isLoading, error } = useAcics<{ items: any[] }>(`/admin/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(roleFilter)}&status=${encodeURIComponent(statusFilter)}`)
  const { data: pendingApproval } = useAcics<{ items: any[] }>('/admin/users?status=PENDING_APPROVAL')
  const { data: pendingVerification } = useAcics<{ items: any[] }>('/admin/users?status=PENDING_VERIFICATION')
  const { data: bureaus } = useAcics<{ items: any[] }>('/bureaus')
  const pendingCount = (pendingApproval?.items.length ?? 0) + (pendingVerification?.items.length ?? 0)

  const [newUser, setNewUser] = useState<{ fullName: string; email: string; roles: Role[]; bureauId: string; designation: string }>({ fullName: '', email: '', roles: ['OFFICIAL'], bureauId: '', designation: '' })
  const [editForm, setEditForm] = useState<{ fullName: string; roles: Role[]; bureauId: string; designation: string; accountStatus: string }>({ fullName: '', roles: [], bureauId: '', designation: '', accountStatus: 'ACTIVE' })

  const patchUser = async (sub: string, body: Record<string, unknown>, message: string) => {
    setBusySub(sub)
    try {
      await api(`/acics/admin/users/${sub}`, { method: 'PATCH', json: body })
      await qc.invalidateQueries({ queryKey: ['acics'] })
      toast(message)
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setBusySub(null)
    }
  }

  const createUser = async () => {
    if (!newUser.fullName.trim() || !newUser.email.includes('@') || !newUser.roles.length) {
      toast('Provide a name, a valid email address, and at least one role.', 'danger')
      return
    }
    setSaving(true)
    try {
      const result = await api<{ initialPassword: string }>('/acics/admin/users', { method: 'POST', json: newUser })
      await qc.invalidateQueries({ queryKey: ['acics'] })
      setAdding(false)
      setCredentials({ email: newUser.email, password: result.initialPassword })
      setNewUser({ fullName: '', email: '', roles: ['OFFICIAL'], bureauId: '', designation: '' })
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const updateUser = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api(`/acics/admin/users/${editing.sub}`, { method: 'PATCH', json: editForm })
      await qc.invalidateQueries({ queryKey: ['acics'] })
      setEditing(null)
      toast('Account updated. Role and status changes are recorded in the audit log.')
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (u: any) => {
    const roles: Role[] = u.roles?.length ? u.roles : u.role ? [u.role] : []
    setEditing(u)
    setEditForm({ fullName: u.fullName, roles, bureauId: u.bureauId || '', designation: u.designation || '', accountStatus: u.accountStatus || 'ACTIVE' })
  }

  const rolesOf = (u: any): Role[] => (u.roles?.length ? u.roles : u.role ? [u.role] : [])
  const isPending = (u: any) => u.accountStatus === 'PENDING_APPROVAL' || u.accountStatus === 'PENDING_VERIFICATION'

  return (
    <>
      <PageHeader
        title="User and role management"
        subtitle="Provision accounts, approve access requests, assign multiple roles, and record every change."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> Add user</Button>}
      />

      {pendingCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-control border border-[#e68a24]/35 bg-[#fdf1e2] px-3 py-2.5">
          <p className="text-[12px] leading-snug text-[#102a43]">
            <span className="font-semibold">{pendingCount} account request{pendingCount === 1 ? '' : 's'} awaiting review.</span>{' '}
            {pendingApproval?.items.length ?? 0} awaiting approval · {pendingVerification?.items.length ?? 0} awaiting identity verification.
          </p>
          <Button size="sm" onClick={() => { setStatusFilter('PENDING_APPROVAL'); setQ(''); setRoleFilter('') }}>Show pending approvals</Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-[#5b6573]" />
          <Input aria-label="Search users" className="pl-9" placeholder="Search by name, email, or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Select aria-label="Filter role" className="w-44" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {ROLE_OPTIONS.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
        </Select>
        <Select aria-label="Filter account status" className="w-52" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All account statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="PENDING_VERIFICATION">Pending verification</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REJECTED">Rejected</option>
        </Select>
        {(q || roleFilter || statusFilter) && <Button onClick={() => { setQ(''); setRoleFilter(''); setStatusFilter('') }}>Reset</Button>}
      </div>
      {error && <ErrorBox message={(error as Error).message} />}

      <Card className="mt-4 overflow-x-auto border border-[#d5dde5] shadow-none">
        {isLoading ? <Skeleton className="m-4 h-32" /> : (
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="bg-[#f8fafc] text-[#5b6573]">
              <tr className="h-10 border-b">
                <th className="px-4">Name / ID</th>
                <th className="px-3">Email</th>
                <th className="px-3">Roles</th>
                <th className="px-3">Designation / institution</th>
                <th className="px-3">Status</th>
                <th className="px-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items.map((u) => (
                <tr key={u.sub} className="h-14 hover:bg-[#f8fafc]">
                  <td className="px-4">
                    <span className="block font-semibold text-[#102a43]">{u.fullName}</span>
                    <span className="block font-mono text-[10px] text-[#5b6573]">{u.sub}</span>
                  </td>
                  <td className="px-3">{u.email}</td>
                  <td className="px-3">
                    <span className="flex flex-wrap gap-1">
                      {rolesOf(u).length ? rolesOf(u).map((role) => <Badge key={role} tone={role === 'ADMIN' ? 'accent' : role === 'BUREAU_OFFICER' ? 'info' : 'neutral'}>{roleName(role).replace(' Portal', '')}</Badge>) : <span className="text-[#5b6573]">None</span>}
                    </span>
                    {u.bureau && <span className="mt-1 block text-[10px] text-[#5b6573]">{u.bureauName || u.bureau}</span>}
                  </td>
                  <td className="max-w-[200px] px-3">
                    <span className="block truncate">{u.designation || '—'}</span>
                    <span className="block truncate text-[10px] text-[#5b6573]">{u.institutionName || (u.requestedRole ? `Requested: ${u.requestedRole}` : '')}</span>
                  </td>
                  <td className="px-3"><Badge tone={STATUS_TONE[u.accountStatus] ?? 'neutral'}>{(u.accountStatus || 'ACTIVE').replaceAll('_', ' ').toLowerCase()}</Badge></td>
                  <td className="px-3">
                    <div className="flex flex-wrap gap-1">
                      {isPending(u) && (
                        <Button size="sm" variant="primary" loading={busySub === u.sub} onClick={() => void patchUser(u.sub, { accountStatus: 'ACTIVE', roles: rolesOf(u).length ? rolesOf(u) : [u.requestedRole || 'COMPLAINANT'] }, `${u.fullName} approved for portal access`)}>Approve</Button>
                      )}
                      {isPending(u) && (
                        <Button size="sm" variant="danger" onClick={() => void patchUser(u.sub, { accountStatus: 'REJECTED', roles: rolesOf(u).length ? rolesOf(u) : [u.requestedRole || 'COMPLAINANT'] }, `${u.fullName} rejected`)}>Reject</Button>
                      )}
                      {u.accountStatus === 'SUSPENDED' && (
                        <Button size="sm" onClick={() => void patchUser(u.sub, { accountStatus: 'ACTIVE' }, `${u.fullName} reactivated`)}>Reactivate</Button>
                      )}
                      {u.accountStatus === 'ACTIVE' && (
                        <Button size="sm" onClick={() => void patchUser(u.sub, { accountStatus: 'SUSPENDED' }, `${u.fullName} suspended`)}>Suspend</Button>
                      )}
                      <Button size="sm" onClick={() => openEdit(u)}>Edit</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && !data?.items.length && <EmptyState icon={<Users />} title="No accounts in this view" description="Adjust the filters or add a new authorised user." />}
      </Card>

      {adding && (
        <Modal title="Add authorised user" onClose={() => setAdding(false)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name"><Input value={newUser.fullName} onChange={(e) => setNewUser((u) => ({ ...u, fullName: e.target.value }))} placeholder="Dr. S. Sharma" /></Field>
              <Field label="Email address"><Input type="email" value={newUser.email} onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))} placeholder="s.sharma@aicte.test" /></Field>
            </div>
            <Field label="Portal roles" hint="An account may hold more than one role. Access is still verified per portal.">
              <RolePicker value={newUser.roles} onChange={(roles) => setNewUser((u) => ({ ...u, roles }))} />
            </Field>
            {newUser.roles.includes('BUREAU_OFFICER') && (
              <Field label="Bureau assignment" hint="Required for bureau officers">
                <Select value={newUser.bureauId} onChange={(e) => setNewUser((u) => ({ ...u, bureauId: e.target.value }))}>
                  <option value="">Select bureau</option>
                  {bureaus?.items.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </Select>
              </Field>
            )}
            <Field label="Designation (optional)"><Input value={newUser.designation} onChange={(e) => setNewUser((u) => ({ ...u, designation: e.target.value }))} placeholder="Case Officer" /></Field>
            <p className="rounded-control border border-[#d5dde5] bg-[#f8fafc] p-2.5 text-[11px] leading-relaxed text-[#5b6573]">
              A temporary password will be generated once and shown after creation. The account is active immediately and every provisioning action is written to the audit log.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} disabled={!newUser.fullName.trim() || !newUser.email.trim() || !newUser.roles.length} onClick={createUser}>Create user</Button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit access: ${editing.fullName}`} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <Field label="Full name"><Input value={editForm.fullName} onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))} /></Field>
            <Field label="Portal roles" hint="Removal takes effect on the next request. Server-side checks still apply.">
              <RolePicker value={editForm.roles} onChange={(roles) => setEditForm((f) => ({ ...f, roles }))} />
            </Field>
            {editForm.roles.includes('BUREAU_OFFICER') && (
              <Field label="Bureau assignment">
                <Select value={editForm.bureauId} onChange={(e) => setEditForm((f) => ({ ...f, bureauId: e.target.value }))}>
                  <option value="">Select bureau</option>
                  {bureaus?.items.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </Select>
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Designation"><Input value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} /></Field>
              <Field label="Account status">
                <Select value={editForm.accountStatus} onChange={(e) => setEditForm((f) => ({ ...f, accountStatus: e.target.value }))}>
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING_APPROVAL">Pending approval</option>
                  <option value="PENDING_VERIFICATION">Pending verification</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
              </Field>
            </div>
            {editing.designation || editing.institutionName ? (
              <p className="rounded-control border border-[#d5dde5] bg-[#f8fafc] p-2.5 text-[11px] leading-relaxed text-[#5b6573]">
                Institution on record: <span className="font-medium text-[#102a43]">{editing.institutionName || 'not linked'}</span>. Institution links are preserved when roles change.
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" loading={saving} onClick={updateUser}>Save changes</Button>
            </div>
          </div>
        </Modal>
      )}

      {credentials && (
        <Modal title="Temporary password generated" onClose={() => setCredentials(null)} width={460}>
          <div className="space-y-3">
            <div className="rounded-control border border-[#b9dcc9] bg-[#e7f3ed] p-3 text-[12px] leading-relaxed text-[#237a4b]">
              Share this password with the user over a secure channel. It is displayed once and cannot be retrieved later.
            </div>
            <div className="rounded-control border border-[#d5dde5] p-3 text-[12.5px]">
              <p className="text-[#5b6573]">Email</p>
              <p className="mt-0.5 font-medium">{credentials.email}</p>
              <p className="mt-3 text-[#5b6573]">Temporary password</p>
              <p className="mt-0.5 select-all font-mono text-[13px] font-semibold text-[#102a43]">{credentials.password}</p>
            </div>
            <p className="text-[11px] leading-relaxed text-[#5b6573]">Ask the user to sign in and change this password. Password recovery is available from the sign-in screen.</p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setCredentials(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
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
  return <><PageHeader title="Notifications" subtitle="In-app confirmations and case updates for this signed-in identity." actions={Boolean(data?.items?.some(n=>!n.readAt))&&<Button onClick={markAll}>Mark all as read</Button>}/>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 divide-y border border-[#d5dde5] shadow-none">{isLoading?<Skeleton className="m-4 h-20"/>:data?.items.length?data.items.map(n=><div key={n.id} className="flex items-start gap-3 p-4"><span className={`mt-1 size-2 rounded-full ${n.readAt?'bg-[#d5dde5]':'bg-[#237a4b]'}`}/><div className="min-w-0 flex-1"><p className="text-sm font-medium">{n.title}</p><p className="mt-1 text-xs text-[#5b6573]">{n.message}</p><p className="mt-1 text-[10px] text-[#5b6573]">{fmt(n.createdAt)}</p></div>{!n.readAt&&<Button size="sm" onClick={async()=>{await api(`/acics/notifications/${n.id}/read`,{method:'PATCH'});await qc.invalidateQueries({queryKey:['acics']});toast('Marked as read')}}>Mark read</Button>}</div>):<EmptyState icon={<Bell/>} title="No notifications" description="Updates about your cases will appear here."/>}</Card></>
}

function Audit({onCase}:{onCase:(id:string)=>void}){const {data,isLoading,error}=useAcics<{items:any[]}>('/admin/audit-logs');return <><PageHeader title="Audit log" subtitle="Append-only record of case and overlap review actions. Available to administrators."/>{error&&<ErrorBox message={(error as Error).message}/>}<Card className="mt-4 overflow-x-auto border border-[#d5dde5] shadow-none">{isLoading?<Skeleton className="m-4 h-28"/>:<table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-[#f8fafc] text-[#5b6573]"><tr className="h-10 border-b"><th className="px-4">Timestamp</th><th className="px-3">Actor</th><th className="px-3">Action</th><th className="px-3">Case</th><th className="px-3">Outcome / note</th></tr></thead><tbody className="divide-y">{data?.items.map(a=><tr key={a.id} className="h-12"><td className="px-4">{fmt(a.createdAt)}</td><td className="px-3">{a.actor||a.actorId}</td><td className="px-3">{a.actionType.replaceAll('_',' ')}</td><td className="px-3"><button className="text-[#163a5f] underline" onClick={()=>onCase(a.complaintId)}>{a.complaintNumber||a.complaintId}</button></td><td className="max-w-[300px] truncate px-3">{a.newValue||a.remarks||'—'}</td></tr>)}</tbody></table>}</Card></>}

function Settings({user}:{user:AcicsUser}){const {data}=useAcics<any>('/analytics');return <><PageHeader title="Account and prototype settings" subtitle="Identity and data are scoped to this local database. No AICTE integration is configured."/><div className="mt-4 grid gap-4 md:grid-cols-2"><Card className="border border-[#d5dde5] p-5 shadow-none"><h2 className="text-sm font-semibold">Current identity</h2><p className="mt-3 text-sm">{user.user.name}</p><p className="text-xs text-[#5b6573]">{user.user.email}</p><div className="mt-3 flex flex-wrap gap-1.5">{user.roles.map(r=><Badge key={r}>{roleName(r)}</Badge>)}{user.bureau&&<Badge tone="info">{user.bureau.code}</Badge>}</div><dl className="mt-4 space-y-2 border-t border-[#d5dde5] pt-3 text-[12px]"><div className="flex justify-between gap-3"><dt className="text-[#5b6573]">Account status</dt><dd className="font-medium">{user.accountStatus.replaceAll('_',' ').toLowerCase()}</dd></div>{user.designation&&<div className="flex justify-between gap-3"><dt className="text-[#5b6573]">Designation</dt><dd className="text-right font-medium">{user.designation}</dd></div>}{user.institution?.name&&<div className="flex justify-between gap-3"><dt className="text-[#5b6573]">Institution</dt><dd className="text-right font-medium">{user.institution.name}</dd></div>}<div className="flex justify-between gap-3"><dt className="text-[#5b6573]">Identity source</dt><dd className="font-medium">{user.demo?'Local development account':'Institutional sign-in'}</dd></div></dl></Card><Card className="border border-[#d5dde5] p-5 shadow-none"><h2 className="text-sm font-semibold">Prototype policy</h2><ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-[#5b6573]"><li>Case due dates use an illustrative 30-day default, not an official deadline.</li><li>Overlap detection uses exact synthetic institution IDs and lexical token similarity. No semantic AI model is configured.</li><li>Complaint attachments are not stored; confidential file handling requires a secured storage policy.</li><li>All case text and people in the preloaded dataset are synthetic.</li></ul></Card></div><Card className="mt-4 border border-[#d5dde5] p-5 shadow-none"><h2 className="text-sm font-semibold">System counts</h2><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Users" value={data?.users??0}/><Stat label="Institutions" value={data?.institutions??0}/><Stat label="Cases in scope" value={data?.totals?.total??0}/><Stat label="Open cases" value={data?.totals?.open??0}/></div></Card></>}

function Bureaus(){const {data,error}=useAcics<{items:any[]}>('/bureaus');return <><PageHeader title="Bureau directory" subtitle="Configured coordinating units and permitted case categories."/>{error&&<ErrorBox message={(error as Error).message}/>}<div className="mt-4 grid gap-3 md:grid-cols-2">{data?.items.map(b=><Card key={b.id} className="border border-[#d5dde5] p-4 shadow-none"><div className="flex items-center justify-between"><div><p className="font-semibold">{b.name}</p><p className="mt-1 text-xs text-[#5b6573]">{b.code} • {b.active?'Active':'Disabled'}</p></div><Badge>{b.caseCount} cases</Badge></div><div className="mt-3 flex flex-wrap gap-1">{b.permittedCategories.map((c:string)=><Badge key={c} tone="neutral">{c}</Badge>)}</div></Card>)}</div></>}

function Modal({title,onClose,children,width=560}:{title:string;onClose:()=>void;children:any;width?:number}){return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#102a43]/30 p-3 sm:items-center" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-md border border-[#d5dde5] bg-white p-5 shadow-xl" style={{maxWidth:width}}><header className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-[#102a43]">{title}</h2><Button size="icon-sm" aria-label="Close" onClick={onClose}><X/></Button></header>{children}</section></div>}

