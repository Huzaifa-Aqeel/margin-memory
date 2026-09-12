import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ScopeReviewFields } from '../../../src/components/scope-review-fields'
import { ScopeSummary } from '../../../src/components/scope-summary'
import { validateScopeInput } from '../../../src/lib/domain/scope'
import { calculateVariances } from '../../../src/lib/domain/analytics'
import type { Job } from '../../../src/lib/domain/types'

const estimateLines: Job['estimateLines'] = [{ id: 'original', category: 'labor', description: 'Original work', estimatedCost: 100, estimatedHours: 10 }]
const actualLines: Job['actualLines'] = [{ id: 'actual', category: 'labor', description: 'All work', actualCost: 150, actualHours: 15 }]
const job: Job = { id: 'fixture', name: 'Scope fixture', projectType: 'Office', customerType: 'Commercial', location: '', completedAt: '2026-01-01', tags: [], notes: '', estimateLines, actualLines, variances: calculateVariances(estimateLines, actualLines), estimatedTotal: 100, actualTotal: 150 }
function Fixture() {
  const [result, setResult] = useState<Job | null>(null)
  const [error, setError] = useState('')
  return <><form onSubmit={e => {
    e.preventDefault(); setError('')
    try { setResult({ ...job, scopeReview: validateScopeInput(new FormData(e.currentTarget).get('scopeReview'), estimateLines, actualLines, true) }) }
    catch (error) { setError(error instanceof Error ? error.message : 'Invalid input') }
  }}><ScopeReviewFields/><button type="submit">Check scope</button></form>
    {error && <p role="alert">{error}</p>}{result && <ScopeSummary job={result}/>}</>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
