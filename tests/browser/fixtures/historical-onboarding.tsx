import { createRoot } from 'react-dom/client'
import { HistoricalOnboardingWorkspace } from '../../../src/components/historical-onboarding-workspace'

type Scenario = 'clean' | 'worksheet' | 'mapping' | 'partial' | 'blocked'

const categories = { labor: 1, materials: 1, equipment: 0, subcontractor: 0, permit: 0, other: 0 }
const categoryTotals = {
  labor: { cost: 500, hours: 10 }, materials: { cost: 500, hours: 0 }, equipment: { cost: 0, hours: 0 },
  subcontractor: { cost: 0, hours: 0 }, permit: { cost: 0, hours: 0 }, other: { cost: 0, hours: 0 },
}

function report(kind: 'estimate' | 'actual') {
  return {
    kind, fileName: kind === 'estimate' ? 'Baker Office Renovation - Final Estimate.csv' : 'Baker Office Renovation - Actuals 2026-08-31.csv',
    sheetName: 'Bid Detail', worksheets: [{ name: 'Bid Detail', hidden: false, plausible: true, selected: true, headerRow: 2, score: 5 }],
    worksheetSelectionRationale: 'Exactly one visible worksheet has a usable import table.', headerRow: 2,
    headers: ['description', 'category', 'cost', 'hours'], mappedColumns: { description: 'description', category: 'category', cost: 'cost', hours: 'hours' },
    mappedColumnIndexes: { description: 1, category: 2, cost: 3, hours: 4 },
    mappingCandidates: { description: ['description (column 1)'], category: ['category (column 2)'], cost: ['cost (column 3)'], hours: ['hours (column 4)'] },
    mappingOptions: { description: [{ header: 'description', column: 1 }], category: [{ header: 'category', column: 2 }], cost: [{ header: 'cost', column: 3 }], hours: [{ header: 'hours', column: 4 }] },
    sourceRows: 4, importedRows: 2, skippedSummaryRows: 1, skippedEmptyRows: 1,
    excludedRows: [{ sourceRow: 5, reason: 'summary', description: 'Grand Total' }, { sourceRow: 6, reason: 'blank', description: '' }],
    malformedCells: [], invalidNumericCells: 0, categoryCounts: categories, categoryTotals, totalCost: 1000, totalHours: 10,
    sourceReportedTotal: 1000, normalizedDetailTotal: 1000,
    totalReconciliation: { state: 'matched', sourceReportedTotal: 1000, normalizedDetailTotal: 1000, absoluteDifference: 0, percentageDifference: 0, absoluteTolerance: 1, percentageTolerance: .0001, absoluteToleranceCap: 10, roundingTolerance: 1, reviewTolerance: 1 },
    laborHourCoverage: 'present', structuredDimensions: { costCodes: [], phases: [], divisions: [] }, issues: [],
  }
}

function response(scenario: Scenario) {
  const estimate = report('estimate'), actual = report('actual')
  const complete = { state: 'complete', missingActualCategories: [], confirmedZeroCategories: [], missingActualCostCodes: [], missingActualPhases: [], missingActualDivisions: [], costCodeCoverage: 'not_applicable', phaseCoverage: 'not_applicable', divisionCoverage: 'not_applicable', requiresExplicitConfirmation: true }
  if (scenario === 'worksheet') {
    estimate.sheetName = ''
    estimate.worksheets = [
      { name: 'Bid Detail', hidden: false, plausible: true, selected: false, headerRow: 2, score: 5 },
      { name: 'Estimate Summary', hidden: false, plausible: true, selected: false, headerRow: 1, score: 5 },
    ]
    return { reports: [estimate, actual], issues: [{ severity: 'error', code: 'worksheet_ambiguous', message: 'Multiple visible worksheets contain materially plausible import tables.' }], completeness: complete, requiresReview: true, canImport: false }
  }
  if (scenario === 'mapping') {
    estimate.mappingCandidates.cost = ['amount (column 3)', 'cost (column 4)']
    estimate.mappingOptions.cost = [{ header: 'amount', column: 3 }, { header: 'cost', column: 4 }]
    return { reports: [estimate, actual], issues: [{ severity: 'error', code: 'ambiguous_mapping', message: 'Multiple columns could supply cost: amount (column 3), cost (column 4).' }], completeness: complete, requiresReview: true, canImport: false }
  }
  if (scenario === 'blocked') return { reports: [estimate, actual], issues: [{ severity: 'error', code: 'invalid_numbers', message: 'One financial cell could not be interpreted safely.' }], completeness: complete, requiresReview: true, canImport: false }
  if (scenario === 'partial') {
    const incomplete = { ...complete, state: 'incomplete', missingActualCategories: ['materials'] }
    return { reports: [estimate, actual], issues: [{ severity: 'warning', code: 'actual_categories_missing', resolution: 'incomplete_actuals', message: 'Actual export is missing the materials category.' }], completeness: incomplete, requiresReview: true, canImport: true, review: { id: 'review-partial', reportHash: 'b'.repeat(64), expiresAt: '2026-09-14T00:00:00Z' } }
  }
  return { reports: [estimate, actual], issues: [{ severity: 'warning', code: 'actual_completeness_confirmation', resolution: 'actual_completeness', message: 'Confirm this is the final and complete actual-cost export.' }], completeness: complete, requiresReview: true, requiresActualCompletenessConfirmation: true, canImport: true, review: { id: 'review-clean', reportHash: 'a'.repeat(64), expiresAt: '2026-09-14T00:00:00Z' } }
}

let scenario: Scenario = 'clean'
window.fetch = async (input, init) => {
  const url = String(input)
  if (url.includes('/api/import/preview')) {
    const body = init?.body instanceof FormData ? init.body : undefined
    if ((scenario === 'worksheet' && body?.get('estimateWorksheet')) || (scenario === 'mapping' && body?.get('estimateMapping'))) return new Response(JSON.stringify(response('clean')), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify(response(scenario)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (url.includes('/api/jobs/import')) return new Response(JSON.stringify({ job: { id: 'job-1', name: 'Baker Office Renovation' }, lesson: null, warnings: [], historicalEvidence: { eligible: true, reasons: [], estimateSourcePreserved: true, actualCostsReconciled: true, laborComparisonAvailable: true } }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response(JSON.stringify({ error: 'Unhandled fixture request' }), { status: 500 })
}

function Fixture() {
  return <main className="page"><div className="actions fixture-switcher" aria-label="Import scenarios">
    {(['clean', 'worksheet', 'mapping', 'partial', 'blocked'] as const).map(value => <button type="button" key={value} onClick={() => { scenario = value }}>{value}</button>)}
  </div><div className="page-head"><div><div className="eyebrow">Historical onboarding</div><h1>Build a useful comparison set</h1><p className="subtle">Compare existing estimates with final job costs.</p></div></div><HistoricalOnboardingWorkspace initialReadyCount={1}/></main>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
