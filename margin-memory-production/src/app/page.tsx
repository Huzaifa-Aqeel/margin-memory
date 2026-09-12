import { jobScopeComparison } from '@/lib/domain/scope'
import Link from 'next/link'
import { ArrowRight, FilePlus2 } from 'lucide-react'
import { Badge, Metric } from '@/components/ui'
import { money } from '@/lib/domain/analytics'
import { getWarningCalibration, readStore } from '@/lib/repository/store'
import { SeedDemoButton } from '@/components/seed-demo-button'

export const dynamic = 'force-dynamic'
const lifecycleTone=(s:string)=>s==='learned'?'confirmed':s==='lost'?'neutral':s==='draft'?'neutral':'medium'

export default async function Dashboard(){
  const [store,calibration]=await Promise.all([readStore(),getWarningCalibration()]);
  const openFindings=store.estimates.flatMap((e)=>e.findings).filter((f)=>f.status==='open');
  const active=store.estimates.filter((e)=>!['lost','learned'].includes(e.lifecycleStatus));
  const comparisons=store.jobs.map(j=>jobScopeComparison(j)?.costDeltaPct).filter((value):value is number=>typeof value==='number')
  const avgMiss=comparisons.length?comparisons.reduce((s,c)=>s+Math.abs(c),0)/comparisons.length:null
  const learning=store.estimates.filter(e=>e.lifecycleStatus==='learning_review').length
  return <div className="page">
    <div className="page-head"><div><div className="eyebrow">Estimating command center</div><h1>Catch the mistake before the job does.</h1><p className="subtle">Margin Memory follows each estimate from preflight through outcome, then carries verified lessons into the next bid.</p></div><div className="actions"><Link href="/jobs/new" className="btn">Import legacy completed job</Link><Link href="/estimates/new" className="btn primary"><FilePlus2 size={16}/>Review estimate</Link></div></div>
    <div className="grid cols-4"><Metric label="Completed-job memory" value={String(store.jobs.length)} note={`${store.lessons.filter(x=>x.status==='confirmed').length} verified lessons`}/><Metric label="Open preflight risks" value={String(openFindings.length)} note={`${active.length} live estimate lifecycles`}/><Metric label="Adjusted budget variance" value={avgMiss===null?'—':`${Math.round(avgMiss*100)}%`} note={`${comparisons.length} scope-reconciled jobs · mean absolute variance`}/><Metric label="Observed warning hit rate" value={calibration.hitRate===null?'—':`${Math.round(calibration.hitRate*100)}%`} note={calibration.evaluable?`${calibration.evaluable} occurrence reviews · ${calibration.mitigated} mitigated separately · not calibrated accuracy`:`${calibration.mitigated} mitigated separately · ${learning} closeouts awaiting review`}/></div>
    {!store.jobs.length&&<section className="section setup-card"><div><div className="eyebrow">New workspace</div><h3>Start with your own completed jobs — or test the full loop first.</h3><p className="subtle" style={{margin:0}}>The demo creates realistic electrical jobs, verified lessons, company memory, and one estimate for the agent to investigate.</p></div><SeedDemoButton/></section>}
    <section className="section"><div className="section-head"><h2>Live estimates & jobs</h2><Link className="subtle" href="/preflight">View all →</Link></div><div className="list">{active.length?active.slice(0,6).map((estimate)=><Link className="list-item" key={estimate.id} href={`/estimates/${estimate.id}`}><div className="list-item-main"><div className="list-item-title">{estimate.name}</div><div className="list-item-meta">{money(estimate.submittedAmount??estimate.estimatedTotal)} · {estimate.projectType} · {estimate.findings.filter(x=>x.status==='open').length} open findings</div></div><div className="actions"><Badge tone={lifecycleTone(estimate.lifecycleStatus)}>{estimate.lifecycleStatus.replaceAll('_',' ')}</Badge><ArrowRight size={17}/></div></Link>):<div className="card empty">No live estimates. Review a new estimate when you are ready.</div>}</div></section>
    <section className="section"><div className="section-head"><h2>Recent completed jobs</h2><Link className="subtle" href="/jobs">Open job history →</Link></div><div className="table-wrap"><table><thead><tr><th>Job</th><th>Type</th><th>Original budget</th><th>Actual</th><th>Adjusted variance</th><th>Margin</th></tr></thead><tbody>{store.jobs.slice(0,5).map((job)=>{const delta=jobScopeComparison(job)?.costDeltaPct??null;return <tr key={job.id}><td><Link href={`/jobs/${job.id}`}><strong>{job.name}</strong></Link></td><td>{job.projectType}</td><td>{money(job.estimatedTotal)}</td><td>{money(job.actualTotal)}</td><td className={delta!==null&&delta>0.05?'variance-pos':'variance-good'}>{delta===null?'Scope unverified':`${delta>=0?'+':''}${Math.round(delta*100)}%`}</td><td>{job.scopeReview?.status==='no_changes'&&job.grossMarginPct!==undefined?`${Math.round(job.grossMarginPct*100)}%`:'—'}</td></tr>})}</tbody></table></div></section>
  </div>
}
