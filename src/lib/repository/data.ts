import { scopeReviewSchema } from '@/lib/domain/scope'
import {z} from 'zod'
import {rows} from './rows'
import {readAll} from './pagination'
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActualLine, AgentTelemetry, Estimate, EstimateLine, Finding, FindingOutcome, HumanQuestion, Job, Lesson, LifecycleStatus, Store, Variance } from '@/lib/domain/types'
const num = (v: unknown) => Number(v ?? 0)
const maybeNum = (v: unknown) => v === null || v === undefined ? undefined : Number(v)

function mapEstimateLine(row: z.infer<typeof rows.estimate_lines> | z.infer<typeof rows.job_estimate_lines>): EstimateLine {
  return { id:row.id, category:row.category, description:row.description, quantity:maybeNum(row.quantity), unit:row.unit ?? undefined,normalizedUnit:row.normalized_unit??undefined,unitCost:maybeNum(row.unit_cost), costCode:row.cost_code??undefined, phase:row.phase??undefined, division:row.division??undefined, estimatedHours:maybeNum(row.estimated_hours), estimatedCost:num(row.estimated_cost) }
}
function mapActualLine(row: z.infer<typeof rows.job_actual_lines>): ActualLine {
  return { id:row.id, category:row.category, description:row.description,quantity:maybeNum(row.quantity),unit:row.unit??undefined,normalizedUnit:row.normalized_unit??undefined,unitCost:maybeNum(row.unit_cost), costCode:row.cost_code??undefined, phase:row.phase??undefined, division:row.division??undefined, actualHours:maybeNum(row.actual_hours), actualCost:num(row.actual_cost) }
}
function mapVariance(row: z.infer<typeof rows.job_variances>): Variance {
  return { category:row.category, estimatedCost:num(row.estimated_cost), actualCost:num(row.actual_cost), estimatedHours:num(row.estimated_hours), actualHours:num(row.actual_hours), costDelta:num(row.cost_delta), costDeltaPct:row.cost_delta_pct === null ? null : num(row.cost_delta_pct), hoursDelta:num(row.hours_delta), hoursDeltaPct:row.hours_delta_pct === null ? null : num(row.hours_delta_pct) }
}

export async function readStoreFor(supabase: SupabaseClient, orgId: string): Promise<Store> {
  const [jobsQ, jeQ, jaQ, jvQ, lessonsQ, estimatesQ, elQ, findingsQ, evidenceQ, questionsQ, outcomesQ, submittedFindingsQ, scopeQ, responsesQ] = await Promise.all([
    readAll((from,to)=>supabase.from('jobs').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.jobs),
    readAll((from,to)=>supabase.from('job_estimate_lines').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.job_estimate_lines),
    readAll((from,to)=>supabase.from('job_actual_lines').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.job_actual_lines),
    readAll((from,to)=>supabase.from('job_variances').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.job_variances),
    readAll((from,to)=>supabase.from('lessons').select('id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status,created_at,updated_at').eq('organization_id',orgId).order('id').range(from,to),rows.lessons),
    readAll((from,to)=>supabase.from('estimates').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.estimates),
    readAll((from,to)=>supabase.from('estimate_lines').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.estimate_lines),
    readAll((from,to)=>supabase.from('findings').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.findings),
    readAll((from,to)=>supabase.from('finding_evidence').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.finding_evidence),
    readAll((from,to)=>supabase.from('human_questions').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.human_questions),
    readAll((from,to)=>supabase.from('finding_outcomes').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.finding_outcomes),
    readAll((from,to)=>supabase.from('submission_findings').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.submission_findings),
    readAll((from,to)=>supabase.from('job_scope_reviews').select('*').eq('organization_id',orgId).order('job_id').range(from,to),z.object({job_id:z.string(),review:scopeReviewSchema})),
    readAll((from,to)=>supabase.from('finding_responses').select('*').eq('organization_id',orgId).order('id').range(from,to),rows.finding_responses),
  ])

  const jobEstimateLines = jeQ ?? []; const jobActualLines = jaQ ?? []; const jobVariances = jvQ ?? []
  const jobs: Job[] = (jobsQ ?? []).map((row) => ({
    id:row.id, scopeReview:scopeQ.find(r=>r.job_id===row.id)?.review, sourceEstimateId:row.source_estimate_id ?? undefined, contractValue:maybeNum(row.contract_value),estimateBaselineRole:row.estimate_baseline_role??undefined,dataOrigin:row.data_origin,memoryStatus:row.memory_status,memoryQuarantineReason:row.memory_quarantine_reason??undefined,memoryQuarantinedAt:row.memory_quarantined_at??undefined, name:row.name, projectType:row.project_type, customerType:row.customer_type, location:row.location,
    completedAt:row.completed_at, tags:row.tags ?? [], notes:row.notes ?? '', estimatedTotal:num(row.estimated_total), actualTotal:num(row.actual_total), grossMarginPct:maybeNum(row.gross_margin_pct),
    estimateLines:jobEstimateLines.filter((x)=>x.job_id===row.id).map((x)=>mapEstimateLine(x)),
    actualLines:jobActualLines.filter((x)=>x.job_id===row.id).map((x)=>mapActualLine(x)),
    variances:jobVariances.filter((x)=>x.job_id===row.id).map((x)=>mapVariance(x)),
  }))

  const lessons: Lesson[] = (lessonsQ ?? []).map((row)=>({ id:row.id,jobId:row.job_id,title:row.title,category:row.category,lesson:row.lesson,cause:row.cause,impactSummary:row.impact_summary,confidence:num(row.confidence),status:row.status,createdAt:row.created_at }))
  const estimateLines = elQ ?? []; const evidences = evidenceQ ?? []; const findingsRows = findingsQ ?? []; const questionRows = questionsQ ?? []; const outcomeRows=outcomesQ??[]
  const estimates: Estimate[] = (estimatesQ ?? []).map((row)=>{
    const findings: Finding[] = findingsRows.filter((f)=>f.estimate_id===row.id).map((f)=>({
      responses:responsesQ.filter(r=>r.finding_id===f.id).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.id.localeCompare(b.id)).map(r=>({id:r.id,findingId:r.finding_id,kind:r.kind,note:r.note,revisionReference:r.revision_reference,recordedAt:r.recorded_at,recordedStage:r.recorded_stage,recordedBy:r.recorded_by})),
      id:f.id,estimateId:f.estimate_id,category:f.category,severity:f.severity,title:f.title,claim:f.claim,rationale:f.rationale,recommendation:f.recommendation,question:f.question ?? undefined,
      evidence:evidences.filter((e)=>e.finding_id===f.id).map((e)=>({jobId:e.job_id,label:e.label,detail:e.detail})),confidence:num(f.confidence),status:f.status,createdAt:f.created_at,
    }))
    const questions: HumanQuestion[] = questionRows.filter((q)=>q.estimate_id===row.id).map((q)=>({id:q.id,estimateId:q.estimate_id,prompt:q.prompt,context:q.context,options:q.options ?? [],answer:q.answer ?? undefined,resolvedAt:q.resolved_at ?? undefined}))
    const findingOutcomes: FindingOutcome[] = outcomeRows.filter((o)=>o.estimate_id===row.id).map((o)=>({id:o.id,estimateId:o.estimate_id,findingId:o.finding_id,jobId:o.job_id,systemVerdict:o.system_verdict,confirmedVerdict:o.confirmed_verdict??undefined,assessment:o.confirmed_assessment??undefined,explanation:o.explanation,evidenceSummary:o.evidence_summary??'',confidence:num(o.confidence),confirmedAt:o.confirmed_at??undefined}))
    const linked=jobs.find(j=>j.sourceEstimateId===row.id)
    return {
      id:row.id,name:row.name,projectType:row.project_type,customerType:row.customer_type,location:row.location,bidDue:row.bid_due ?? undefined,tags:row.tags ?? [],assumptions:row.assumptions ?? [],
      lines:estimateLines.filter((x)=>x.estimate_id===row.id).map((x)=>mapEstimateLine(x)),estimatedTotal:num(row.estimated_total),estimatedLaborHours:num(row.estimated_labor_hours),createdAt:row.created_at,status:row.status,investigationStatus:row.investigation_status,
      lifecycleStatus:(row.lifecycle_status??'draft') as LifecycleStatus,submittedAt:row.submitted_at??undefined,submittedAmount:maybeNum(row.submitted_amount),wonAt:row.won_at??undefined,lostAt:row.lost_at??undefined,lostReason:row.lost_reason??undefined,contractValue:maybeNum(row.contract_value),startedAt:row.started_at??undefined,completedAt:row.completed_at??undefined,actualsImportedAt:row.actuals_imported_at??undefined,learnedAt:row.learned_at??undefined,closeoutNotes:row.closeout_notes??'',linkedJobId:linked?.id,
      findings,submittedFindingIds:(submittedFindingsQ??[]).filter((sf)=>sf.estimate_id===row.id).map((sf)=>sf.finding_id),findingOutcomes,questions,agentSummary:row.agent_summary ?? undefined,agentMode:row.agent_mode ?? undefined,agentTelemetry:(row.agent_telemetry ?? undefined) as AgentTelemetry | undefined,reviewedAt:row.reviewed_at ?? undefined,revisionGroupId:row.revision_group_id,parentEstimateId:row.parent_estimate_id??undefined,revisionNumber:row.revision_number,baselineRole:row.baseline_role,dataOrigin:row.data_origin,
    }
  })
  jobs.sort((a,b)=>b.completedAt.localeCompare(a.completedAt));lessons.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));estimates.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return { jobs, lessons, estimates }
}
