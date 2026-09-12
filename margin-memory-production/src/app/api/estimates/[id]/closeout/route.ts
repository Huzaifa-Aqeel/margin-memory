import { ScopeInputError, validateScopeInput } from '@/lib/domain/scope'
import {resumeCloseout} from '@/lib/closeout-recovery'
import { NextResponse } from 'next/server'
import { calculateVariances, sumActual } from '@/lib/domain/analytics'
import { id } from '@/lib/domain/ids'
import type { Job } from '@/lib/domain/types'
import { evaluateFindingOutcomes, proposeCloseoutLessons } from '@/lib/closeout'
import { hashImportAnalysis, ImportReviewError, spreadsheetProvenance, verifyImportReviewContract, warningAcknowledgements, type ImportReviewAnalysis } from '@/lib/import-contract'
import { commitReviewedCloseout, getEstimate, getImportReviewRecord } from '@/lib/repository/store'
import { assessActualAgainstEstimate, IMPORT_PARSER_VERSION, parseActualFileWithReport, requireImportApproval, SpreadsheetInputError } from '@/lib/spreadsheet'

export const runtime='nodejs'
export const maxDuration=60

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id:estimateId}=await context.params;const estimate=await getEstimate(estimateId)
  if(!estimate)return NextResponse.json({error:'Estimate not found.'},{status:404})
  if(estimate.linkedJobId)return NextResponse.json({...await resumeCloseout(estimate.id),alreadyClosed:true})
  if(estimate.lifecycleStatus!=='completed')return NextResponse.json({error:'Mark the work completed before importing actuals.'},{status:409})
  const form=await request.formData();const actualFile=form.get('actualFile');const notesFile=form.get('notesFile')
  if(!(actualFile instanceof File)||!actualFile.size)return NextResponse.json({error:'Attach the final actual-cost XLSX or CSV.'},{status:400})
  const reviewId=String(form.get('importReviewId')||'');const submittedReportHash=String(form.get('importReportHash')||'')
  if(!reviewId||!submittedReportHash)return NextResponse.json({error:'Preview these exact files before committing them.'},{status:409})
  const review=await getImportReviewRecord(reviewId);const actualSource=review.files.find(file=>file.role==='actuals'&&file.ordinal===0)
  if(!actualSource)throw new SpreadsheetInputError('Reviewed actual-cost source is missing.')
  const parsed=await parseActualFileWithReport(actualFile,{worksheet:actualSource.worksheet??undefined});const pair=assessActualAgainstEstimate(estimate.lines,parsed.report)
  const analysis:ImportReviewAnalysis={parserVersion:IMPORT_PARSER_VERSION,importKind:'closeout_actual',context:review.context,reports:[parsed.report],issues:pair.issues,completeness:pair.completeness}
  const submittedFiles=[{role:'actuals' as const,file:actualFile},...(notesFile instanceof File&&notesFile.size?[{role:'notes' as const,file:notesFile}]:[])]
  await verifyImportReviewContract({review,importKind:'closeout_actual',submittedReportHash,files:submittedFiles,analysis})
  const actualCompletenessConfirmed=form.get('actualCompletenessConfirmed')==='true'&&pair.completeness.state==='complete';const scopeReview=validateScopeInput(form.get('scopeReview'),estimate.lines,parsed.lines,actualCompletenessConfirmed);const allowIncomplete=scopeReview.status==='unreconciled';const reviewed=form.get('importReviewed')==='true'
  requireImportApproval(pair.issues,reviewed,{actualCompletenessConfirmed,allowIncompleteActuals:allowIncomplete})
  if(!parsed.lines.length)return NextResponse.json({error:'No usable actual-cost lines were found. Check the spreadsheet headers.'},{status:400})
  const notesText=review.files.find(file=>file.role==='notes')?.extractedText??'';const notes=[String(form.get('notes')||'').trim(),notesText].filter(Boolean).join('\n')
  const actualTotal=sumActual(parsed.lines);const revenue=estimate.contractValue??estimate.submittedAmount;const grossMarginPct=revenue&&revenue>0?(revenue-actualTotal)/revenue:undefined
  const job:Job={scopeReview,id:id(),sourceEstimateId:estimate.id,contractValue:revenue,estimateBaselineRole:'final_submitted',dataOrigin:'production',memoryStatus:'trusted',name:estimate.name,projectType:estimate.projectType,customerType:estimate.customerType,location:estimate.location,completedAt:(estimate.completedAt??new Date().toISOString()).slice(0,10),tags:estimate.tags,notes,estimateLines:estimate.lines,actualLines:parsed.lines,variances:calculateVariances(estimate.lines,parsed.lines),estimatedTotal:estimate.estimatedTotal,actualTotal,grossMarginPct}
  const lessons=proposeCloseoutLessons(job);const outcomes=evaluateFindingOutcomes(estimate,job);const acknowledged=warningAcknowledgements(pair.issues,reviewed,actualCompletenessConfirmed||allowIncomplete)
  await commitReviewedCloseout({reviewId,reportHash:hashImportAnalysis(analysis),acknowledged,estimate,job,lessons,outcomes,actualProvenance:spreadsheetProvenance(parsed.provenance,'actuals')})
  return NextResponse.json({...await resumeCloseout(estimate.id),lessons:lessons.length,outcomes:outcomes.length})
 }catch(error){console.error(error);return NextResponse.json({error:error instanceof Error?error.message:'Could not close out estimate.'},{status:error instanceof ScopeInputError||error instanceof SpreadsheetInputError?400:error instanceof ImportReviewError?409:500})}
}
