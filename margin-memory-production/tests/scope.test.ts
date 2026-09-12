import { expect, it } from 'vitest'
import { calculateScopeComparison, jobScopeComparison, parseScopeReview, scopeReviewSchema, type ScopeChange, type ScopeReview } from '../src/lib/domain/scope'
import { calculateVariances } from '../src/lib/domain/analytics'
import type { Job } from '../src/lib/domain/types'
import { calculateRisk } from '../src/lib/agent/provenance'
import { evaluateFindingOutcomes, proposeCloseoutLessons } from '../src/lib/closeout'
import { seedStore } from '../src/lib/seed'
import { deterministicPreflight } from '../src/lib/agent/deterministic'
import { EvidenceLedger } from '../src/lib/agent/provenance'
import { jobSearchText } from '../src/lib/embeddings'

const change: ScopeChange = { reference: 'CO-1 signed 2026-01-02', description: 'Additional circuits', category: 'labor', estimatedCost: 50, estimatedHours: 5, actualCost: 50, actualHours: 5 }
const adjusted: ScopeReview = { status: 'adjusted', changes: [change], actualCompleteness:'confirmed_complete' }
const noChanges: ScopeReview = { status: 'no_changes', changes: [], actualCompleteness:'confirmed_complete' }
const unknown: ScopeReview = { status: 'unreconciled', changes: [], actualCompleteness:'unknown' }
export function scopeJob(review: ScopeReview | undefined = adjusted, actualCost = 150, actualHours = 15): Job {
  const estimateLines = [{ id: 'estimate', category: 'labor' as const, description: 'Original circuits', estimatedCost: 100, estimatedHours: 10 }]
  const actualLines = [{ id: 'actual', category: 'labor' as const, description: 'All circuits', actualCost, actualHours }]
  return { ...seedStore.jobs[0], id: crypto.randomUUID(), estimateLines, actualLines, estimatedTotal: 100, actualTotal: actualCost,
    variances: calculateVariances(estimateLines, actualLines), scopeReview: review }
}

it('approved additions produce zero adjusted variance and preserve original facts and actual allocations', () => {
  const job = scopeJob(); const before = structuredClone(job)
  expect(jobScopeComparison(job)).toMatchObject({ adjustedTotal: 150, actualTotal: 150, originalScopeActualTotal: 100, changeActualTotal: 50, costDeltaPct: 0,
    variances: [{ estimatedCost: 150, actualCost: 150, estimatedHours: 15, actualHours: 15, costDelta: 0, hoursDelta: 0 }] })
  expect(job).toEqual(before); expect(job.variances[0].costDelta).toBe(50)
  expect(calculateRisk([job], 'labor')).toMatchObject({ sampleSize: 1, overrunCount: 0, medianVariancePct: 0 })
  expect(proposeCloseoutLessons(job)).toEqual([])
})
it('retains real overruns beyond approved scope in lessons and deterministic risk', () => {
  const job = scopeJob(adjusted, 180, 18)
  expect(jobScopeComparison(job)?.costDeltaPct).toBe(0.2)
  expect(calculateRisk([job], 'labor').medianVariancePct).toBe(0.2)
  expect(proposeCloseoutLessons(job)).toHaveLength(1)
})
it('supports deductive approved budgets without rewriting the original bid', () => {
  const job = scopeJob({ status: 'adjusted', actualCompleteness:'confirmed_complete', changes: [{ ...change, estimatedCost: -50, estimatedHours: -5, actualCost: 0, actualHours: 0 }] }, 50, 5)
  expect(jobScopeComparison(job)).toMatchObject({ adjustedTotal: 50, costDeltaPct: 0 })
  expect(job.estimatedTotal).toBe(100)
})
it('sums multiple changes by category and keeps category allocations separate', () => {
  const job = scopeJob({ status: 'adjusted', actualCompleteness:'confirmed_complete', changes: [change, { ...change, reference: 'CO-2', category: 'materials', estimatedCost: 20, estimatedHours: 0, actualCost: 20, actualHours: 0 }] })
  job.actualLines.push({ id: 'm', category: 'materials', description: 'Added material', actualCost: 20 })
  expect(jobScopeComparison(job)).toMatchObject({ adjustedTotal: 170, actualTotal: 170, costDeltaPct: 0 })
  expect(jobScopeComparison(job)?.variances).toHaveLength(2)
})
it('no-change assessment retains the existing comparison', () => {
  const job = scopeJob(noChanges, 125, 12)
  expect(jobScopeComparison(job)?.variances).toEqual(job.variances)
})
it.each([unknown, undefined])('unreconciled or legacy scope cannot become numerical evidence or lessons: %j', (scope) => {
  const job = scopeJob(); job.scopeReview = scope
  expect(jobScopeComparison(job)).toBeNull()
  expect(proposeCloseoutLessons(job)).toEqual([])
  expect(() => calculateRisk([job], 'labor')).toThrow('trusted memory')
  expect(() => jobSearchText(job)).toThrow('eligible for trusted memory')
  const estimate = { ...seedStore.estimates[0], submittedFindingIds: seedStore.estimates[0].findings.map(f => f.id) }
  expect(evaluateFindingOutcomes(estimate, job).every(o => o.systemVerdict === 'not_evaluable')).toBe(true)
})
it('deterministic retrieval excludes unknown scope without blocking usable history', async () => {
  const job = scopeJob(unknown)
  const ledger = new EvidenceLedger(crypto.randomUUID(), async () => {})
  await deterministicPreflight({ ...seedStore, jobs: [job] }, seedStore.estimates[0], ledger)
  expect(ledger.all()[0]).toMatchObject({ kind: 'search', result: { jobIds: [] } })
})
it.each([
  { ...change, actualCost: 151 }, { ...change, actualHours: 16 },
  { ...change, estimatedCost: -101 }, { ...change, estimatedHours: -11 },
  { ...change, category: 'materials' as const },
])('rejects scope allocation exceeding category budget or actuals: %j', c => {
    const job = scopeJob({ status: 'adjusted', actualCompleteness:'confirmed_complete', changes: [c] })
  expect(() => jobScopeComparison(job)).toThrow(/exceed/)
})
it.each([
  { ...change, reference: ' ' }, { ...change, description: '' }, { ...change, estimatedCost: Infinity },
  { ...change, actualCost: -1 }, { ...change, estimatedHours: NaN }, { ...change, estimatedCost: 0.001 },
  { ...change, approvedByAgent: true }, { ...change, estimatedCost: '50' },
])('rejects malformed changes: %j', c => {
  expect(() => scopeReviewSchema.parse({ status: 'adjusted', changes: [c] })).toThrow()
})
it('requires explicit assessment consistency and rejects malformed form values', () => {
  expect(parseScopeReview(null)).toEqual(unknown)
  expect(() => parseScopeReview('//invalid')).toThrow()
  expect(() => scopeReviewSchema.parse({ status: 'no_changes', changes: [change] })).toThrow()
  expect(() => scopeReviewSchema.parse({ status: 'adjusted', changes: [] })).toThrow()
  expect(() => scopeReviewSchema.parse({ status: 'unreconciled', changes: [change] })).toThrow()
  expect(() => scopeReviewSchema.parse({ status: 'adjusted', changes: [change, { ...change, reference: change.reference.toUpperCase() }] })).toThrow('one row')
})
it('rounds decimal additions before calculating adjusted variance', () => {
  const estimate = [{ id: 'a', category: 'labor' as const, description: 'Labor', estimatedCost: 0.1 }]
  const actual = [{ id: 'b', category: 'labor' as const, description: 'Labor', actualCost: 0.3 }]
  expect(calculateScopeComparison(estimate, actual, { status: 'adjusted', actualCompleteness:'confirmed_complete', changes: [{ ...change, estimatedCost: 0.2, estimatedHours: 0, actualCost: 0.2, actualHours: 0 }] })?.costDeltaPct).toBe(0)
})
