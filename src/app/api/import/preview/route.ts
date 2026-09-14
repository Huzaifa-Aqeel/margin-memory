import { NextResponse } from 'next/server'
import { extractDocumentText, removeStagedImportFiles, stageImportFiles } from '@/lib/documents'
import { hashImportAnalysis, type EstimateBaselineRole, type ImportKind, type ImportReviewAnalysis } from '@/lib/import-contract'
import { cleanupExpiredImportReviews, createImportReviewRecord, getAuthenticatedSupabase, getEstimate } from '@/lib/repository/store'
import { inferHistoricalImportMetadata } from '@/lib/historical-import-metadata'
import { assessActualAgainstEstimate, assessImportPair, IMPORT_PARSER_VERSION, IMPORT_RESOURCE_LIMITS, parseActualFileWithReport, parseEstimateFileWithReport, parseImportMappingSelection, type SpreadsheetImportReport } from '@/lib/spreadsheet'

export const runtime = 'nodejs'

const baselineRoles=new Set<EstimateBaselineRole>(['original_bid','revision','final_submitted','historical_unknown'])

export async function POST(request: Request) {
  try {
    const auth=await getAuthenticatedSupabase()
    await cleanupExpiredImportReviews().catch(error=>console.warn('Expired import cleanup deferred:',error))
    const form = await request.formData()
    const mode = String(form.get('mode') || '')
    const estimateFile = form.get('estimateFile')
    const actualFile = form.get('actualFile')
    if (!['estimate', 'actual', 'pair'].includes(mode)) return NextResponse.json({ error: 'Invalid preview mode.' }, { status: 400 })
    if(mode==='pair'&&form.get('estimateBaselineConfirmed')!=='true')return NextResponse.json({error:'Confirm what the estimate file represents before analysis.'},{status:400})
    const required = mode === 'estimate' ? [estimateFile] : mode === 'actual' ? [actualFile] : [estimateFile, actualFile]
    if (required.some((file) => !(file instanceof File) || !file.size)) return NextResponse.json({ error: 'Attach the required spreadsheet files before previewing.' }, { status: 400 })
    const projectDocuments=form.getAll('projectDocuments').filter((value):value is File=>value instanceof File&&value.size>0)
    const notesFile=form.get('notesFile');const auxiliary=[...projectDocuments,...(notesFile instanceof File&&notesFile.size?[notesFile]:[])]
    if(projectDocuments.length>5)return NextResponse.json({error:'Attach at most 5 project documents.'},{status:400})
    if ([...required,...auxiliary].some((file) => file instanceof File && file.size > IMPORT_RESOURCE_LIMITS.fileBytes)) return NextResponse.json({ error: 'Each uploaded file must be 25 MB or smaller.' }, { status: 413 })

    const estimateWorksheet=String(form.get('estimateWorksheet')||'')||undefined
    const actualWorksheet=String(form.get('actualWorksheet')||'')||undefined
    const estimateMapping=parseImportMappingSelection(form.get('estimateMapping'))
    const actualMapping=parseImportMappingSelection(form.get('actualMapping'))
    const estimate = estimateFile instanceof File && estimateFile.size ? await parseEstimateFileWithReport(estimateFile,{worksheet:estimateWorksheet,mapping:estimateMapping}) : undefined
    const actual = actualFile instanceof File && actualFile.size ? await parseActualFileWithReport(actualFile,{worksheet:actualWorksheet,mapping:actualMapping}) : undefined
    const estimateId = String(form.get('estimateId') || '')
    const savedEstimate = mode === 'actual' && estimateId ? await getEstimate(estimateId) : undefined
    if (mode === 'actual' && (!estimateId||!savedEstimate)) return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 })
    const pair = estimate && actual ? assessImportPair(estimate.report, actual.report) : savedEstimate && actual ? assessActualAgainstEstimate(savedEstimate.lines, actual.report) : undefined
    const reports = [estimate?.report, actual?.report].filter((report):report is SpreadsheetImportReport=>Boolean(report))
    const issues = pair?.issues ?? reports.flatMap(report => report.issues)
    const canImport=!issues.some(issue=>issue.severity==='error')
    const importKind:ImportKind=mode==='estimate'?'new_estimate':mode==='pair'?'historical_job':'closeout_actual'
    const rawBaseline=String(form.get(mode==='pair'?'estimateBaselineRole':'baselineRole')|| (mode==='pair'?'historical_unknown':'original_bid'))
    if(!baselineRoles.has(rawBaseline as EstimateBaselineRole))return NextResponse.json({error:'Choose a valid estimate baseline type.'},{status:400})
    const context:Record<string,string|null>=mode==='actual'?{estimateId}:mode==='estimate'?{parentEstimateId:String(form.get('parentEstimateId')||'')||null,baselineRole:rawBaseline}:{estimateBaselineRole:rawBaseline,estimateBaselineConfirmed:'true'}
    const analysis:ImportReviewAnalysis={parserVersion:IMPORT_PARSER_VERSION,importKind,context,reports,issues,completeness:pair?.completeness}
    let review:{id:string;reportHash:string;expiresAt:string}|undefined
    if(canImport){
      const reviewId=crypto.randomUUID();const expiresAt=new Date(Date.now()+2*60*60*1000).toISOString()
      const stagedInputs:Array<{role:'estimate'|'actuals'|'notes'|'project_document';ordinal?:number;file:File;worksheet?:string|null;extractedText?:string}>=[]
      if(estimateFile instanceof File&&estimateFile.size)stagedInputs.push({role:'estimate',file:estimateFile,worksheet:estimate?.report.sheetName??null,extractedText:''})
      if(actualFile instanceof File&&actualFile.size)stagedInputs.push({role:'actuals',file:actualFile,worksheet:actual?.report.sheetName??null,extractedText:''})
      for(const [ordinal,file]of projectDocuments.entries())stagedInputs.push({role:'project_document',ordinal,file,extractedText:await extractDocumentText(file)})
      if(notesFile instanceof File&&notesFile.size)stagedInputs.push({role:'notes',file:notesFile,extractedText:await extractDocumentText(notesFile)})
      const staged=await stageImportFiles({supabase:auth.supabase,organizationId:auth.organizationId,reviewId,pathScope:mode==='actual'?`${estimateId}/closeout`:undefined,files:stagedInputs})
      try{await createImportReviewRecord({id:reviewId,analysis,files:staged,expiresAt})}catch(error){await removeStagedImportFiles(auth.supabase,staged);throw error}
      review={id:reviewId,reportHash:hashImportAnalysis(analysis),expiresAt}
    }
    const metadataSuggestions=mode==='pair'&&estimateFile instanceof File&&actualFile instanceof File?inferHistoricalImportMetadata({estimateFileName:estimateFile.name,actualFileName:actualFile.name}):undefined
    return NextResponse.json({
      reports, issues, completeness: pair?.completeness,review,
      metadataSuggestions,
      requiresReview: issues.some(issue => issue.severity !== 'info'),
      requiresActualCompletenessConfirmation: pair?.completeness.state === 'complete',
      canImport,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not preview spreadsheet.' }, { status: 400 })
  }
}
