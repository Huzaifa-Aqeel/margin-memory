import { comparisonVariances, hasReconciledScope } from '@/lib/domain/scope'
import type { Estimate, Finding, FindingOutcomeVerdict, Job, Lesson, Variance } from '@/lib/domain/types'
import { id } from '@/lib/domain/ids'

const meaningful=(v:Variance)=>Math.max(Math.abs(v.costDeltaPct??0),Math.abs(v.hoursDeltaPct??0))>=0.1
const pct=(v:number|null)=>v===null?'n/a':`${v>=0?'+':''}${Math.round(v*100)}%`

export function proposeCloseoutLessons(job:Job):Lesson[]{
  if(!hasReconciledScope(job))return []
  const lessons:Lesson[]=[]
  const notes=job.notes.toLowerCase()
  const labor=comparisonVariances(job).find(v=>v.category==='labor')
  if(labor && meaningful(labor) && (labor.hoursDeltaPct??labor.costDeltaPct??0)>0.1){
    let cause='Labor finished materially above the scope-adjusted budget.'
    let lesson='Review the field condition that reduced labor productivity before bidding similar work.'
    let category:Lesson['category']='labor'
    if(/conduit|pathway|riser|reuse/.test(notes)){cause='Existing conduit/pathway assumptions did not hold in the field.';lesson='Verify existing pathway capacity before carrying reuse on similar retrofit work.';category='assumption'}
    else if(/access|occupied|shutdown|after.?hours|overtime/.test(notes)){cause='Access, shutdown, or occupied-space constraints reduced productive work time.';lesson='Confirm access windows and shutdown restrictions before using normal labor productivity.'}
    lessons.push({id:id(),jobId:job.id,title:'Carry forward the labor miss',category,lesson,cause,impactSummary:`Labor hours ${pct(labor.hoursDeltaPct)} (${labor.hoursDelta>=0?'+':''}${Math.round(labor.hoursDelta)}h).`,confidence:0.84,status:'pending',createdAt:new Date().toISOString()})
  }
  const materials=comparisonVariances(job).find(v=>v.category==='materials')
  if(materials && meaningful(materials) && (materials.costDeltaPct??0)>0.1){
    const quote=/quote|supplier|fixture|lighting|addendum|revision/.test(notes)
    lessons.push({id:id(),jobId:job.id,title:'Carry forward the material miss',category:'materials',lesson:quote?'Tie supplier pricing to the current specification/addendum revision before bid submission.':'Review the material package and pricing source before bidding similar work.',cause:quote?'Supplier/specification evidence changed or was stale.':'Material actuals materially exceeded the scope-adjusted budget.',impactSummary:`Material cost ${pct(materials.costDeltaPct)} (${materials.costDelta>=0?'+':''}$${Math.round(materials.costDelta).toLocaleString()}).`,confidence:quote?0.88:0.74,status:'pending',createdAt:new Date().toISOString()})
  }
  for(const v of comparisonVariances(job).filter(v=>!['labor','materials'].includes(v.category)&&meaningful(v)&&(v.costDeltaPct??0)>0.15)){
    lessons.push({id:id(),jobId:job.id,title:`Review ${v.category} overrun`,category:v.category,lesson:`Check whether ${v.category} should be explicitly carried on comparable work.`,cause:`${v.category} actual cost materially exceeded the estimate.`,impactSummary:`${v.category} cost ${pct(v.costDeltaPct)} (${v.costDelta>=0?'+':''}$${Math.round(v.costDelta).toLocaleString()}).`,confidence:0.7,status:'pending',createdAt:new Date().toISOString()})
  }
  return lessons.slice(0,3)
}

function findingVariance(finding:Finding,job:Job){
  if(['labor','materials','equipment','subcontractor','permit','other'].includes(finding.category)) return comparisonVariances(job).find(v=>v.category===finding.category)
  return undefined
}

function keywords(text:string){return [...new Set(text.toLowerCase().match(/[a-z][a-z-]{3,}/g)??[])].filter(x=>!['this','that','with','from','before','estimate','estimated','historical','previous','project','work','risk','should','could','would','company'].includes(x))}

export function evaluateFindingOutcomes(estimate:Estimate,job:Job){
  // Only score the immutable warning set that existed in the final investigation at submission.
  // Resolved findings from earlier preflight reruns are deliberately excluded.
  const submitted=new Set(estimate.submittedFindingIds)
  const findings=estimate.findings.filter(finding=>submitted.has(finding.id))
  return findings.map(finding=>{
    if(!hasReconciledScope(job))return {id:id(),findingId:finding.id,systemVerdict:'not_evaluable' as const,explanation:'Scope is unreconciled; original budget differences cannot establish an estimating mistake.',evidenceSummary:'Scope reconciliation is required.',confidence:0}
    let systemVerdict:FindingOutcomeVerdict='not_evaluable'
    let explanation='The closeout data does not contain enough direct evidence to judge this warning automatically.'
    let evidenceSummary='Human confirmation is required.'
    let confidence=0.55
    const v=findingVariance(finding,job)
    if(v){
      const metric=finding.category==='labor' && v.hoursDeltaPct!==null ? v.hoursDeltaPct : v.costDeltaPct
      if(metric!==null){
        if(metric>=0.12){systemVerdict='validated';confidence=0.9;explanation=`The warned ${finding.category} category materially overran the scope-adjusted budget.`}
        else if(metric>=0.05){systemVerdict='partially_validated';confidence=0.8;explanation=`The warned ${finding.category} category exceeded its scope-adjusted budget, but by a modest amount.`}
        else {systemVerdict='not_observed';confidence=0.84;explanation=`The warned ${finding.category} category did not materially exceed its scope-adjusted budget.`}
        evidenceSummary=`Cost variance ${pct(v.costDeltaPct)}; labor-hour variance ${pct(v.hoursDeltaPct)}.`
      }
    } else {
      const text=`${finding.title} ${finding.claim} ${finding.rationale} ${finding.recommendation}`
      const ks=keywords(text)
      const noteMatches=ks.filter(k=>job.notes.toLowerCase().includes(k)).slice(0,5)
      const largest=comparisonVariances(job).reduce((best,current)=>Math.max(best,current.costDeltaPct??0,current.hoursDeltaPct??0),0)
      if(noteMatches.length>=2 && largest>=0.08){systemVerdict='validated';confidence=0.78;explanation='Closeout notes contain the same condition the preflight warned about, alongside a material overrun.';evidenceSummary=`Matched closeout terms: ${noteMatches.join(', ')}. Largest positive variance ${Math.round(largest*100)}%.`}
      else if(noteMatches.length>=1){systemVerdict='partially_validated';confidence=0.65;explanation='The warned condition appears in closeout notes, but the financial/labor impact is not conclusive.';evidenceSummary=`Matched closeout term: ${noteMatches.join(', ')}.`}
      else if(largest<0.05){systemVerdict='not_observed';confidence=0.62;explanation='The job closed without a material positive variance and the warning condition was not documented.';evidenceSummary=`Largest positive category variance was ${Math.round(largest*100)}%.`}
    }
    if(finding.responses?.some(response=>response.kind==='mitigation_completed')){
      systemVerdict='not_evaluable';confidence=0
      explanation='A completed mitigation was recorded. Review condition occurrence and response effectiveness separately; variance alone cannot judge the warning.'
    }
    return {id:id(),findingId:finding.id,systemVerdict,explanation,evidenceSummary,confidence}
  })
}
