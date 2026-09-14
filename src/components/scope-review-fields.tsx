'use client'

import { useId, useState } from 'react'
import { costCategories, type ScopeReview } from '@/lib/domain/scope'
import type { HistoricalEstimateBaselineRole } from '@/lib/historical-import-metadata'
import { parseScopeChangePaste } from '@/lib/scope-change-paste'

type Entry = { key: number; reference: string; description: string; category: string; estimatedCost: string; estimatedHours: string; actualCost: string; actualHours: string }
const newEntry = (key: number): Entry => ({ key, reference: '', description: '', category: 'labor', estimatedCost: '', estimatedHours: '', actualCost: '', actualHours: '' })
const numericFields = [
  ['estimatedCost', 'Approved cost budget change ($)'], ['estimatedHours', 'Approved hours change'],
  ['actualCost', 'Actual cost for this change ($)'], ['actualHours', 'Actual hours for this change'],
] as const

export function ScopeReviewFields({ baselineRole = 'original_bid' }: { baselineRole?: HistoricalEstimateBaselineRole }) {
  const id = useId()
  const [status, setStatus] = useState<ScopeReview['status'] | ''>('')
  const [entries, setEntries] = useState<Entry[]>([newEntry(0)])
  const [nextKey, setNextKey] = useState(1)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState('')
  const changes = status === 'adjusted' ? entries.map(entry => ({ reference: entry.reference, description: entry.description, category: entry.category,
    estimatedCost: Number(entry.estimatedCost), estimatedHours: Number(entry.estimatedHours),
    actualCost: Number(entry.actualCost), actualHours: Number(entry.actualHours),
  })) : []
  function update(key: number, field: keyof Omit<Entry, 'key'>, value: string) {
    setEntries(current => current.map(entry => entry.key === key ? { ...entry, [field]: value } : entry))
  }
  function usePastedRows() {
    try {
      const parsed = parseScopeChangePaste(pasted)
      setEntries(parsed.map((change, key) => ({ key, reference: change.reference, description: change.description, category: change.category, estimatedCost: String(change.estimatedCost), estimatedHours: String(change.estimatedHours), actualCost: String(change.actualCost), actualHours: String(change.actualHours) })))
      setNextKey(parsed.length)
      setPasteError('')
    } catch (cause) { setPasteError(cause instanceof Error ? cause.message : 'Could not interpret pasted scope changes.') }
  }
  const baselineLabel = baselineRole === 'final_submitted' ? 'final submitted estimate' : baselineRole === 'original_bid' ? 'original estimate' : 'selected estimate baseline'
  return <div className="field full">
    <label htmlFor={`${id}-status`}>Does the final work match the {baselineLabel} scope?</label>
    <select id={`${id}-status`} required value={status} onChange={e => setStatus(e.target.value as ScopeReview['status'])}>
      <option value="" disabled>Choose after checking the job records</option>
      <option value="no_changes">Yes — no approved scope changes</option>
      <option value="adjusted">Approved scope changes — enter the reconciliation</option>
      <option value="unreconciled">Not sure — archive without using it for comparisons</option>
    </select>
    <input type="hidden" name="scopeReview" value={JSON.stringify({ status: status || 'unreconciled', changes })}/>
    <p className="helper">The original estimate and final actuals stay intact. Record cost allowances, not the price charged to the customer. This assessment is saved with the import and cannot be edited afterward.</p>
    {status === 'unreconciled' && <p className="warning-banner">This job will remain in history but will not be used for lessons or future comparisons unless its scope can be reconciled.</p>}
    {status === 'adjusted' && <>
      <p className="helper">One row per approved change and cost category. Use a negative budget change for removed work. Allocate only costs and hours included in the final actuals file; enter 0 where none apply. If you cannot reconcile all changes, choose “Not sure”.</p>
      <details className="scope-paste">
        <summary>Paste scope changes from a spreadsheet</summary>
        <p className="helper">Copy a tab-separated table from Excel, or paste CSV, with these headers: Reference, Description, Category, Budget cost, Budget hours, Actual cost, Actual hours.</p>
        <textarea aria-label="Pasted scope changes" value={pasted} onChange={event => setPasted(event.currentTarget.value)} placeholder={'Reference\tDescription\tCategory\tBudget cost\tBudget hours\tActual cost\tActual hours\nCO-03\tAdditional circuits\tmaterials\t2400\t0\t2200\t0'}/>
        {pasteError && <div className="error" role="alert">{pasteError}</div>}
        <button type="button" className="btn small" onClick={usePastedRows}>Use pasted rows</button>
      </details>
      {entries.map((entry, index) => <fieldset key={entry.key} className="card" style={{ marginBottom: 12 }}>
        <legend>Scope change {index + 1}</legend>
        <div className="form-grid">
          <div className="field"><label htmlFor={`${id}-${entry.key}-reference`}>Approval reference</label><input id={`${id}-${entry.key}-reference`} required maxLength={200} value={entry.reference} onChange={e => update(entry.key, 'reference', e.target.value)} placeholder="CO-03 · signed 10 September"/></div>
          <div className="field"><label htmlFor={`${id}-${entry.key}-category`}>Cost category</label><select id={`${id}-${entry.key}-category`} value={entry.category} onChange={e => update(entry.key, 'category', e.target.value)}>{costCategories.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="field full"><label htmlFor={`${id}-${entry.key}-description`}>Approved scope</label><input id={`${id}-${entry.key}-description`} required maxLength={1000} value={entry.description} onChange={e => update(entry.key, 'description', e.target.value)} placeholder="Additional circuits requested after award"/></div>
          {numericFields.map(([field, label]) => <div className="field" key={field}><label htmlFor={`${id}-${entry.key}-${field}`}>{label}</label><input id={`${id}-${entry.key}-${field}`} type="number" step="0.01" required min={field.startsWith('actual') ? 0 : -1e12} max={1e12} value={entry[field]} onChange={e => update(entry.key, field, e.target.value)}/></div>)}
        </div>
        {entries.length > 1 && <button type="button" className="btn small" onClick={() => setEntries(current => current.filter(e => e.key !== entry.key))}>Remove scope change {index + 1}</button>}
      </fieldset>)}
      <button type="button" className="btn small" disabled={entries.length >= 100} onClick={() => { setEntries(current => [...current, newEntry(nextKey)]); setNextKey(nextKey + 1) }}>Add scope change / category</button>
    </>}
  </div>
}
