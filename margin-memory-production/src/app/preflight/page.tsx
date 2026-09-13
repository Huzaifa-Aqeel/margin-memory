import Link from 'next/link'
import { FilePlus2 } from 'lucide-react'
import { Badge } from '@/components/ui'
import { money } from '@/lib/domain/analytics'
import { presentMarginCheck } from '@/lib/domain/margin-check-presentation'
import { readStore } from '@/lib/repository/store'
import {isDemoOrigin} from '@/lib/domain/demo'

export const dynamic='force-dynamic'
export default async function PreflightPage(){
 const store=await readStore()
 return <div className="page">
  <div className="page-head"><div><div className="eyebrow">Estimate review</div><h1>Estimates</h1><p className="subtle">Review current estimates before submission, then follow their outcomes into verified company lessons.</p></div><Link href="/estimates/new" className="btn primary"><FilePlus2 size={16}/>Review estimate</Link></div>
  <div className="table-wrap"><table><thead><tr><th>Estimate</th><th>Origin</th><th>Amount</th><th>Labor</th><th>Findings</th><th>Margin Check</th><th>Lifecycle</th></tr></thead><tbody>{store.estimates.map((estimate)=>{
   const openFindings=estimate.findings.filter(finding=>finding.status==='open').length
   const review=presentMarginCheck({investigationStatus:estimate.investigationStatus,findingCount:estimate.findings.length,openFindingCount:openFindings,unansweredQuestionCount:estimate.questions.filter(question=>!question.resolvedAt).length})
   return <tr key={estimate.id}><td><Link href={`/estimates/${estimate.id}`}><strong>{estimate.name}</strong><div className="list-item-meta">{estimate.projectType} · {estimate.location}</div></Link></td><td>{isDemoOrigin(estimate)?<Badge tone="pending">Demo</Badge>:<Badge tone="confirmed">Production</Badge>}</td><td>{money(estimate.submittedAmount??estimate.estimatedTotal)}</td><td>{Math.round(estimate.estimatedLaborHours)}h</td><td>{openFindings}</td><td><Badge tone={review.tone}>{review.label}</Badge></td><td><div className="lifecycle-status-cell"><Badge tone={estimate.lifecycleStatus==='learned'?'confirmed':estimate.lifecycleStatus==='lost'?'neutral':'medium'}>{estimate.lifecycleStatus.replaceAll('_',' ')}</Badge>{estimate.lifecycleStatus==='learning_review'&&<span className="helper">{estimate.findingOutcomes.filter(outcome=>!outcome.confirmedVerdict).length} warning checks left</span>}</div></td></tr>
  })}</tbody></table></div>
 </div>
}
