import { comparisonVariances } from '@/lib/domain/scope'
import {isJobEligibleForTrustedMemory} from '@/lib/domain/memory-policy'
import { z } from 'zod'
import { median } from '@/lib/domain/analytics'
import type { CostCategory, Finding, Job } from '@/lib/domain/types'
import { classifyEvidence, evidenceDisclaimer } from '@/lib/domain/evidence-strength'

export const categories = ['labor','materials','equipment','subcontractor','permit','other'] as const
export const actions = {
  access: { title:'Confirm field access', recommendation:'Confirm access windows and shutdown restrictions before final pricing.', question:'Are normal work-area access and shutdown windows confirmed?' },
  pathway: { title:'Verify existing pathways', recommendation:'Inspect existing pathway capacity before carrying reuse.', question:'Has existing conduit/pathway capacity been inspected and confirmed?' },
  pricing: { title:'Check supplier pricing', recommendation:'Confirm the supplier quote matches the current specification revision.', question:'Does the supplier quote match the current specification revision?' },
  category: { title:'Review category allowance', recommendation:'Review the category allowance against the completed-job evidence.', question:'Has this category allowance been checked against the completed-job evidence?' },
  scope: { title:'Confirm scope assumptions', recommendation:'Confirm the documented scope and exclusions before final review.', question:'Have the scope and exclusions been confirmed?' },
} as const
export const AgentOutputSchema=z.object({
  findings:z.array(z.object({category:z.enum(categories),severity:z.enum(['low','medium','high']),action:z.enum(['access','pathway','pricing','category','scope']),calculationRefs:z.array(z.string().uuid()).min(1).max(3),jobEvidenceRefs:z.array(z.string().uuid()).max(4),lessonEvidenceRefs:z.array(z.string().uuid()).max(3).default([])}).strict()).max(3),
  questions:z.array(z.enum(['access','pathway','pricing','category','scope'])).max(2),
}).strict()
// Strands pauses through request_human_input. A final structured response is
// therefore a completed run and cannot also smuggle in an unpersisted pause.
export const StrandsAgentOutputSchema=AgentOutputSchema.extend({questions:z.array(z.enum(['access','pathway','pricing','category','scope'])).max(0)})
export type AgentOutput=z.infer<typeof AgentOutputSchema>
export type Observation={jobId:string;name:string;costDelta:number;hoursDelta:number;costDeltaPct:number|null;hoursDeltaPct:number|null}
export type Calculation={category:CostCategory;comparableJobIds:string[];sampleSize:number;overrunCount:number;overrunFrequency:number;medianVariancePct:number;minimumVariancePct:number;maximumVariancePct:number;observations:Observation[];missingDataCount?:number}
type Base={id:string;investigationId:string;createdAt:string}
export type ToolEvidence=Base & (
  | {kind:'search';toolName:'search_similar_jobs'|'search_lessons';result:{jobIds:string[];lessonIds?:string[];query?:string;comparability?:Array<{jobId:string;score:number;matched:string[];unavailable:string[]}>;lessons?:Array<{lessonId:string;sourceJobId:string;similarity?:number}>}}
  | {kind:'inspection';toolName:'inspect_job';result:{jobId:string;name:string;variances:Job['variances']}}
  | {kind:'calculation';toolName:'calculate_category_risk';result:Calculation}
  | {kind:'document';toolName:'inspect_project_documents';result:{id:string;fileName:string;text:string}[]}
  | {kind:'missing_categories';toolName:'check_missing_cost_categories';result:{category:CostCategory;jobIds:string[];sampleSize:number}[]}
  | {kind:'calibration';toolName:'get_warning_calibration';result:{total:number;evaluable:number;hitRate:number|null;mitigated?:number}}
)
export type EvidenceInput=ToolEvidence extends infer E ? E extends ToolEvidence ? Omit<E,keyof Base> : never : never
export class EvidenceLedger {
  private readonly entries=new Map<string,ToolEvidence>()
  constructor(readonly investigationId:string,private readonly persist:(entry:ToolEvidence)=>Promise<void>){}
  async record(input:EvidenceInput){
    const entry={...input,id:crypto.randomUUID(),investigationId:this.investigationId,createdAt:new Date().toISOString()} as ToolEvidence
    await this.persist(entry)
    this.entries.set(entry.id,structuredClone(entry));return structuredClone(entry)
  }
  all(){return structuredClone([...this.entries.values()])}
  get(id:string){const entry=this.entries.get(id);if(!entry||entry.investigationId!==this.investigationId)throw new Error('Unknown or foreign investigation evidence');return structuredClone(entry)}
  retrieved(jobId:string){return this.all().some(e=>e.kind==='search'&&e.result.jobIds.includes(jobId))}
}
export function calculateRisk(jobs:Job[],category:CostCategory):Calculation {
  if(jobs.some(job=>!isJobEligibleForTrustedMemory(job)))throw new Error('Every calculation job must be eligible for trusted memory')
  const observations=jobs.flatMap(job=>{const v=comparisonVariances(job).find(v=>v.category===category);return v?[{jobId:job.id,name:job.name,costDelta:v.costDelta,hoursDelta:v.hoursDelta,costDeltaPct:v.costDeltaPct,hoursDeltaPct:v.hoursDeltaPct}]:[]})
  const values=observations.map(v=>category==='labor'?(v.hoursDeltaPct??v.costDeltaPct):v.costDeltaPct).filter((v):v is number=>v!==null&&Number.isFinite(v))
  const overrunCount=values.filter(v=>v>0.05).length
  return {category,comparableJobIds:jobs.map(j=>j.id),sampleSize:values.length,missingDataCount:Math.max(0,jobs.length-values.length),overrunCount,overrunFrequency:values.length?overrunCount/values.length:0,medianVariancePct:median(values),minimumVariancePct:values.length?Math.min(...values):0,maximumVariancePct:values.length?Math.max(...values):0,observations}
}
export type RenderedFinding=Omit<Finding,'id'|'estimateId'|'status'|'createdAt'> & {evidenceRefs:string[]}
const percent=(value:number)=>`${Math.round(value*100)}%`
export function renderAgentOutput(raw:unknown,ledger:EvidenceLedger){
  const output=AgentOutputSchema.parse(raw)
  const findings:RenderedFinding[]=output.findings.map(f=>{
    const calculations=f.calculationRefs.map(ref=>{const e=ledger.get(ref);if(e.kind!=='calculation'||e.result.category!==f.category||!e.result.sampleSize)throw new Error('Finding requires a nonempty calculation for its category');return e})
    const inspected=f.jobEvidenceRefs.map(ref=>{const e=ledger.get(ref);if(e.kind!=='inspection')throw new Error('Job citation requires inspection evidence');return e})
    const lessonSearches=f.lessonEvidenceRefs.map(ref=>{const e=ledger.get(ref);if(e.kind!=='search'||e.toolName!=='search_lessons'||!e.result.lessonIds?.length)throw new Error('Lesson citation requires retrieved lesson evidence');return e})
    const jobIds=[...new Set([...calculations.flatMap(e=>e.result.observations.map(o=>o.jobId)),...inspected.map(e=>e.result.jobId)])]
    for(const jobId of jobIds)if(!ledger.retrieved(jobId))throw new Error('Cited job was not retrieved in this investigation')
    const calc=calculations[0].result
    const evidence=classifyEvidence({sampleSize:calc.sampleSize,comparableJobCount:calc.comparableJobIds.length,missingDataCount:calc.missingDataCount})
    return {category:f.category,severity:f.severity,title:actions[f.action].title,claim:`${calc.overrunCount} of ${calc.sampleSize} completed jobs exceeded the scope-adjusted ${f.category} budget by more than 5%.`,rationale:`Variance against approved scope; this does not establish cause. Median variance ${percent(calc.medianVariancePct)}; range ${percent(calc.minimumVariancePct)} to ${percent(calc.maximumVariancePct)}; overrun frequency ${percent(calc.overrunFrequency)}. Evidence strength: ${evidence.label}. ${evidence.explanation} ${evidenceDisclaimer()}`,recommendation:actions[f.action].recommendation,confidence:Math.min(0.95,0.5+calc.sampleSize*0.05),evidenceRefs:[...new Set([...f.calculationRefs,...f.jobEvidenceRefs,...lessonSearches.map(value=>value.id)])],evidence:jobIds.map(jobId=>{const o=calculations.flatMap(e=>e.result.observations).find(o=>o.jobId===jobId);const inspection=inspected.find(e=>e.result.jobId===jobId);return{jobId,label:o?.name??inspection?.result.name??'Completed job',detail:o?`Cost difference $${o.costDelta.toFixed(2)}; hours difference ${o.hoursDelta.toFixed(2)}.`:'Inspected completed-job record.'}})}
  })
  // Questions are selected from a bounded vocabulary; no model-authored arithmetic enters product copy.
  const questions=[...new Set(output.questions)].map(topic=>({prompt:actions[topic].question,context:actions[topic].recommendation,options:['Yes — confirmed','No — not confirmed','Not sure yet']}))
  return {summary:findings.length?`${findings.length} historical ${findings.length===1?'risk requires':'risks require'} review.`:'No material historical risks found.',findings,questions}
}
