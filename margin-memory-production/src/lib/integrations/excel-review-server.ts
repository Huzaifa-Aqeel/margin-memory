import 'server-only'

import { createHash } from 'node:crypto'
import { hashImportAnalysis, ImportReviewError, type ImportReviewAnalysis, type ImportReviewRecord } from '@/lib/import-contract'
import { IMPORT_PARSER_VERSION, parseEstimateExcelSnapshotWithReport } from '@/lib/spreadsheet'
import { analyzeExcelSnapshotIdentity } from './excel-snapshot-server'
import { parseExcelEstimateProfile, type ExcelEstimateProfile } from './excel-contract'

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export function canonicalExcelProfile(input: unknown) {
  const profile = parseExcelEstimateProfile(input)
  return { profile, canonical: JSON.stringify(profile), profileHash: hash(JSON.stringify(profile)) }
}

export async function analyzeExcelReview(input: { snapshot: unknown; profile: unknown; parentEstimateId?: string | null; reviewedCapturedAt?:string }) {
  const source = analyzeExcelSnapshotIdentity(input.snapshot)
  const parsed = await parseEstimateExcelSnapshotWithReport(source.snapshot)
  const profile = canonicalExcelProfile(input.profile)
  const context: ImportReviewAnalysis['context'] = {
    sourceType: 'excel_live_snapshot',
    sourceIdentityHash: source.sourceIdentityHash,
    snapshotHash: source.snapshotHash,
    sourceAdapterVersion: source.snapshot.adapterVersion,
    sourceCapturedAt: input.reviewedCapturedAt??source.snapshot.capturedAt,
    profile: profile.canonical,
    profileHash: profile.profileHash,
    parentEstimateId: input.parentEstimateId ?? null,
    baselineRole: input.parentEstimateId ? 'revision' : 'original_bid',
  }
  const analysis: ImportReviewAnalysis = {
    parserVersion: IMPORT_PARSER_VERSION,
    importKind: 'new_estimate',
    context,
    reports: [parsed.report],
    issues: parsed.report.issues,
  }
  return { source, parsed, profile: profile.profile, analysis, reportHash: hashImportAnalysis(analysis) }
}

export async function verifyExcelReviewContract(args: {
  review: ImportReviewRecord
  snapshot: unknown
  submittedReportHash: string
}) {
  const sourceFile = args.review.files.find(file => file.role === 'estimate' && file.ordinal === 0)
  if (!sourceFile || sourceFile.sourceType !== 'excel_live_snapshot') throw new ImportReviewError('This review is not an Excel live snapshot review.')
  const profile = JSON.parse(args.review.context.profile ?? 'null') as ExcelEstimateProfile
  const current = await analyzeExcelReview({
    snapshot: args.snapshot,
    profile,
    parentEstimateId: args.review.context.parentEstimateId,
    reviewedCapturedAt: args.review.context.sourceCapturedAt??undefined,
  })
  if (args.review.importKind !== 'new_estimate' || args.review.parserVersion !== IMPORT_PARSER_VERSION) throw new ImportReviewError('The import parser changed after preview. Refresh the Excel analysis.')
  if (args.review.status !== 'staged' && args.review.status !== 'committed') throw new ImportReviewError('This Excel review is no longer available.')
  if (args.review.status === 'staged' && new Date(args.review.expiresAt).getTime() <= Date.now()) throw new ImportReviewError('This Excel review expired. Run Margin Check again.')
  if (sourceFile.canonicalSnapshotHash !== current.source.snapshotHash || args.review.context.snapshotHash !== current.source.snapshotHash) throw new ImportReviewError('The selected Excel source changed after review. Refresh the analysis before running Margin Check.')
  if (sourceFile.sourceMetadata?.sourceIdentityHash !== current.source.sourceIdentityHash || args.review.context.sourceIdentityHash !== current.source.sourceIdentityHash) throw new ImportReviewError('The Excel workbook or selected source changed after review.')
  if (args.review.reportHash !== args.submittedReportHash || args.review.reportHash !== current.reportHash) throw new ImportReviewError('The current Excel interpretation does not match the reviewed preview.')
  return current
}
