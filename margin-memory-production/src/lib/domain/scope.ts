import { z } from 'zod'
import { calculateVariances, sumActual, sumEstimate } from './analytics'
import type { ActualLine, EstimateLine, Job } from './types'

export const costCategories = ['labor', 'materials', 'equipment', 'subcontractor', 'permit', 'other'] as const
export const actualCompletenessValues = ['confirmed_complete','unknown'] as const
const actualCompleteness = z.enum(actualCompletenessValues).optional()
const amount = z.number().finite().min(-1e12).max(1e12).multipleOf(0.01)
export const scopeChangeSchema = z.strictObject({
  reference: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  category: z.enum(costCategories),
  estimatedCost: amount,
  estimatedHours: amount,
  actualCost: amount.nonnegative(),
  actualHours: amount.nonnegative(),
})
export const scopeReviewSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unreconciled'), changes: z.array(scopeChangeSchema).length(0), actualCompleteness }),
  z.strictObject({ status: z.literal('no_changes'), changes: z.array(scopeChangeSchema).length(0), actualCompleteness }),
  z.strictObject({ status: z.literal('adjusted'), actualCompleteness, changes: z.array(scopeChangeSchema).min(1).max(100).refine(changes => {
    const keys = changes.map(c => `${c.reference.toLowerCase()}::${c.category}`)
    return new Set(keys).size === keys.length
  }, 'Use one row per approval reference and cost category.') }),
])
export type ScopeReview = z.infer<typeof scopeReviewSchema>
export type ScopeChange = z.infer<typeof scopeChangeSchema>
export const unknownScope: ScopeReview = { status: 'unreconciled', changes: [], actualCompleteness:'unknown' }
const round = (n: number) => Math.round(n * 100) / 100

export function parseScopeReview(value: FormDataEntryValue | null): ScopeReview {
  if (value === null || value === '') return { ...unknownScope, changes: [] }
  if (typeof value !== 'string') throw new Error('Scope review must be a form value.')
  return scopeReviewSchema.parse(JSON.parse(value))
}

export class ScopeInputError extends Error {}
export function validateScopeInput(value: FormDataEntryValue | null, estimate: EstimateLine[], actual: ActualLine[], actualCompletenessConfirmed=false) {
  try {
    const review = parseScopeReview(value)
    const completeReview={...review,actualCompleteness:'confirmed_complete' as const}
    calculateScopeComparison(estimate, actual, completeReview)
    return {...review,actualCompleteness:actualCompletenessConfirmed?'confirmed_complete' as const:'unknown' as const}
  } catch (error) {
    throw new ScopeInputError(error instanceof Error ? error.message : 'Invalid scope reconciliation.')
  }
}

export function hasReconciledScope(job: Pick<Job, 'scopeReview'>) {
  return job.scopeReview?.actualCompleteness === 'confirmed_complete' && (job.scopeReview.status === 'no_changes' || job.scopeReview.status === 'adjusted')
}

/** Budget changes are cost allowances, never the customer-facing change-order price.
 * Raw bid and actual lines are retained. The comparison covers the final approved scope.
 */
export function calculateScopeComparison(estimate: EstimateLine[], actual: ActualLine[], input: ScopeReview) {
  const review = scopeReviewSchema.parse(input)
  if (review.status === 'unreconciled' || review.actualCompleteness !== 'confirmed_complete') return null
  const baseline = [...estimate, ...review.changes.map((change, index) => ({
    id: `scope-${index}`, category: change.category, description: change.description,
    estimatedCost: change.estimatedCost, estimatedHours: change.estimatedHours,
  }))]
  const variances = calculateVariances(baseline, actual).map(v => {
    const changes = review.changes.filter(c => c.category === v.category)
    const allocatedCost = round(changes.reduce((sum, c) => sum + c.actualCost, 0))
    const allocatedHours = round(changes.reduce((sum, c) => sum + c.actualHours, 0))
    if (round(v.estimatedCost) < 0 || round(v.estimatedHours) < 0) throw new Error(`Scope changes exceed the original ${v.category} budget.`)
    if (allocatedCost > round(v.actualCost) || allocatedHours > round(v.actualHours)) throw new Error(`Scope actuals exceed the final ${v.category} actuals.`)
    return { ...v, estimatedCost: round(v.estimatedCost), estimatedHours: round(v.estimatedHours),
      costDelta: round(v.costDelta), hoursDelta: round(v.hoursDelta),
      costDeltaPct: round(v.estimatedCost) > 0 ? round(v.costDelta) / round(v.estimatedCost) : v.costDeltaPct,
      hoursDeltaPct: round(v.estimatedHours) > 0 ? round(v.hoursDelta) / round(v.estimatedHours) : v.hoursDeltaPct }
  })
  // Also validate an allocation in a category whose budget and actuals are both zero.
  for (const c of review.changes) {
    if (!variances.some(v => v.category === c.category) && (c.actualCost > 0 || c.actualHours > 0)) throw new Error(`Scope actuals exceed the final ${c.category} actuals.`)
  }
  const adjustedTotal = round(sumEstimate(baseline))
  const actualTotal = round(sumActual(actual))
  const changeActualTotal = round(review.changes.reduce((sum, c) => sum + c.actualCost, 0))
  return { variances, adjustedTotal, actualTotal, changeActualTotal,
    originalScopeActualTotal: round(actualTotal - changeActualTotal),
    costDeltaPct: adjustedTotal > 0 ? round(actualTotal - adjustedTotal) / adjustedTotal : actualTotal > 0 ? 1 : null }
}

export function jobScopeComparison(job: Pick<Job, 'estimateLines' | 'actualLines' | 'scopeReview'>) {
  return calculateScopeComparison(job.estimateLines, job.actualLines, job.scopeReview ?? unknownScope)
}

export function comparisonVariances(job: Pick<Job, 'estimateLines' | 'actualLines' | 'scopeReview'>) {
  return jobScopeComparison(job)?.variances ?? []
}
