import { describe, expect, it } from 'vitest'
import { inferHistoricalImportMetadata, parseHistoricalJobMetadata } from '../src/lib/historical-import-metadata'

describe('historical import metadata', () => {
  it('suggests shared job context without turning filenames into financial truth', () => {
    expect(inferHistoricalImportMetadata({
      estimateFileName: 'Baker Office Renovation - Final Estimate.csv',
      actualFileName: 'Baker Office Renovation - Actuals 2026-08-31.csv',
    })).toEqual({
      name: 'Baker Office Renovation',
      projectType: 'Office retrofit',
      customerType: 'Commercial',
      completedAt: '2026-08-31',
      estimateBaselineRole: 'final_submitted',
      tags: ['retrofit'],
    })
  })

  it('does not fabricate descriptive metadata from generic export names', () => {
    expect(inferHistoricalImportMetadata({ estimateFileName: 'estimate.csv', actualFileName: 'job-cost-export.csv' })).toEqual({
      estimateBaselineRole: 'historical_unknown', tags: [],
    })
  })

  it('recognizes only explicit, editable professional context', () => {
    expect(inferHistoricalImportMetadata({
      estimateFileName: 'City Hall - Original Bid.xlsx',
      actualFileName: 'City Hall - Job Cost - 2026_04_30.xlsx',
    })).toMatchObject({ name: 'City Hall', customerType: 'Public', completedAt: '2026-04-30', estimateBaselineRole: 'original_bid' })
  })

  it('rejects missing or invalid required metadata rather than inserting server defaults', () => {
    expect(() => parseHistoricalJobMetadata({ name: '', projectType: '', customerType: '', completedAt: '' })).toThrow('Job name')
    expect(() => parseHistoricalJobMetadata({ name: 'Baker Office', projectType: 'Office retrofit', customerType: 'Commercial', completedAt: '08/31/2026' })).toThrow('completion date')
  })

  it('normalizes optional metadata supplied after review', () => {
    expect(parseHistoricalJobMetadata({ name: '  Baker Office  ', projectType: 'Office retrofit', customerType: 'Commercial', completedAt: '2026-08-31', location: ' Philadelphia, PA ', tags: 'occupied, retrofit, occupied', notes: '  Access was limited. ' })).toEqual({
      name: 'Baker Office', projectType: 'Office retrofit', customerType: 'Commercial', completedAt: '2026-08-31', location: 'Philadelphia, PA', tags: ['occupied', 'retrofit'], notes: 'Access was limited.',
    })
  })
})
