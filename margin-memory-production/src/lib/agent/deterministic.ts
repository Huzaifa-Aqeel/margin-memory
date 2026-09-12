import { scoreJobSimilarity } from '@/lib/domain/analytics'
import {assessProfessionalComparability,isJobEligibleForTrustedMemory} from '@/lib/domain/memory-policy'
import type { Estimate,Store } from '@/lib/domain/types'
import { actions,calculateRisk,categories,type AgentOutput,EvidenceLedger } from './provenance'

/** Explicit no-model mode. Uses the same evidence and rendering boundary as Strands. */
export async function deterministicPreflight(store:Store,estimate:Estimate,ledger:EvidenceLedger):Promise<AgentOutput>{
 const candidates=store.jobs.filter(isJobEligibleForTrustedMemory).map(job=>({job,professional:assessProfessionalComparability(job,estimate),score:scoreJobSimilarity(job,{projectType:estimate.projectType,tags:estimate.tags,estimatedTotal:estimate.estimatedTotal,text:estimate.assumptions.join(' ')})})).filter(x=>x.professional.eligible&&x.score>=0.3).sort((a,b)=>b.professional.score-a.professional.score||b.score-a.score).slice(0,7)
 const jobs=candidates.map(x=>x.job)
 await ledger.record({kind:'search',toolName:'search_similar_jobs',result:{jobIds:jobs.map(j=>j.id),comparability:candidates.map(x=>({jobId:x.job.id,score:x.professional.score,matched:x.professional.matched,unavailable:x.professional.unavailable}))}})
 const findings:AgentOutput['findings']=[]
 for(const category of categories){
  const result=calculateRisk(jobs,category)
  if(result.sampleSize<2||result.overrunCount<2||result.medianVariancePct<=0.08)continue
  const calc=await ledger.record({kind:'calculation',toolName:'calculate_category_risk',result})
  findings.push({category,severity:result.medianVariancePct>0.2?'high':'medium',action:category==='labor'?'access':category==='materials'?'pricing':'category',calculationRefs:[calc.id],jobEvidenceRefs:[],lessonEvidenceRefs:[]})
 }
 const selected=findings.slice(0,3)
 return {findings:selected,questions:[...new Set(selected.map(f=>f.action))].filter(topic=>!estimate.assumptions.some(a=>a.startsWith(`Estimator response to "${actions[topic].question}"`))).slice(0,2)}
}
