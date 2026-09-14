import 'server-only'

import { createHash } from 'node:crypto'
import type { ImportIssue, ImportPairReport, NormalizedLineProvenance, SpreadsheetImportReport } from '@/lib/spreadsheet'
import type { SpreadsheetSourceType } from '@/lib/integrations/excel-snapshot'

export type ImportKind = 'new_estimate' | 'historical_job' | 'closeout_actual'
export type ImportFileRole = 'estimate' | 'actuals' | 'notes' | 'project_document'
export type EstimateBaselineRole = 'original_bid' | 'revision' | 'final_submitted' | 'historical_unknown'

export type ImportReviewAnalysis = {
  parserVersion: string
  importKind: ImportKind
  context: Record<string, string | null>
  reports: SpreadsheetImportReport[]
  issues: ImportIssue[]
  completeness?: ImportPairReport['completeness']
}

export type StagedImportFile = {
  id: string
  role: ImportFileRole
  ordinal: number
  fileName: string
  storagePath: string
  mimeType: string
  sizeBytes: number
  sha256: string
  extractedText: string
  worksheet: string | null
  sourceType?: SpreadsheetSourceType
  sourceAdapterVersion?: string
  sourceMetadata?: Record<string, unknown>
  canonicalSnapshotHash?: string
  sourceCapturedAt?: string
}

export type ImportLineProvenanceInput = NormalizedLineProvenance & { fileRole: 'estimate' | 'actuals' }

export type ImportReviewRecord = {
  id: string
  organizationId: string
  userId: string
  importKind: ImportKind
  parserVersion: string
  reportHash: string
  context: Record<string, string | null>
  reports: SpreadsheetImportReport[]
  issues: ImportIssue[]
  completeness?: ImportPairReport['completeness']
  status: 'staged' | 'committed' | 'expired' | 'cleaned'
  expiresAt: string
  resultEstimateId?: string
  resultJobId?: string
  files: StagedImportFile[]
}
export class ImportReviewError extends Error {}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item=>stable(item===undefined?null:item)).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).filter(key=>object[key]!==undefined).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`
}

export function sha256Bytes(bytes: ArrayBuffer | Uint8Array) {
  return createHash('sha256').update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).digest('hex')
}

export function hashImportAnalysis(analysis: ImportReviewAnalysis) {
  // Selection rationale is explanatory copy and differs when an automatic
  // single-sheet decision is replayed explicitly at commit. Material fields
  // (selected sheet, mapping, rows, totals, issues and completeness) remain bound.
  const reports=analysis.reports.map(report=>({...report,worksheetSelectionRationale:''}))
  return createHash('sha256').update(stable({...analysis,reports})).digest('hex')
}

export function warningAcknowledgements(issues: ImportIssue[], reviewed: boolean, actualComplete: boolean) {
  const warnings = [...new Set(issues.filter(issue => issue.severity === 'warning').map(issue => issue.code))].sort()
  if (!reviewed && warnings.some(code => code !== 'actual_completeness_confirmation')) return []
  return warnings.filter(code => code !== 'actual_completeness_confirmation' || actualComplete)
}

export function spreadsheetProvenance(provenance: NormalizedLineProvenance[], fileRole: 'estimate' | 'actuals'): ImportLineProvenanceInput[] {
  return provenance.map(value => ({ ...value, fileRole }))
}

export async function verifyImportReviewContract(args:{review:ImportReviewRecord;importKind:ImportKind;submittedReportHash:string;files:Array<{role:ImportFileRole;ordinal?:number;file:File}>;analysis:ImportReviewAnalysis}){
 if(args.review.importKind!==args.importKind)throw new ImportReviewError('Import review is for a different operation.')
 if(args.review.parserVersion!==args.analysis.parserVersion)throw new ImportReviewError('The import parser changed after preview. Preview the files again.')
 if(args.review.reportHash!==args.submittedReportHash||args.review.reportHash!==hashImportAnalysis(args.analysis))throw new ImportReviewError('The committed interpretation does not match the reviewed preview.')
 if(args.review.status!=='staged'&&args.review.status!=='committed')throw new ImportReviewError('Import review is no longer available.')
 if(args.review.status==='staged'&&new Date(args.review.expiresAt).getTime()<=Date.now())throw new ImportReviewError('Import review expired. Preview the files again.')
 if(args.files.length!==args.review.files.length)throw new ImportReviewError('The committed files do not match the reviewed files.')
 for(const submitted of args.files){
  const ordinal=submitted.ordinal??0;const reviewed=args.review.files.find(file=>file.role===submitted.role&&file.ordinal===ordinal)
  if(!reviewed)throw new ImportReviewError(`No reviewed ${submitted.role} file matches this request.`)
  const bytes=await submitted.file.arrayBuffer()
  if(reviewed.sha256!==sha256Bytes(bytes)||reviewed.sizeBytes!==submitted.file.size||reviewed.fileName!==submitted.file.name)throw new ImportReviewError(`The ${submitted.role} file changed after preview. Preview the current file before importing.`)
 }
}
