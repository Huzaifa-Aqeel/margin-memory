import Link from 'next/link'
import { ArrowRight, FilePlus2 } from 'lucide-react'
import { Badge, Metric } from '@/components/ui'
import { money } from '@/lib/domain/analytics'
import { jobScopeComparison } from '@/lib/domain/scope'
import { getWarningCalibration, readStore } from '@/lib/repository/store'
import { ResetDemoButton,SeedDemoButton } from '@/components/seed-demo-button'
import {isJobEligibleForTrustedMemory,isLessonEligibleForTrustedMemory} from '@/lib/domain/memory-policy'
import { presentWarningEffectiveness } from '@/lib/domain/margin-check-presentation'
import {isDemoOrigin} from '@/lib/domain/demo'

export const dynamic = 'force-dynamic'
const lifecycleTone=(s:string)=>s==='learned'?'confirmed':s==='lost'?'neutral':s==='draft'?'neutral':'medium'

export default async function Dashboard(){
  const [store,calibration]=await Promise.all([readStore(),getWarningCalibration()]);
  const openFindings=store.estimates.flatMap((e)=>e.findings).filter((f)=>f.status==='open');
  const active=store.estimates.filter((e)=>!['lost','learned'].includes(e.lifecycleStatus));
  const trustedJobs=store.jobs.filter(isJobEligibleForTrustedMemory),trustedLessons=store.lessons.filter(lesson=>isLessonEligibleForTrustedMemory(lesson,store.jobs.find(job=>job.id===lesson.jobId)))
  const learning=store.estimates.filter(e=>e.lifecycleStatus==='learning_review').length
  const hasDemo=store.jobs.some(isDemoOrigin)||store.estimates.some(isDemoOrigin)
  const warningEffectiveness=presentWarningEffectiveness(calibration)
  return <div className="page">
    <div className="page-head"><div><div className="eyebrow">Estimating command center</div><h1>Catch the mistake before the job does.</h1><p className="subtle">Margin Check follows each estimate through its outcome, then carries verified lessons into the next bid.</p></div><div className="actions"><Link href="/jobs/new" className="btn">Import completed job</Link><Link href="/estimates/new" className="btn primary"><FilePlus2 size={16}/>Review estimate</Link></div></div>
    <div className="grid cols-4"><Metric label="Open findings" value={String(openFindings.length)} note={`${active.length} active estimate${active.length===1?'':'s'}`}/><Metric label="Active estimates" value={String(active.length)} note={learning?`${learning} closeout review${learning===1?'':'s'} awaiting judgment`:'No closeout reviews waiting'}/><Metric label="Historical evidence ready" value={String(trustedJobs.length)} note={`${trustedLessons.length} verified production lesson${trustedLessons.length===1?'':'s'}`}/><Metric label="Warning follow-up" value={warningEffectiveness.value} note={warningEffectiveness.note}/></div>
    {!store.jobs.length&&!store.estimates.length&&<section className="section setup-card"><div><div className="eyebrow">New workspace</div><h3>Start with your own completed jobs — or explore sample data.</h3><p className="subtle" style={{margin:0}}>Sample records are clearly marked and never enter your trusted professional memory.</p></div><SeedDemoButton/></section>}
    {hasDemo&&<section className="section setup-card"><div><div className="eyebrow">Sample workspace</div><h3>Demo records are for exploration only.</h3><p className="subtle" style={{margin:0}}>They are excluded from trusted retrieval, calculations, evidence, lessons, and warning calibration.</p></div><ResetDemoButton/></section>}
    <section className="section"><div className="section-head"><h2>Live estimates & jobs</h2><Link className="subtle" href="/preflight">View all →</Link></div><div className="list">{active.length?active.slice(0,6).map((estimate)=><Link className="list-item" key={estimate.id} href={`/estimates/${estimate.id}`}><div className="list-item-main"><div className="list-item-title">{estimate.name}</div><div className="list-item-meta">{money(estimate.submittedAmount??estimate.estimatedTotal)} · {estimate.projectType} · {estimate.findings.filter(x=>x.status==='open').length} open findings</div></div><div className="actions">{isDemoOrigin(estimate)&&<Badge tone="pending">Demo</Badge>}<Badge tone={lifecycleTone(estimate.lifecycleStatus)}>{estimate.lifecycleStatus.replaceAll('_',' ')}</Badge><ArrowRight size={17}/></div></Link>):<div className="card empty">No live estimates. Review a new estimate when you are ready.</div>}</div></section>
    <section className="section"><div className="section-head"><h2>Recent completed jobs</h2><Link className="subtle" href="/jobs">Open job history →</Link></div><div className="table-wrap"><table><thead><tr><th>Job</th><th>Type</th><th>Original budget</th><th>Actual</th><th>Adjusted variance</th><th>Margin</th></tr></thead><tbody>{store.jobs.slice(0,5).map((job)=>{const delta=jobScopeComparison(job)?.costDeltaPct??null;return <tr key={job.id}><td><Link href={`/jobs/${job.id}`}><strong>{job.name}</strong></Link>{isDemoOrigin(job)&&<div><Badge tone="pending">Demo</Badge></div>}</td><td>{job.projectType}</td><td>{money(job.estimatedTotal)}</td><td>{money(job.actualTotal)}</td><td className={delta!==null&&delta>0.05?'variance-pos':'variance-good'}>{delta===null?'Scope unverified':`${delta>=0?'+':''}${Math.round(delta*100)}%`}</td><td>{job.scopeReview?.status==='no_changes'&&job.grossMarginPct!==undefined?`${Math.round(job.grossMarginPct*100)}%`:'—'}</td></tr>})}</tbody></table></div></section>
  </div>
}
