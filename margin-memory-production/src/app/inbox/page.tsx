import { WarningResponseHistory } from '@/components/warning-response-fields'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import { AnswerQuestion, LessonActions } from '@/components/actions'
import { FindingOutcomeActions } from '@/components/lifecycle-actions'
import { readStore } from '@/lib/repository/store'

export const dynamic='force-dynamic'
export default async function InboxPage(){
  const store=await readStore()
  const questions=store.estimates.flatMap(e=>e.questions.filter(q=>!q.resolvedAt).map(q=>({estimate:e,question:q})))
  const pending=store.lessons.filter(l=>l.status==='pending')
  const outcomes=store.estimates.flatMap(e=>e.findingOutcomes.filter(o=>!o.confirmedVerdict).map(o=>({estimate:e,outcome:o,finding:e.findings.find(f=>f.id===o.findingId)})))
  const total=questions.length+pending.length+outcomes.length
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Human judgment inbox</div><h1>Only the things the system can’t safely decide</h1><p className="subtle">Questions before submission, and verification after the job. {total?`${total} item${total===1?'':'s'} need attention.`:'Nothing is waiting.'}</p></div></div>
    <section><div className="section-head"><h2>Estimate questions</h2><Badge tone={questions.length?'medium':'ready'}>{questions.length} open</Badge></div><div className="list">{questions.length?questions.map(({estimate,question})=><div className="question" key={question.id}><div className="finding-top"><div><div className="eyebrow">{estimate.name}</div><h3>{question.prompt}</h3></div><Link href={`/estimates/${estimate.id}`} className="btn small">Open estimate</Link></div><p className="subtle">{question.context}</p><AnswerQuestion estimateId={estimate.id} questionId={question.id} options={question.options}/></div>):<div className="card empty">No estimate questions waiting.</div>}</div></section>
    <section className="section"><div className="section-head"><h2>Warning outcomes to verify</h2><Badge tone={outcomes.length?'pending':'ready'}>{outcomes.length} pending</Badge></div><div className="list">{outcomes.length?outcomes.map(({estimate,outcome,finding})=><div className="card" key={outcome.id}><div className="finding-top"><div><div className="eyebrow">{estimate.name}</div><h3>{finding?.title??'Preflight warning'}</h3></div><Link href={`/estimates/${estimate.id}`} className="btn small">Open closeout</Link></div><p>{outcome.explanation}</p><div className="rationale">{outcome.evidenceSummary}</div><div style={{marginTop:12}}><WarningResponseHistory responses={finding?.responses}/><FindingOutcomeActions outcomeId={outcome.id} responses={finding?.responses??[]}/></div></div>):<div className="card empty">No warning outcomes need confirmation.</div>}</div></section>
    <section className="section"><div className="section-head"><h2>Lessons to verify</h2><Badge tone={pending.length?'pending':'ready'}>{pending.length} pending</Badge></div><div className="list">{pending.length?pending.map(l=>{const job=store.jobs.find(j=>j.id===l.jobId);return <div className="lesson pending" key={l.id}><div className="finding-top"><div><div className="eyebrow">{job?.name||'Completed job'}</div><h3>{l.title}</h3></div>{job?.sourceEstimateId&&<Link href={`/estimates/${job.sourceEstimateId}`} className="btn small">Open lifecycle</Link>}</div><p>{l.lesson}</p><div className="helper">Observed impact: {l.impactSummary}</div><LessonActions lessonId={l.id}/></div>}):<div className="card empty">No lessons need confirmation.</div>}</div></section>
  </div>
}
