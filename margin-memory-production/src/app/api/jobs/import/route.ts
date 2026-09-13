import { comparisonVariances, ScopeInputError, validateScopeInput } from '@/lib/domain/scope'
import { historicalEvidenceReadiness, isJobEligibleForTrustedMemory } from '@/lib/domain/memory-policy'
import { embeddingsEnabled } from '@/lib/embeddings/provider'
import { NextResponse } from 'next/server'
import { calculateVariances, sumActual, sumEstimate } from '@/lib/domain/analytics'
import { id } from '@/lib/domain/ids'
import type { Job, Lesson } from '@/lib/domain/types'
import { hashImportAnalysis, ImportReviewError, spreadsheetProvenance, verifyImportReviewContract, warningAcknowledgements, type EstimateBaselineRole, type ImportReviewAnalysis } from '@/lib/import-contract'
import { commitReviewedHistoricalJob, getImportReviewRecord, getJob } from '@/lib/repository/store'
import { repairMemory } from '@/lib/repository/memory'
import { HistoricalImportMetadataError, parseHistoricalJobMetadata } from '@/lib/historical-import-metadata'
import { assessImportPair, IMPORT_PARSER_VERSION, parseActualFileWithReport, parseEstimateFileWithReport, requireImportApproval, SpreadsheetInputError } from '@/lib/spreadsheet'

export const runtime = 'nodejs'
export const maxDuration = 60

function proposeLesson(job: Job): Lesson | null {
  if (!isJobEligibleForTrustedMemory(job)) return null
  const labor = comparisonVariances(job).find((value) => value.category === 'labor');const materials = comparisonVariances(job).find((value) => value.category === 'materials');const lower=job.notes.toLowerCase()
  if (labor?.hoursDeltaPct && labor.hoursDeltaPct > 0.12) {let cause='Labor finished materially above the scope-adjusted budget.';let lesson='Review the conditions that reduced labor productivity before bidding similar work.';if(/conduit|pathway|riser|reuse/.test(lower)){cause='Existing conduit/pathway reuse did not hold in the field.';lesson='Verify existing pathway capacity before carrying conduit reuse on similar retrofit work.'}else if(/access|occupied|shutdown|after.?hours/.test(lower)){cause='Access or shutdown constraints reduced productive work time.';lesson='Confirm access windows and shutdown restrictions before using normal labor productivity.'}return{id:id(),jobId:job.id,title:'Review labor overrun lesson',category:'labor',lesson,cause,impactSummary:`${Math.round(labor.hoursDelta)} additional labor hours (${Math.round(labor.hoursDeltaPct*100)}%).`,confidence:.82,status:'pending',createdAt:new Date().toISOString()}}
  if(materials?.costDeltaPct&&materials.costDeltaPct>.12)return{id:id(),jobId:job.id,title:'Review material overrun lesson',category:'materials',lesson:'Confirm supplier pricing and specification revision before carrying similar material packages.',cause:'Material actuals exceeded the scope-adjusted budget.',impactSummary:`$${Math.round(materials.costDelta).toLocaleString()} material overrun (${Math.round(materials.costDeltaPct*100)}%).`,confidence:.78,status:'pending',createdAt:new Date().toISOString()}
  return null
}

export async function POST(request: Request) {
 try{
  const form=await request.formData();const estimateFile=form.get('estimateFile');const actualFile=form.get('actualFile');const notesFile=form.get('notesFile')
  if(!(estimateFile instanceof File)||!(actualFile instanceof File))return NextResponse.json({error:'Attach both estimate and actual-cost spreadsheets.'},{status:400})
  const reviewId=String(form.get('importReviewId')||'');const submittedReportHash=String(form.get('importReportHash')||'')
  if(!reviewId||!submittedReportHash)return NextResponse.json({error:'Preview these exact files before committing them.'},{status:409})
  const review=await getImportReviewRecord(reviewId);const estimateSource=review.files.find(file=>file.role==='estimate'&&file.ordinal===0);const actualSource=review.files.find(file=>file.role==='actuals'&&file.ordinal===0)
  if(!estimateSource||!actualSource)throw new SpreadsheetInputError('Reviewed estimate or actual source is missing.')
  const reviewedEstimateReport=review.reports.find(report=>report.kind==='estimate');const reviewedActualReport=review.reports.find(report=>report.kind==='actual')
  const [estimateResult,actualResult]=await Promise.all([parseEstimateFileWithReport(estimateFile,{worksheet:estimateSource.worksheet??undefined,mapping:reviewedEstimateReport?.mappedColumnIndexes}),parseActualFileWithReport(actualFile,{worksheet:actualSource.worksheet??undefined,mapping:reviewedActualReport?.mappedColumnIndexes})])
  const pair=assessImportPair(estimateResult.report,actualResult.report);const analysis:ImportReviewAnalysis={parserVersion:IMPORT_PARSER_VERSION,importKind:'historical_job',context:review.context,reports:[estimateResult.report,actualResult.report],issues:pair.issues,completeness:pair.completeness}
  const submittedFiles=[{role:'estimate' as const,file:estimateFile},{role:'actuals' as const,file:actualFile},...(notesFile instanceof File&&notesFile.size?[{role:'notes' as const,file:notesFile}]:[])]
  await verifyImportReviewContract({review,importKind:'historical_job',submittedReportHash,files:submittedFiles,analysis})
  const actualCompletenessConfirmed=form.get('actualCompletenessConfirmed')==='true'&&pair.completeness.state==='complete';const scopeReview=validateScopeInput(form.get('scopeReview'),estimateResult.lines,actualResult.lines,actualCompletenessConfirmed);const allowIncomplete=scopeReview.status==='unreconciled';const reviewed=form.get('importReviewed')==='true'
  requireImportApproval(pair.issues,reviewed,{actualCompletenessConfirmed,allowIncompleteActuals:allowIncomplete})
  const acknowledged=warningAcknowledgements(pair.issues,reviewed,actualCompletenessConfirmed||allowIncomplete)
  if(review.status==='committed'&&review.resultJobId){const existing=await getJob(review.resultJobId);if(existing)return NextResponse.json({job:existing,lesson:null,vectorIndexed:false,warnings:[],historicalEvidence:historicalEvidenceReadiness(existing),idempotentReplay:true})}
  if(!estimateResult.lines.length||!actualResult.lines.length)return NextResponse.json({error:'No usable spreadsheet lines were found. Check the headers.'},{status:400})
  const baseline=(review.context.estimateBaselineRole??'historical_unknown') as Exclude<EstimateBaselineRole,'revision'>
  const reviewedNotes=review.files.find(file=>file.role==='notes')?.extractedText??''
  const metadata=parseHistoricalJobMetadata({name:form.get('name'),projectType:form.get('projectType'),customerType:form.get('customerType'),location:form.get('location'),completedAt:form.get('completedAt'),tags:form.get('tags'),notes:form.get('notes')})
  const job:Job={scopeReview,id:id(),estimateBaselineRole:baseline,dataOrigin:'production',memoryStatus:'trusted',...metadata,notes:[metadata.notes,reviewedNotes].filter(Boolean).join('\n'),estimateLines:estimateResult.lines,actualLines:actualResult.lines,variances:calculateVariances(estimateResult.lines,actualResult.lines),estimatedTotal:sumEstimate(estimateResult.lines),actualTotal:sumActual(actualResult.lines)}
  const lesson=proposeLesson(job);const reportHash=hashImportAnalysis(analysis)
  const committedId=await commitReviewedHistoricalJob({reviewId,reportHash,acknowledged,job,lessons:lesson?[lesson]:[],estimateProvenance:spreadsheetProvenance(estimateResult.provenance,'estimate'),actualProvenance:spreadsheetProvenance(actualResult.provenance,'actuals')})
  const committed=await getJob(committedId);if(!committed)throw new Error('Committed job could not be loaded.')
  const warnings:string[]=[];let vectorIndexed=false
  if(isJobEligibleForTrustedMemory(committed)&&embeddingsEnabled()){try{const result=await repairMemory(committed.id);vectorIndexed=result.readiness.pendingJobs===0}catch(error){console.error(error);warnings.push('Historical evidence preparation is pending and will retry automatically.')}}
  return NextResponse.json({job:committed,lesson,vectorIndexed,warnings,historicalEvidence:historicalEvidenceReadiness(committed)})
 }catch(error){console.error(error);return NextResponse.json({error:error instanceof Error?error.message:'Could not import completed job.'},{status:error instanceof ScopeInputError||error instanceof SpreadsheetInputError||error instanceof HistoricalImportMetadataError?400:error instanceof ImportReviewError?409:500})}
}
