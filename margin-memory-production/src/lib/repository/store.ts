import { assessmentVerdict, outcomeAssessmentSchema, responseRequestSchema, type OutcomeAssessment, type WarningResponseInput } from '@/lib/domain/warning-response'
import { unknownScope } from '@/lib/domain/scope'
import type {StagedDocument} from '@/lib/documents'
import {InvestigationAlreadyRunningError} from '@/lib/agent/errors'
import {z} from 'zod'
import {rows} from './rows'
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Estimate, FindingOutcomeVerdict, Job, Lesson, LifecycleStatus } from '@/lib/domain/types'
import { ImportReviewError, type ImportLineProvenanceInput, type ImportReviewAnalysis, type ImportReviewRecord, type StagedImportFile } from '@/lib/import-contract'
import { getCurrentWorkspace, requireWorkspace } from './workspace'
import { readStoreFor } from './data'
import { createAdminClient } from '@/lib/supabase/admin'

export async function readStore(){const {supabase,workspace}=await requireWorkspace();return readStoreFor(supabase,workspace.id)}

export async function getEstimate(id: string) { const store = await readStore(); return store.estimates.find((x)=>x.id===id) }
export async function getJob(id: string) { const store = await readStore(); return store.jobs.find((x)=>x.id===id) }

export async function saveEstimate(estimate: Estimate) {
  const { workspace,userId } = await requireWorkspace(); const orgId=workspace.id;const admin=createAdminClient()
  const payload={id:estimate.id,organization_id:orgId,name:estimate.name,project_type:estimate.projectType,customer_type:estimate.customerType,location:estimate.location,bid_due:estimate.bidDue??'',tags:estimate.tags,assumptions:estimate.assumptions,estimated_total:estimate.estimatedTotal,estimated_labor_hours:estimate.estimatedLaborHours,status:'draft',investigation_status:'queued',created_at:estimate.createdAt}
  const lines=estimateLineRows(estimate.lines)
  const {error}=await admin.rpc('create_estimate_server',{p_organization_id:orgId,p_actor_user_id:userId,p_estimate:payload,p_lines:lines});if(error)throw error;return estimate
}

export async function saveJob(job: Job, lessons: Lesson[] = []) {
  const { workspace,userId } = await requireWorkspace(); const orgId=workspace.id;const admin=createAdminClient()
  const payload={scope_review:job.scopeReview??unknownScope,id:job.id,organization_id:orgId,name:job.name,project_type:job.projectType,customer_type:job.customerType,location:job.location,completed_at:job.completedAt,tags:job.tags,notes:job.notes,estimated_total:job.estimatedTotal,actual_total:job.actualTotal,gross_margin_pct:job.grossMarginPct??null,estimate_baseline_role:job.estimateBaselineRole??null,data_origin:job.dataOrigin??'production',created_at:new Date().toISOString()}
  const estimateLines=estimateLineRows(job.estimateLines)
  const actualLines=actualLineRows(job.actualLines)
  const variances=job.variances.map(v=>({category:v.category,estimated_cost:v.estimatedCost,actual_cost:v.actualCost,estimated_hours:v.estimatedHours,actual_hours:v.actualHours,cost_delta:v.costDelta,cost_delta_pct:v.costDeltaPct,hours_delta:v.hoursDelta,hours_delta_pct:v.hoursDeltaPct}))
  const lessonRows=lessons.map(l=>({id:l.id,title:l.title,category:l.category,lesson:l.lesson,cause:l.cause,impact_summary:l.impactSummary,confidence:l.confidence,status:l.status,created_at:l.createdAt}))
  const {error}=await admin.rpc('create_completed_job_server',{p_organization_id:orgId,p_actor_user_id:userId,p_job:payload,p_estimate_lines:estimateLines,p_actual_lines:actualLines,p_variances:variances,p_lessons:lessonRows});if(error)throw error;return job
}

export async function updateFindingStatus(findingId:string,status:'open'|'resolved'|'dismissed') {
  const {supabase,workspace}=await requireWorkspace()
  const {data,error}=await supabase.rpc('set_finding_status',{p_organization_id:workspace.id,p_finding_id:findingId,p_status:status})
  if(error)throw error
  return data
}
export async function recordFindingResponse(findingId:string,responseId:string,response:WarningResponseInput,status?:'resolved'|'dismissed') {
  const input=responseRequestSchema.parse({responseId,response,status})
  const {supabase,workspace}=await requireWorkspace()
  const {data,error}=await supabase.rpc('record_finding_response',{p_organization_id:workspace.id,p_finding_id:findingId,p_response_id:input.responseId,p_response:input.response,p_status:input.status??null})
  if(error)throw error
  return data
}
export async function updateLessonStatus(lessonId:string,status:'confirmed'|'rejected') {
  const {workspace,userId}=await requireWorkspace();const admin=createAdminClient();const {error}=await admin.rpc('set_lesson_status_server',{p_organization_id:workspace.id,p_actor_user_id:userId,p_lesson_id:lessonId,p_status:status});if(error)throw error
  const{data,error:readError}=await admin.from('lessons').select('id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status,created_at,updated_at').eq('organization_id',workspace.id).eq('id',lessonId).single();if(readError)throw readError;return rows.lessons.parse(data)
}
export async function answerHumanQuestion(estimateId:string,questionId:string,answer:string) {
  const {supabase,workspace}=await requireWorkspace()
  const {error}=await supabase.rpc('answer_estimator_question',{p_organization_id:workspace.id,p_estimate_id:estimateId,p_question_id:questionId,p_answer:answer})
  if(error)throw error
}

export async function createInvestigation(estimateId:string) {
  const {supabase,workspace,userId}=await requireWorkspace()
  const admin=createAdminClient()
  const investigationId=crypto.randomUUID()
  const {error}=await admin.rpc('begin_investigation',{p_organization_id:workspace.id,p_estimate_id:estimateId,p_investigation_id:investigationId,p_actor_user_id:userId})
  if(error){if(error.code==='55P03')throw new InvestigationAlreadyRunningError();throw error}
  return {supabase,organizationId:workspace.id,investigation:{id:investigationId}}
}

export async function getAuthenticatedSupabase() {
  const context=await getCurrentWorkspace(); if(!context.userId || !context.workspace) throw new Error('Authentication/workspace required'); return {supabase:context.supabase as SupabaseClient,organizationId:context.workspace.id,userId:context.userId,workspace:context.workspace}
}

const reviewRowSchema=z.object({
 id:z.string(),organization_id:z.string(),user_id:z.string(),import_kind:z.enum(['new_estimate','historical_job','closeout_actual']),parser_version:z.string(),report_hash:z.string(),context:z.record(z.string(),z.string().nullable()),reports:z.array(z.unknown()),issues:z.array(z.unknown()),completeness:z.unknown().nullable(),status:z.enum(['staged','committed','expired','cleaned']),expires_at:z.string(),result_estimate_id:z.string().nullable(),result_job_id:z.string().nullable(),
})
const reviewFileSchema=z.object({id:z.string(),role:z.enum(['estimate','actuals','notes','project_document']),ordinal:z.coerce.number(),file_name:z.string(),storage_path:z.string(),mime_type:z.string(),size_bytes:z.coerce.number(),file_sha256:z.string(),extracted_text:z.string(),worksheet:z.string().nullable(),source_type:z.enum(['xlsx_upload','csv_upload','excel_live_snapshot']).nullable().optional(),source_adapter_version:z.string().nullable().optional(),source_metadata:z.record(z.string(),z.unknown()).nullable().optional(),canonical_snapshot_hash:z.string().nullable().optional(),source_captured_at:z.string().nullable().optional()})

export async function createImportReviewRecord(args:{id:string;analysis:ImportReviewAnalysis;files:StagedImportFile[];expiresAt:string}){
 const {organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient()
 const {data,error}=await admin.rpc('create_import_review',{p_organization_id:organizationId,p_actor_user_id:userId,p_review_id:args.id,p_import_kind:args.analysis.importKind,p_parser_version:args.analysis.parserVersion,p_report_hash:await import('@/lib/import-contract').then(module=>module.hashImportAnalysis(args.analysis)),p_context:args.analysis.context,p_reports:args.analysis.reports,p_issues:args.analysis.issues,p_completeness:args.analysis.completeness??null,p_files:args.files.map(file=>({id:file.id,role:file.role,ordinal:file.ordinal,file_name:file.fileName,storage_path:file.storagePath,mime_type:file.mimeType,size_bytes:file.sizeBytes,sha256:file.sha256,extracted_text:file.extractedText,worksheet:file.worksheet,source_type:file.sourceType??null,source_adapter_version:file.sourceAdapterVersion??null,source_metadata:file.sourceMetadata??{},canonical_snapshot_hash:file.canonicalSnapshotHash??null,source_captured_at:file.sourceCapturedAt??null})),p_expires_at:args.expiresAt})
 if(error)throw error;return data as string
}

export async function getImportReviewRecord(reviewId:string):Promise<ImportReviewRecord>{
 const {organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient()
 const [{data,error},{data:fileRows,error:fileError}]=await Promise.all([admin.from('import_reviews').select('*').eq('organization_id',organizationId).eq('user_id',userId).eq('id',reviewId).maybeSingle(),admin.from('import_review_files').select('*').eq('organization_id',organizationId).eq('import_review_id',reviewId).order('role').order('ordinal')])
 if(error)throw error;if(fileError)throw fileError;if(!data)throw new ImportReviewError('Import review not found or no longer available.')
 const row=reviewRowSchema.parse(data);const files=z.array(reviewFileSchema).parse(fileRows)
 return{id:row.id,organizationId:row.organization_id,userId:row.user_id,importKind:row.import_kind,parserVersion:row.parser_version,reportHash:row.report_hash,context:row.context,reports:row.reports as ImportReviewRecord['reports'],issues:row.issues as ImportReviewRecord['issues'],completeness:(row.completeness??undefined) as ImportReviewRecord['completeness'],status:row.status,expiresAt:row.expires_at,resultEstimateId:row.result_estimate_id??undefined,resultJobId:row.result_job_id??undefined,files:files.map(file=>({id:file.id,role:file.role,ordinal:file.ordinal,fileName:file.file_name,storagePath:file.storage_path,mimeType:file.mime_type,sizeBytes:file.size_bytes,sha256:file.file_sha256,extractedText:file.extracted_text,worksheet:file.worksheet,sourceType:file.source_type??undefined,sourceAdapterVersion:file.source_adapter_version??undefined,sourceMetadata:file.source_metadata??undefined,canonicalSnapshotHash:file.canonical_snapshot_hash??undefined,sourceCapturedAt:file.source_captured_at??undefined}))}
}

export type ExcelSourceBinding={latestSnapshotHash:string;latestProfileHash:string;latestReviewId:string;latestEstimateId:string}
export async function getExcelSourceBinding(sourceIdentityHash:string):Promise<ExcelSourceBinding|undefined>{
 const {organizationId}=await getAuthenticatedSupabase();const admin=createAdminClient()
 const{data,error}=await admin.from('estimate_source_bindings').select('latest_snapshot_hash,latest_profile_hash,latest_review_id,latest_estimate_id').eq('organization_id',organizationId).eq('source_type','excel_live_snapshot').eq('source_identity_hash',sourceIdentityHash).maybeSingle()
 if(error)throw error;if(!data)return undefined
 return{latestSnapshotHash:String(data.latest_snapshot_hash),latestProfileHash:String(data.latest_profile_hash),latestReviewId:String(data.latest_review_id),latestEstimateId:String(data.latest_estimate_id)}
}

export async function createExcelIntegrationRun(args:{id:string;sourceIdentityHash:string;snapshotHash:string;adapterVersion:string;capturedAt:string;status:'previewed'|'ready'|'failed';reviewId?:string;failureStage?:string;errorMessage?:string}){
 const{organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient()
 const{error}=await admin.from('excel_integration_runs').insert({id:args.id,organization_id:organizationId,user_id:userId,source_identity_hash:args.sourceIdentityHash,snapshot_hash:args.snapshotHash,adapter_version:args.adapterVersion,captured_at:args.capturedAt,status:args.status,review_id:args.reviewId??null,failure_stage:args.failureStage??null,error_message:args.errorMessage??null})
 if(error)throw error
}

export async function updateExcelIntegrationRun(runId:string,args:{status:'ready'|'committing'|'running'|'needs_input'|'completed'|'failed';reviewId:string;estimateId?:string;investigationId?:string;failureStage?:string;errorMessage?:string}){
 const{organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient()
 const{data,error}=await admin.from('excel_integration_runs').update({status:args.status,estimate_id:args.estimateId,investigation_id:args.investigationId,failure_stage:args.failureStage??null,error_message:args.errorMessage??null,updated_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('user_id',userId).eq('review_id',args.reviewId).eq('id',runId).select('id').maybeSingle()
 if(error)throw error;if(!data)throw new Error('Excel integration operation not found.')
}

export async function getLatestInvestigationId(estimateId:string){
 const{organizationId}=await getAuthenticatedSupabase();const admin=createAdminClient();const{data,error}=await admin.from('investigations').select('id').eq('organization_id',organizationId).eq('estimate_id',estimateId).order('started_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data?String(data.id):undefined
}

export async function updateLatestExcelRunForEstimate(estimateId:string,status:'running'|'needs_input'|'completed'|'failed',errorMessage?:string){
 const{organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient();const{data,error}=await admin.from('excel_integration_runs').select('id,review_id').eq('organization_id',organizationId).eq('user_id',userId).eq('estimate_id',estimateId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;if(!data)return
 await updateExcelIntegrationRun(String(data.id),{status,reviewId:String(data.review_id),estimateId,investigationId:await getLatestInvestigationId(estimateId),failureStage:status==='failed'?'preflight':undefined,errorMessage:status==='failed'?(errorMessage||'Preflight failed.'):undefined})
}

function estimateLineRows(lines:Estimate['lines']){return lines.map(line=>({id:line.id,category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,estimated_hours:line.estimatedHours??null,estimated_cost:line.estimatedCost}))}
function actualLineRows(lines:Job['actualLines']){return lines.map(line=>({id:line.id,category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,actual_hours:line.actualHours??null,actual_cost:line.actualCost}))}
function jobPayload(job:Job){return{scope_review:job.scopeReview??unknownScope,id:job.id,name:job.name,project_type:job.projectType,customer_type:job.customerType,location:job.location,completed_at:job.completedAt,tags:job.tags,notes:job.notes,estimated_total:job.estimatedTotal,actual_total:job.actualTotal,gross_margin_pct:job.grossMarginPct??null,data_origin:job.dataOrigin??'production',created_at:new Date().toISOString()}}
function lessonRows(lessons:Lesson[]){return lessons.map(l=>({id:l.id,title:l.title,category:l.category,lesson:l.lesson,cause:l.cause,impact_summary:l.impactSummary,confidence:l.confidence,status:l.status,created_at:l.createdAt}))}
function varianceRows(job:Job){return job.variances.map(v=>({category:v.category,estimated_cost:v.estimatedCost,actual_cost:v.actualCost,estimated_hours:v.estimatedHours,actual_hours:v.actualHours,cost_delta:v.costDelta,cost_delta_pct:v.costDeltaPct,hours_delta:v.hoursDelta,hours_delta_pct:v.hoursDeltaPct}))}

export async function commitReviewedEstimate(args:{reviewId:string;reportHash:string;acknowledged:string[];estimate:Estimate;provenance:ImportLineProvenanceInput[];parentEstimateId?:string;baselineRole:Estimate['baselineRole']}){
 const {organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient();const estimate={id:args.estimate.id,name:args.estimate.name,project_type:args.estimate.projectType,customer_type:args.estimate.customerType,location:args.estimate.location,bid_due:args.estimate.bidDue??'',tags:args.estimate.tags,assumptions:args.estimate.assumptions,created_at:args.estimate.createdAt,parent_estimate_id:args.parentEstimateId??null,baseline_role:args.baselineRole??'original_bid'}
 const {data,error}=await admin.rpc('commit_estimate_import',{p_organization_id:organizationId,p_actor_user_id:userId,p_review_id:args.reviewId,p_report_hash:args.reportHash,p_acknowledged:args.acknowledged,p_estimate:estimate,p_lines:estimateLineRows(args.estimate.lines),p_provenance:args.provenance});if(error)throw error;return data as string
}

export async function commitReviewedHistoricalJob(args:{reviewId:string;reportHash:string;acknowledged:string[];job:Job;lessons:Lesson[];estimateProvenance:ImportLineProvenanceInput[];actualProvenance:ImportLineProvenanceInput[]}){
 const {organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient();const {data,error}=await admin.rpc('commit_historical_import',{p_organization_id:organizationId,p_actor_user_id:userId,p_review_id:args.reviewId,p_report_hash:args.reportHash,p_acknowledged:args.acknowledged,p_job:jobPayload(args.job),p_estimate_lines:estimateLineRows(args.job.estimateLines),p_actual_lines:actualLineRows(args.job.actualLines),p_variances:varianceRows(args.job),p_lessons:lessonRows(args.lessons),p_estimate_provenance:args.estimateProvenance,p_actual_provenance:args.actualProvenance});if(error)throw error;return data as string
}

export async function commitReviewedCloseout(args:{reviewId:string;reportHash:string;acknowledged:string[];estimate:Estimate;job:Job;lessons:Lesson[];outcomes:Array<{id:string;findingId:string;systemVerdict:FindingOutcomeVerdict;explanation:string;evidenceSummary:string;confidence:number}>;actualProvenance:ImportLineProvenanceInput[]}){
 const {organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient();const outcomes=args.outcomes.map(o=>({finding_id:o.findingId,system_verdict:o.systemVerdict,explanation:o.explanation,evidence_summary:o.evidenceSummary,confidence:o.confidence}));const {data,error}=await admin.rpc('commit_closeout_import',{p_organization_id:organizationId,p_actor_user_id:userId,p_review_id:args.reviewId,p_report_hash:args.reportHash,p_acknowledged:args.acknowledged,p_estimate_id:args.estimate.id,p_actual_lines:actualLineRows(args.job.actualLines),p_lessons:lessonRows(args.lessons),p_outcomes:outcomes,p_notes:args.job.notes,p_scope_review:args.job.scopeReview??unknownScope,p_actual_provenance:args.actualProvenance});if(error)throw error;return data as string
}

export async function cleanupExpiredImportReviews(){const {supabase,organizationId,userId}=await getAuthenticatedSupabase();const admin=createAdminClient();const{data,error}=await admin.rpc('claim_expired_import_files',{p_organization_id:organizationId,p_actor_user_id:userId,p_limit:20});if(error)throw error;const claimed=z.array(z.object({review_id:z.string(),storage_path:z.string()})).parse(data??[]);if(!claimed.length)return 0;const{error:removeError}=await supabase.storage.from('job-files').remove(claimed.map(row=>row.storage_path));if(removeError)throw removeError;const ids=[...new Set(claimed.map(row=>row.review_id))];const{data:count,error:finishError}=await admin.rpc('finish_import_cleanup',{p_organization_id:organizationId,p_actor_user_id:userId,p_review_ids:ids});if(finishError)throw finishError;return Number(count??0)}

export type LineSourceTrace={lineId:string;lineKind:'estimate'|'job_estimate'|'job_actual';fileName:string;worksheet:string;sourceRow:number;mapping:Record<string,string>;originalValues:Record<string,string>;normalizationDecisions:string[];parserVersion:string}
export async function listLineSourceTraces(owner:{estimateId?:string;jobId?:string}):Promise<LineSourceTrace[]>{
 const {organizationId}=await getAuthenticatedSupabase();const admin=createAdminClient();const requests:Array<Promise<{data:unknown[]|null;error:unknown}>>=[]
 if(owner.estimateId){const{data,error}=await admin.from('estimate_lines').select('id').eq('organization_id',organizationId).eq('estimate_id',owner.estimateId);if(error)throw error;const ids=(data??[]).map(row=>String(row.id));if(ids.length)requests.push(admin.from('import_line_provenance').select('*').eq('organization_id',organizationId).in('estimate_line_id',ids) as unknown as Promise<{data:unknown[]|null;error:unknown}>)}
 if(owner.jobId){const[{data:estimateLines,error:estimateError},{data:actualLines,error:actualError}]=await Promise.all([admin.from('job_estimate_lines').select('id').eq('organization_id',organizationId).eq('job_id',owner.jobId),admin.from('job_actual_lines').select('id').eq('organization_id',organizationId).eq('job_id',owner.jobId)]);if(estimateError)throw estimateError;if(actualError)throw actualError;const estimateIds=(estimateLines??[]).map(row=>String(row.id)),actualIds=(actualLines??[]).map(row=>String(row.id));if(estimateIds.length)requests.push(admin.from('import_line_provenance').select('*').eq('organization_id',organizationId).in('job_estimate_line_id',estimateIds) as unknown as Promise<{data:unknown[]|null;error:unknown}>);if(actualIds.length)requests.push(admin.from('import_line_provenance').select('*').eq('organization_id',organizationId).in('job_actual_line_id',actualIds) as unknown as Promise<{data:unknown[]|null;error:unknown}>)}
 const results=await Promise.all(requests);for(const result of results)if(result.error)throw result.error
 const provenance=z.array(z.object({import_review_file_id:z.string(),estimate_line_id:z.string().nullable(),job_estimate_line_id:z.string().nullable(),job_actual_line_id:z.string().nullable(),worksheet:z.string(),source_row:z.coerce.number(),resolved_mapping:z.record(z.string(),z.string()),original_values:z.record(z.string(),z.string()),normalization_decisions:z.array(z.string()),parser_version:z.string()})).parse(results.flatMap(result=>result.data??[]));if(!provenance.length)return[]
 const fileIds=[...new Set(provenance.map(row=>row.import_review_file_id))];const{data:files,error:fileError}=await admin.from('import_review_files').select('id,file_name').eq('organization_id',organizationId).in('id',fileIds);if(fileError)throw fileError;const names=new Map((files??[]).map(file=>[String(file.id),String(file.file_name)]))
 return provenance.map((row):LineSourceTrace=>({lineId:row.estimate_line_id??row.job_estimate_line_id??row.job_actual_line_id??'',lineKind:row.estimate_line_id?'estimate':row.job_estimate_line_id?'job_estimate':'job_actual',fileName:names.get(row.import_review_file_id)??'Archived source',worksheet:row.worksheet,sourceRow:row.source_row,mapping:row.resolved_mapping,originalValues:row.original_values,normalizationDecisions:row.normalization_decisions,parserVersion:row.parser_version})).sort((a,b)=>a.fileName.localeCompare(b.fileName)||a.worksheet.localeCompare(b.worksheet)||a.sourceRow-b.sourceRow)
}

export async function transitionEstimateLifecycle(estimateId:string,to:LifecycleStatus,args?:{note?:string;amount?:number}){
  const {supabase,workspace}=await requireWorkspace()
  const {data,error}=await supabase.rpc('transition_estimate_lifecycle',{p_organization_id:workspace.id,p_estimate_id:estimateId,p_to_stage:to,p_note:args?.note??'',p_amount:args?.amount??null})
  if(error)throw error
  return data as LifecycleStatus
}

export async function closeoutEstimate(args:{estimate:Estimate;job:Job;lessons:Lesson[];sources:StagedDocument[];outcomes:Array<{id:string;findingId:string;systemVerdict:FindingOutcomeVerdict;explanation:string;evidenceSummary:string;confidence:number}>}){
  const {workspace,userId}=await requireWorkspace();const admin=createAdminClient()
  const actualLines=actualLineRows(args.job.actualLines)
  const lessons=args.lessons.map(l=>({title:l.title,category:l.category,lesson:l.lesson,cause:l.cause,impact_summary:l.impactSummary,confidence:l.confidence}))
  const outcomes=args.outcomes.map(o=>({finding_id:o.findingId,system_verdict:o.systemVerdict,explanation:o.explanation,evidence_summary:o.evidenceSummary,confidence:o.confidence}))
  const {data,error}=await admin.rpc('closeout_estimate_server',{p_organization_id:workspace.id,p_actor_user_id:userId,p_estimate_id:args.estimate.id,p_actual_lines:actualLines,p_lessons:lessons,p_outcomes:outcomes,p_closeout_notes:args.job.notes,p_source_documents:args.sources,p_scope_review:args.job.scopeReview??unknownScope})
  if(error)throw error
  return data as string
}

export async function confirmFindingOutcome(outcomeId:string,input:OutcomeAssessment){
  const assessment=outcomeAssessmentSchema.parse(input)
  const {supabase,workspace}=await requireWorkspace()
  const {data,error}=await supabase.rpc('confirm_finding_outcome',{p_organization_id:workspace.id,p_outcome_id:outcomeId,p_verdict:assessmentVerdict(assessment),p_assessment:assessment})
  if(error)throw error
  return data as string
}

export async function tryFinalizeEstimateLearning(estimateId:string){
  const {supabase,workspace}=await requireWorkspace()
  const {data,error}=await supabase.rpc('try_finalize_estimate_learning',{p_organization_id:workspace.id,p_estimate_id:estimateId})
  if(error)throw error
  return Boolean(data)
}

export async function getWarningCalibration(category?:string){
  const {supabase,workspace}=await requireWorkspace()
  const {data,error}=await supabase.rpc('get_warning_calibration',{p_organization_id:workspace.id,p_category:category??null});if(error)throw error
  const row=z.array(z.object({mitigated:z.coerce.number(),validated:z.coerce.number(),partially_validated:z.coerce.number(),not_observed:z.coerce.number(),not_evaluable:z.coerce.number(),total:z.coerce.number(),evaluable:z.coerce.number(),hit_rate:z.coerce.number().nullable()})).parse(data)[0]
  return {mitigated:Number(row?.mitigated??0),validated:Number(row?.validated??0),partiallyValidated:Number(row?.partially_validated??0),notObserved:Number(row?.not_observed??0),notEvaluable:Number(row?.not_evaluable??0),total:Number(row?.total??0),evaluable:Number(row?.evaluable??0),hitRate:row?.hit_rate===null||row?.hit_rate===undefined?null:Number(row.hit_rate)}
}

export async function getEstimateLifecycleEvents(estimateId:string){
  const {supabase,workspace}=await requireWorkspace();const {data,error}=await supabase.from('lifecycle_events').select('*').eq('organization_id',workspace.id).eq('estimate_id',estimateId).order('created_at',{ascending:true});if(error)throw error;return z.array(rows.lifecycle_events).parse(data)
}

export async function listDocuments(owner:{jobId?:string;estimateId?:string}){
  const {supabase,workspace}=await requireWorkspace();let query=supabase.from('documents').select('id,file_name,kind,storage_path,mime_type,size_bytes,created_at').eq('organization_id',workspace.id).order('created_at',{ascending:true});if(owner.jobId)query=query.eq('job_id',owner.jobId);if(owner.estimateId)query=query.eq('estimate_id',owner.estimateId);const{data,error}=await query;if(error)throw error;return Promise.all(z.array(rows.documents.pick({id:true,file_name:true,kind:true,storage_path:true,mime_type:true,size_bytes:true,created_at:true})).parse(data).map(async(row)=>{const{data:signed}=await supabase.storage.from('job-files').createSignedUrl(row.storage_path,300);return{id:row.id,fileName:row.file_name,kind:row.kind,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes??0),url:signed?.signedUrl??null}}))
}
