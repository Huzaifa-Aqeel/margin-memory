import {InvestigationAlreadyRunningError} from '@/lib/agent/errors'
import { NextResponse } from 'next/server'
import { runPreflight } from '@/lib/agent/preflight'
import { estimateLaborHours, sumEstimate } from '@/lib/domain/analytics'
import { id } from '@/lib/domain/ids'
import type { Estimate } from '@/lib/domain/types'
import { hashImportAnalysis, ImportReviewError, spreadsheetProvenance, verifyImportReviewContract, warningAcknowledgements, type EstimateBaselineRole, type ImportReviewAnalysis } from '@/lib/import-contract'
import { commitReviewedEstimate, getImportReviewRecord, getEstimate } from '@/lib/repository/store'
import { IMPORT_PARSER_VERSION, parseEstimateFileWithReport, requireImportApproval, SpreadsheetInputError } from '@/lib/spreadsheet'

export const runtime = 'nodejs'
export const maxDuration=300

export async function POST(request: Request) {
  try {
    const form = await request.formData();const file=form.get('estimateFile')
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Attach an .xlsx or .csv estimate.' }, { status: 400 })
    const projectDocs=form.getAll('projectDocuments').filter((value):value is File=>value instanceof File&&value.size>0)
    const reviewId=String(form.get('importReviewId')||'');const submittedReportHash=String(form.get('importReportHash')||'')
    if(!reviewId||!submittedReportHash)return NextResponse.json({error:'Preview this exact import before committing it.'},{status:409})
    const review=await getImportReviewRecord(reviewId)
    const reviewedSource=review.files.find(value=>value.role==='estimate'&&value.ordinal===0)
    if(!reviewedSource)throw new SpreadsheetInputError('Reviewed estimate source is missing.')
    const parsed=await parseEstimateFileWithReport(file,{worksheet:reviewedSource.worksheet??undefined})
    const analysis:ImportReviewAnalysis={parserVersion:IMPORT_PARSER_VERSION,importKind:'new_estimate',context:review.context,reports:[parsed.report],issues:parsed.report.issues}
    const submittedFiles=[{role:'estimate' as const,file},...projectDocs.map((document,ordinal)=>({role:'project_document' as const,ordinal,file:document}))]
    await verifyImportReviewContract({review,importKind:'new_estimate',submittedReportHash,files:submittedFiles,analysis})
    const reviewed=form.get('importReviewed')==='true';requireImportApproval(parsed.report.issues,reviewed)
    const acknowledged=warningAcknowledgements(parsed.report.issues,reviewed,false)
    if(review.status==='committed'&&review.resultEstimateId){const existing=await getEstimate(review.resultEstimateId);if(existing)return NextResponse.json({estimate:existing,warnings:[],idempotentReplay:true})}
    if(!parsed.lines.length)return NextResponse.json({error:'No usable estimate lines were found. Check the spreadsheet headers.'},{status:400})
    const baselineRole=(review.context.baselineRole??'original_bid') as EstimateBaselineRole
    const estimate: Estimate = {
      id:id(),name:String(form.get('name')||file.name.replace(/\.(xlsx|csv)$/i,'')),projectType:String(form.get('projectType')||'Office retrofit'),customerType:String(form.get('customerType')||'Commercial'),location:String(form.get('location')||''),bidDue:String(form.get('bidDue')||'')||undefined,
      tags:String(form.get('tags')||'').split(',').map(value=>value.trim()).filter(Boolean),assumptions:String(form.get('assumptions')||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean),lines:parsed.lines,estimatedTotal:sumEstimate(parsed.lines),estimatedLaborHours:estimateLaborHours(parsed.lines),createdAt:new Date().toISOString(),status:'draft',investigationStatus:'queued',lifecycleStatus:'draft',findings:[],submittedFindingIds:[],findingOutcomes:[],questions:[],baselineRole,
    }
    const reportHash=hashImportAnalysis(analysis)
    await commitReviewedEstimate({reviewId,reportHash,acknowledged,estimate,provenance:spreadsheetProvenance(parsed.provenance,'estimate'),parentEstimateId:review.context.parentEstimateId??undefined,baselineRole})
    const preflight=await runPreflight(estimate.id)
    return NextResponse.json({estimate:preflight,warnings:[]})
  }catch(error){
    if(error instanceof InvestigationAlreadyRunningError)return NextResponse.json({error:error.message},{status:409})
    console.error(error);return NextResponse.json({error:error instanceof Error?error.message:'Could not review estimate.'},{status:error instanceof SpreadsheetInputError?400:error instanceof ImportReviewError?409:500})
  }
}
