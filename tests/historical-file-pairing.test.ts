import { describe, expect, it } from 'vitest'
import { historicalFilePairScore, proposeHistoricalFilePairs } from '../src/lib/historical-file-pairing'

describe('historical file pairing', () => {
  it('matches shuffled estimate and actual files only from shared descriptive identity', () => {
    const estimates = [{ name: 'Baker Office - Final Estimate.csv' }, { name: 'Harbor Medical - Final Estimate.xlsx' }]
    const actuals = [{ name: 'Harbor Medical - Actuals 2026-08-30.xlsx' }, { name: 'Baker Office - Job Cost 2026-08-31.csv' }]
    expect(proposeHistoricalFilePairs(estimates, actuals)).toEqual([
      { estimateIndex: 0, actualIndex: 1, score: 1, confidence: 'confident' },
      { estimateIndex: 1, actualIndex: 0, score: 1, confidence: 'confident' },
    ])
  })

  it('does not guess when generic or ambiguous filenames provide no distinct job identity', () => {
    expect(historicalFilePairScore('estimate.csv', 'job-cost-export.csv')).toBe(0)
    const proposals = proposeHistoricalFilePairs(
      [{ name: 'Office A Estimate.csv' }, { name: 'Office B Estimate.csv' }],
      [{ name: 'Office Actuals.csv' }, { name: 'Office Costs.csv' }],
    )
    expect(proposals.every(proposal => proposal.confidence === 'unmatched' && proposal.actualIndex === undefined)).toBe(true)
  })
})
