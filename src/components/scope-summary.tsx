import { money } from '@/lib/domain/analytics'
import { jobScopeComparison } from '@/lib/domain/scope'
import type { Job } from '@/lib/domain/types'

export function ScopeSummary({ job }: { job: Job }) {
  const comparison = jobScopeComparison(job)
  return <section className="section card">
    <h2>Scope reconciliation</h2>
    {!comparison ? <p className="warning-banner">Scope has not been reconciled. Original costs remain available, but this job and its lessons are excluded from new automated comparisons. A difference from the original bid is not proof of an estimating mistake.</p> : <>
      <p>{job.scopeReview?.status === 'no_changes' ? 'The importer confirmed no approved scope changes.' : 'The importer recorded these approved changes separately from the original bid.'} Comparisons use the final approved cost budget; they do not establish why a variance occurred.</p>
      <div className="grid cols-4">
        <div><div className="metric-label">Original cost budget</div><strong>{money(job.estimatedTotal)}</strong></div>
        <div><div className="metric-label">Scope-adjusted cost budget</div><strong>{money(comparison.adjustedTotal)}</strong></div>
        <div><div className="metric-label">Actuals allocated to changes</div><strong>{money(comparison.changeActualTotal)}</strong></div>
        <div><div className="metric-label">Remaining original-scope actuals</div><strong>{money(comparison.originalScopeActualTotal)}</strong></div>
      </div>
      {!!job.scopeReview?.changes.length && <div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>Approval / scope</th><th>Category</th><th>Budget change</th><th>Hours change</th><th>Allocated actual cost</th><th>Allocated actual hours</th></tr></thead><tbody>{job.scopeReview.changes.map((c, i) => <tr key={i}><td>{c.reference}<div className="helper">{c.description}</div></td><td>{c.category}</td><td>{money(c.estimatedCost)}</td><td>{c.estimatedHours}</td><td>{money(c.actualCost)}</td><td>{c.actualHours}</td></tr>)}</tbody></table></div>}
      <p className="helper">These are cost budgets. Customer change-order revenue is not recorded here; the recorded contract amount is unchanged.</p>
    </>}
  </section>
}
