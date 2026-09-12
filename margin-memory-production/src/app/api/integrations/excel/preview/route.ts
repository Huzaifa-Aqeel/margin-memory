import { NextResponse } from 'next/server'
import { z } from 'zod'
import { removeStagedImportFiles, stageImportFiles } from '@/lib/documents'
import { hashImportAnalysis } from '@/lib/import-contract'
import { analyzeExcelReview } from '@/lib/integrations/excel-review-server'
import { excelEstimateProfileSchema, type ExcelPreviewResponse } from '@/lib/integrations/excel-contract'
import { excelLiveSnapshotSchema } from '@/lib/integrations/excel-snapshot'
import { cleanupExpiredImportReviews, createExcelIntegrationRun, createImportReviewRecord, getAuthenticatedSupabase, getExcelSourceBinding } from '@/lib/repository/store'

export const runtime = 'nodejs'

const bodySchema=z.strictObject({snapshot:excelLiveSnapshotSchema,profile:excelEstimateProfileSchema})
const authFailure=(error:unknown)=>error instanceof Error&&/authentication|workspace required/i.test(error.message)

export async function POST(request:Request){
 let runId='',runRecorded=false,failureStage='inspection'
 let pendingRun:Parameters<typeof createExcelIntegrationRun>[0]|undefined
 try{
  const auth=await getAuthenticatedSupabase();await cleanupExpiredImportReviews().catch(error=>console.warn('Expired import cleanup deferred:',error))
  const body=bodySchema.parse(await request.json())
  const first=await analyzeExcelReview({snapshot:body.snapshot,profile:body.profile})
  const binding=await getExcelSourceBinding(first.source.sourceIdentityHash)
  const analyzed=await analyzeExcelReview({snapshot:body.snapshot,profile:body.profile,parentEstimateId:binding?.latestEstimateId})
  const canImport=!analyzed.analysis.issues.some(issue=>issue.severity==='error')
  const reviewId=crypto.randomUUID();const expiresAt=new Date(Date.now()+2*60*60*1000).toISOString();runId=crypto.randomUUID()
  pendingRun={id:runId,sourceIdentityHash:analyzed.source.sourceIdentityHash,snapshotHash:analyzed.source.snapshotHash,adapterVersion:analyzed.source.snapshot.adapterVersion,capturedAt:analyzed.source.snapshot.capturedAt,status:'failed',failureStage,errorMessage:'Workbook inspection failed.'}
  if(!canImport){
   await createExcelIntegrationRun({...pendingRun,errorMessage:analyzed.analysis.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' ')||'Workbook inspection was blocked.'});runRecorded=true
  }else{
   failureStage='source_staging';pendingRun={...pendingRun,failureStage}
   const artifactFile=new File([analyzed.source.artifact],`${analyzed.source.snapshot.workbook.name}.margin-memory.json`,{type:'application/json'})
   const staged=await stageImportFiles({supabase:auth.supabase,organizationId:auth.organizationId,reviewId,files:[{
    role:'estimate',file:artifactFile,worksheet:analyzed.source.snapshot.worksheet.name,sourceType:'excel_live_snapshot',sourceAdapterVersion:analyzed.source.snapshot.adapterVersion,
    sourceMetadata:{sourceIdentityHash:analyzed.source.sourceIdentityHash,workbookName:analyzed.source.snapshot.workbook.name,worksheetId:analyzed.source.snapshot.worksheet.id,worksheetName:analyzed.source.snapshot.worksheet.name,selection:analyzed.source.snapshot.selection},
    canonicalSnapshotHash:analyzed.source.snapshotHash,sourceCapturedAt:analyzed.source.snapshot.capturedAt,
   }]})
   failureStage='review_contract';pendingRun={...pendingRun,failureStage}
   try{await createImportReviewRecord({id:reviewId,analysis:analyzed.analysis,files:staged,expiresAt})}catch(error){await removeStagedImportFiles(auth.supabase,staged);throw error}
   await createExcelIntegrationRun({id:runId,sourceIdentityHash:analyzed.source.sourceIdentityHash,snapshotHash:analyzed.source.snapshotHash,adapterVersion:analyzed.source.snapshot.adapterVersion,capturedAt:analyzed.source.snapshot.capturedAt,status:'ready',reviewId});runRecorded=true
  }
  const response:ExcelPreviewResponse={source:{sourceType:'excel_live_snapshot',snapshotHash:analyzed.source.snapshotHash,sourceIdentityHash:analyzed.source.sourceIdentityHash,adapterVersion:analyzed.source.snapshot.adapterVersion,workbookName:analyzed.source.snapshot.workbook.name,worksheetName:analyzed.source.snapshot.worksheet.name,selectionAddress:analyzed.source.snapshot.selection.address,capturedAt:analyzed.source.snapshot.capturedAt},report:analyzed.parsed.report,issues:analyzed.analysis.issues,review:canImport?{id:reviewId,reportHash:hashImportAnalysis(analyzed.analysis),expiresAt}:undefined,runId,requiresReview:analyzed.analysis.issues.some(issue=>issue.severity==='warning'),canImport}
  return NextResponse.json(response)
 }catch(error){
  if(pendingRun&&!runRecorded)await createExcelIntegrationRun({...pendingRun,errorMessage:error instanceof Error?error.message:'Excel source preparation failed.'}).catch(()=>undefined)
  console.error('Excel preview failed:',error)
  return NextResponse.json({error:error instanceof Error?error.message:'Could not inspect the selected Excel source.',runId:runId||undefined},{status:authFailure(error)?401:error instanceof z.ZodError?400:500})
 }
}
