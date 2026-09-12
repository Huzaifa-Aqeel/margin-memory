import { NextResponse } from 'next/server'
import { z } from 'zod'
import { InvestigationAlreadyRunningError } from '@/lib/agent/errors'
import { runPreflight } from '@/lib/agent/preflight'
import { estimateLaborHours, sumEstimate } from '@/lib/domain/analytics'
import { id } from '@/lib/domain/ids'
import type { Estimate } from '@/lib/domain/types'
import { ImportReviewError, spreadsheetProvenance, warningAcknowledgements } from '@/lib/import-contract'
import { presentExcelEstimate } from '@/lib/integrations/excel-contract'
import { verifyExcelReviewContract } from '@/lib/integrations/excel-review-server'
import { excelLiveSnapshotSchema } from '@/lib/integrations/excel-snapshot'
import { commitReviewedEstimate, getEstimate, getImportReviewRecord, getLatestInvestigationId, updateExcelIntegrationRun } from '@/lib/repository/store'
import { requireImportApproval, SpreadsheetInputError } from '@/lib/spreadsheet'

export const runtime='nodejs'
export const maxDuration=300

const bodySchema=z.strictObject({snapshot:excelLiveSnapshotSchema,reviewId:z.string().uuid(),reportHash:z.string().regex(/^[0-9a-f]{64}$/),runId:z.string().uuid(),reviewed:z.boolean().default(false)})
const authFailure=(error:unknown)=>error instanceof Error&&/authentication|workspace required/i.test(error.message)

export async function POST(request:Request){
 let runId:string|undefined,reviewId:string|undefined,estimateId:string|undefined
 try{
  const body=bodySchema.parse(await request.json());runId=body.runId;reviewId=body.reviewId
  const review=await getImportReviewRecord(body.reviewId)
  const current=await verifyExcelReviewContract({review,snapshot:body.snapshot,submittedReportHash:body.reportHash})
  requireImportApproval(current.analysis.issues,body.reviewed)
  const acknowledged=warningAcknowledgements(current.analysis.issues,body.reviewed,false)
  await updateExcelIntegrationRun(body.runId,{status:'committing',reviewId:body.reviewId})
  const profile=current.profile
  const estimate:Estimate={id:id(),name:profile.name,projectType:profile.projectType,customerType:profile.customerType,location:profile.location,bidDue:profile.bidDue||undefined,tags:profile.tags,assumptions:profile.assumptions,lines:current.parsed.lines,estimatedTotal:sumEstimate(current.parsed.lines),estimatedLaborHours:estimateLaborHours(current.parsed.lines),createdAt:new Date().toISOString(),status:'draft',investigationStatus:'queued',lifecycleStatus:'draft',findings:[],submittedFindingIds:[],findingOutcomes:[],questions:[],baselineRole:review.context.parentEstimateId?'revision':'original_bid'}
  estimateId=await commitReviewedEstimate({reviewId:review.id,reportHash:current.reportHash,acknowledged,estimate,provenance:spreadsheetProvenance(current.parsed.provenance,'estimate'),parentEstimateId:review.context.parentEstimateId??undefined,baselineRole:estimate.baselineRole})
  let saved=await getEstimate(estimateId);if(!saved)throw new Error('Committed Excel estimate could not be loaded.')
  if(saved.investigationStatus==='queued'||saved.investigationStatus==='failed'){
   await updateExcelIntegrationRun(body.runId,{status:'running',reviewId:body.reviewId,estimateId})
   saved=await runPreflight(estimateId)
   if(!saved)throw new Error('Preflight completed without a persisted estimate result.')
  }
  const presentation=presentExcelEstimate(saved)
  await updateExcelIntegrationRun(body.runId,{status:presentation.result==='needs_input'?'needs_input':presentation.result==='running'?'running':presentation.result==='failed'?'failed':'completed',reviewId:body.reviewId,estimateId,investigationId:await getLatestInvestigationId(estimateId),failureStage:presentation.result==='failed'?'preflight':undefined,errorMessage:presentation.result==='failed'?'Preflight failed. Retry when the model service is available.':undefined})
  return NextResponse.json({estimate:presentation,idempotentReplay:estimateId!==estimate.id})
 }catch(error){
  if(error instanceof InvestigationAlreadyRunningError&&estimateId&&runId&&reviewId){const estimate=await getEstimate(estimateId);if(estimate){await updateExcelIntegrationRun(runId,{status:'running',reviewId,estimateId}).catch(()=>undefined);return NextResponse.json({estimate:presentExcelEstimate(estimate),alreadyRunning:true},{status:202})}}
  if(runId&&reviewId)await updateExcelIntegrationRun(runId,{status:'failed',reviewId,estimateId,failureStage:estimateId?'preflight':'commit',errorMessage:error instanceof Error?error.message:'Excel Margin Check failed.'}).catch(()=>undefined)
  console.error('Excel Margin Check failed:',error)
  return NextResponse.json({error:error instanceof Error?error.message:'Could not run Margin Check.'},{status:authFailure(error)?401:error instanceof ImportReviewError?409:error instanceof SpreadsheetInputError||error instanceof z.ZodError?400:500})
 }
}
