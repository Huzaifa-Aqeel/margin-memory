import { z } from 'zod'
import type { Estimate, Finding, HumanQuestion } from '@/lib/domain/types'
import type { ImportIssue, SpreadsheetImportReport } from '@/lib/spreadsheet'

const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])

export const excelEstimateProfileSchema = z.strictObject({
  name: z.string().trim().min(1).max(240),
  projectType: z.string().trim().min(1).max(160),
  customerType: z.string().trim().min(1).max(160),
  location: z.string().trim().max(240),
  bidDue: optionalDate.optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  assumptions: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
})

export type ExcelEstimateProfile = z.infer<typeof excelEstimateProfileSchema>

export function parseExcelEstimateProfile(input: unknown): ExcelEstimateProfile {
  const profile = excelEstimateProfileSchema.parse(input)
  return {
    ...profile,
    bidDue: profile.bidDue || null,
    tags: [...new Set(profile.tags)].sort((left, right) => left.localeCompare(right)),
    assumptions: [...new Set(profile.assumptions)],
  }
}

export type ExcelPreviewResponse = {
  source: {
    sourceType: 'excel_live_snapshot'
    snapshotHash: string
    sourceIdentityHash: string
    adapterVersion: string
    workbookName: string
    worksheetName: string
    selectionAddress: string
    capturedAt: string
  }
  report: SpreadsheetImportReport
  issues: ImportIssue[]
  review?: { id: string; reportHash: string; expiresAt: string }
  runId: string
  requiresReview: boolean
  canImport: boolean
}

export type ExcelFindingPresentation = {
  id: string
  severity: Finding['severity']
  title: string
  fact: string
  interpretation: string
  action: string
  evidence: Finding['evidence']
}

export type ExcelEstimatePresentation = {
  estimateId: string
  revisionNumber: number
  lifecycleStatus: Estimate['lifecycleStatus']
  investigationStatus: Estimate['investigationStatus']
  summary?: string
  findings: ExcelFindingPresentation[]
  questions: HumanQuestion[]
  result: 'running' | 'needs_input' | 'findings' | 'no_findings' | 'failed'
  fullReviewUrl: string
}

export function presentExcelEstimate(estimate: Estimate): ExcelEstimatePresentation {
  const questions = estimate.questions.filter(question => !question.answer)
  const findings = estimate.findings.slice(0, 3).map(finding => ({
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    fact: finding.claim,
    interpretation: finding.rationale,
    action: finding.recommendation,
    evidence: finding.evidence,
  }))
  const result: ExcelEstimatePresentation['result'] = estimate.investigationStatus === 'failed'
    ? 'failed'
    : questions.length || estimate.investigationStatus === 'needs_input'
      ? 'needs_input'
      : estimate.investigationStatus === 'completed'
        ? findings.length ? 'findings' : 'no_findings'
        : 'running'
  return {
    estimateId: estimate.id,
    revisionNumber: estimate.revisionNumber ?? 0,
    lifecycleStatus: estimate.lifecycleStatus,
    investigationStatus: estimate.investigationStatus,
    summary: estimate.agentSummary,
    findings,
    questions,
    result,
    fullReviewUrl: `/estimates/${estimate.id}`,
  }
}
