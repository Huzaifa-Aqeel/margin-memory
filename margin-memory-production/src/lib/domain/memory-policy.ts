import { createHash } from 'node:crypto'
import { comparisonVariances, hasReconciledScope } from './scope'
import type { Estimate, Job, Lesson } from './types'

export const JOB_MEMORY_CONTENT_VERSION = 'job-memory-v2'
export const LESSON_MEMORY_CONTENT_VERSION = 'lesson-memory-v2'

export function jobMemoryExclusionReasons(job: Pick<Job, 'scopeReview' | 'estimateBaselineRole' | 'dataOrigin' | 'memoryStatus'>) {
  const reasons:string[]=[]
  if(!hasReconciledScope(job))reasons.push('scope_or_actuals_unreconciled')
  if(job.estimateBaselineRole!=='original_bid'&&job.estimateBaselineRole!=='final_submitted')reasons.push('authoritative_baseline_unknown')
  if(job.dataOrigin!=='production')reasons.push('non_production_origin')
  if(job.memoryStatus!=='trusted')reasons.push('job_quarantined')
  return reasons
}
export function isJobEligibleForTrustedMemory(job: Pick<Job, 'scopeReview' | 'estimateBaselineRole' | 'dataOrigin' | 'memoryStatus'>) {
  return jobMemoryExclusionReasons(job).length===0
}

export function isLessonEligibleForTrustedMemory(lesson: Pick<Lesson, 'status'>, job: Pick<Job, 'scopeReview' | 'estimateBaselineRole' | 'dataOrigin' | 'memoryStatus'> | undefined) {
  return lesson.status === 'confirmed' && Boolean(job && isJobEligibleForTrustedMemory(job))
}

export function memoryContentHash(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

const round = (value: number) => Math.round(value * 1000) / 1000
const normalizedValues = (values: Array<string | undefined>) => [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
const amountBand = (amount: number) => {
  const limits = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000]
  const upper = limits.find(limit => amount <= limit)
  return upper ? `up-to-${upper}` : 'over-10000000'
}
const conditions = (notes: string) => notes
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
  .replace(/\+?\d[\d().\s-]{7,}\d/g, '[phone]')
  .split(/(?<=[.!?])\s+|\n+/)
  .map(value => value.trim())
  .filter(value => /access|occupied|shutdown|after.?hours|pathway|conduit|riser|ceiling|drawings|fixture|supplier|quote|permit|utility|coordination|rework|weather|productiv/i.test(value))
  .slice(0, 3).join(' ').slice(0, 800)

export function canonicalJobMemoryContent(job: Job) {
  if (!isJobEligibleForTrustedMemory(job)) throw new Error('Job is not eligible for trusted memory')
  const estimated = Math.max(job.estimatedTotal, 0)
  const categories = normalizedValues(job.estimateLines.map(line => line.category)).map(category => {
    const amount = job.estimateLines.filter(line => line.category === category).reduce((sum, line) => sum + line.estimatedCost, 0)
    return `${category}:${estimated > 0 ? round(amount / estimated) : 'unavailable'}`
  })
  const laborEstimate = job.estimateLines.filter(line => line.category === 'labor')
  const laborActual = job.actualLines.filter(line => line.category === 'labor')
  const laborCost = laborEstimate.reduce((sum, line) => sum + line.estimatedCost, 0)
  const laborHours = laborEstimate.reduce((sum, line) => sum + (line.estimatedHours ?? 0), 0)
  const actualLaborHours = laborActual.reduce((sum, line) => sum + (line.actualHours ?? 0), 0)
  const variance = comparisonVariances(job).map(value => `${value.category}:cost=${value.costDeltaPct === null ? 'unavailable' : round(value.costDeltaPct)},hours=${value.hoursDeltaPct === null ? 'unavailable' : round(value.hoursDeltaPct)}`)
  return [
    `Version: ${JOB_MEMORY_CONTENT_VERSION}`,
    `Project type: ${job.projectType.trim()}`,
    `Commercial class: ${job.customerType.trim()}`,
    `Size band: ${amountBand(estimated)}`,
    `Tags: ${normalizedValues(job.tags).join(', ') || 'unavailable'}`,
    `Categories: ${categories.join(', ') || 'unavailable'}`,
    `Labor share: ${estimated > 0 ? round(laborCost / estimated) : 'unavailable'}`,
    `Labor hours estimate/actual: ${laborHours || 'unavailable'}/${actualLaborHours || 'unavailable'}`,
    `Cost codes: ${normalizedValues([...job.estimateLines, ...job.actualLines].map(line => line.costCode)).join(', ') || 'unavailable'}`,
    `Phases: ${normalizedValues([...job.estimateLines, ...job.actualLines].map(line => line.phase)).join(', ') || 'unavailable'}`,
    `Divisions: ${normalizedValues([...job.estimateLines, ...job.actualLines].map(line => line.division)).join(', ') || 'unavailable'}`,
    `Completion year: ${job.completedAt.slice(0, 4)}`,
    `Baseline: ${job.estimateBaselineRole}`,
    `Verified variance: ${variance.join('; ') || 'unavailable'}`,
    `Relevant closeout conditions: ${conditions(job.notes) || 'unavailable'}`,
  ].join('\n')
}

export function canonicalLessonMemoryContent(lesson: Pick<Lesson, 'title' | 'category' | 'lesson' | 'cause' | 'impactSummary'>) {
  return [
    `Version: ${LESSON_MEMORY_CONTENT_VERSION}`,
    `Title: ${lesson.title.trim()}`,
    `Category: ${lesson.category}`,
    `Lesson: ${lesson.lesson.trim()}`,
    `Cause: ${lesson.cause.trim()}`,
    `Impact: ${lesson.impactSummary.trim()}`,
  ].join('\n')
}

export type ComparabilityAssessment = {
  jobId: string
  eligible: boolean
  score: number
  matched: string[]
  unavailable: string[]
  rejected: string[]
}

function projectClass(value: string) {
  const text = value.toLowerCase()
  if (/tenant|office.*(fit|retrofit)|commercial.*renov/.test(text)) return 'tenant_fit_out'
  if (/warehouse/.test(text)) return 'warehouse'
  if (/retail/.test(text)) return 'retail'
  if (/multi.?family|apartment/.test(text)) return 'multifamily'
  if (/restaurant|kitchen/.test(text)) return 'restaurant'
  return text.trim() || 'unknown'
}
const setOf = (values: Array<string | undefined>) => new Set(normalizedValues(values).map(value => value.toLowerCase()))
const overlap = (left: Set<string>, right: Set<string>) => left.size && right.size ? [...left].filter(value => right.has(value)).length / Math.min(left.size, right.size) : null

export function assessProfessionalComparability(job: Job, estimate: Estimate): ComparabilityAssessment {
  const matched: string[] = [], unavailable: string[] = [], rejected: string[] = []
  if (!isJobEligibleForTrustedMemory(job)) rejected.push('job_not_trusted')
  const jobClass = projectClass(job.projectType), estimateClass = projectClass(estimate.projectType)
  if (jobClass === estimateClass) matched.push('project_class')
  else rejected.push('project_class_mismatch')
  if (job.customerType && estimate.customerType) {
    if (job.customerType.toLowerCase() === estimate.customerType.toLowerCase()) matched.push('commercial_class')
    else rejected.push('commercial_class_mismatch')
  } else unavailable.push('commercial_class')
  const sizeRatio = Math.max(job.estimatedTotal, estimate.estimatedTotal, 1) / Math.max(Math.min(job.estimatedTotal, estimate.estimatedTotal), 1)
  if (sizeRatio <= 4) matched.push('size_band'); else rejected.push('size_mismatch')
  const jobCategories = setOf(job.estimateLines.map(line => line.category)), estimateCategories = setOf(estimate.lines.map(line => line.category))
  const categoryOverlap = overlap(jobCategories, estimateCategories)
  if (categoryOverlap === null) unavailable.push('category_mix')
  else if (categoryOverlap >= 0.5) matched.push('category_mix')
  else rejected.push('category_mix_mismatch')
  const jobLaborShare = job.estimatedTotal > 0 ? job.estimateLines.filter(line => line.category === 'labor').reduce((sum, line) => sum + line.estimatedCost, 0) / job.estimatedTotal : null
  const estimateLaborShare = estimate.estimatedTotal > 0 ? estimate.lines.filter(line => line.category === 'labor').reduce((sum, line) => sum + line.estimatedCost, 0) / estimate.estimatedTotal : null
  if (jobLaborShare === null || estimateLaborShare === null || (!jobLaborShare && !estimateLaborShare)) unavailable.push('labor_mix')
  else if (Math.abs(jobLaborShare - estimateLaborShare) <= 0.25) matched.push('labor_mix')
  else rejected.push('labor_mix_mismatch')
  const jobCodes = setOf(job.estimateLines.map(line => line.costCode)), estimateCodes = setOf(estimate.lines.map(line => line.costCode))
  const codeOverlap = overlap(jobCodes, estimateCodes)
  if (codeOverlap === null) unavailable.push('cost_codes'); else if (codeOverlap > 0) matched.push('cost_codes'); else rejected.push('cost_code_mismatch')
  const jobPhases = setOf(job.estimateLines.map(line => line.phase)), estimatePhases = setOf(estimate.lines.map(line => line.phase)
  )
  const phaseOverlap = overlap(jobPhases, estimatePhases)
  if (phaseOverlap === null) unavailable.push('phases'); else if (phaseOverlap > 0) matched.push('phases'); else rejected.push('phase_mismatch')
  const divisionOverlap=overlap(setOf(job.estimateLines.map(line=>line.division)),setOf(estimate.lines.map(line=>line.division)))
  if(divisionOverlap===null)unavailable.push('divisions');else if(divisionOverlap>0)matched.push('divisions');else rejected.push('division_mismatch')
  const estimateDate = new Date(estimate.createdAt), jobDate = new Date(job.completedAt)
  if (Number.isNaN(estimateDate.valueOf()) || Number.isNaN(jobDate.valueOf())) unavailable.push('job_age')
  else if ((estimateDate.valueOf() - jobDate.valueOf()) / 31_557_600_000 <= 7) matched.push('job_age')
  else rejected.push('job_too_old')
  const hardReject = rejected.some(reason => ['job_not_trusted', 'project_class_mismatch', 'commercial_class_mismatch', 'size_mismatch', 'category_mix_mismatch', 'cost_code_mismatch', 'phase_mismatch', 'division_mismatch', 'job_too_old'].includes(reason))
  const score = hardReject ? 0 : round(Math.min(1, 0.35 + matched.length * 0.1 - unavailable.length * 0.02))
  return { jobId: job.id, eligible: !hardReject && score >= 0.55, score, matched, unavailable, rejected }
}
