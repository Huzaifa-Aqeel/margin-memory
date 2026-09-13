'use client'

import { ScopeReviewFields } from './scope-review-fields'
import { ImportPreview, type PreviewResult } from './import-preview'
import { historicalCustomerTypes, historicalProjectTypes, inferHistoricalImportMetadata, type HistoricalImportMetadataSuggestion } from '@/lib/historical-import-metadata'
import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArchiveRestore, CheckCircle2 } from 'lucide-react'

type MetadataState = {
  name: string
  projectType: string
  customerType: string
  location: string
  completedAt: string
  estimateBaselineRole: 'original_bid' | 'final_submitted' | 'historical_unknown'
  tags: string
  notes: string
}

type ImportSuccess = {
  job: { id: string; name?: string }
  lesson?: unknown
  idempotentReplay?: boolean
  warnings?: string[]
  historicalEvidence?: {
    eligible: boolean
    reasons: string[]
    estimateSourcePreserved: boolean
    actualCostsReconciled: boolean
    laborComparisonAvailable: boolean
  }
}

const initialMetadata: MetadataState = { name: '', projectType: '', customerType: '', location: '', completedAt: '', estimateBaselineRole: 'historical_unknown', tags: '', notes: '' }

function sourceFile(form: HTMLFormElement, name: 'estimateFile' | 'actualFile') {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.files?.[0]
}

export function ImportJobForm() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const touched = useRef(new Set<keyof MetadataState>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewReady, setPreviewReady] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [metadata, setMetadata] = useState<MetadataState>(initialMetadata)
  const [baselineConfirmed, setBaselineConfirmed] = useState(false)
  const [completed, setCompleted] = useState<ImportSuccess | null>(null)

  function applySuggestions(suggestions?: HistoricalImportMetadataSuggestion) {
    if (!suggestions) return
    setMetadata(current => ({
      ...current,
      ...(!touched.current.has('name') ? { name: suggestions.name ?? '' } : {}),
      ...(!touched.current.has('projectType') ? { projectType: suggestions.projectType ?? '' } : {}),
      ...(!touched.current.has('customerType') ? { customerType: suggestions.customerType ?? '' } : {}),
      ...(!touched.current.has('completedAt') ? { completedAt: suggestions.completedAt ?? '' } : {}),
      ...(!touched.current.has('estimateBaselineRole') ? { estimateBaselineRole: suggestions.estimateBaselineRole } : {}),
      ...(!touched.current.has('tags') ? { tags: suggestions.tags.join(', ') } : {}),
    }))
  }

  function invalidatePreview() {
    setPreviewReady(false)
    setPreview(null)
    setPreviewRevision(value => value + 1)
  }

  function sourcesChanged() {
    invalidatePreview()
    setBaselineConfirmed(false)
    const form = formRef.current
    if (!form) return
    const estimate = sourceFile(form, 'estimateFile'), actual = sourceFile(form, 'actualFile')
    if (estimate && actual) applySuggestions(inferHistoricalImportMetadata({ estimateFileName: estimate.name, actualFileName: actual.name }))
  }

  function update<Field extends keyof MetadataState>(field: Field, value: MetadataState[Field], invalidatesReview = false) {
    touched.current.add(field)
    setMetadata(current => ({ ...current, [field]: value }))
    if (invalidatesReview) { setBaselineConfirmed(false); invalidatePreview() }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!previewReady) { setError('Complete the source review and required confirmations before importing.'); return }
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/jobs/import', { method: 'POST', body: new FormData(event.currentTarget) })
      const data = await response.json() as ImportSuccess & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Import failed.')
      setCompleted(data); router.refresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'Import failed.') }
    finally { setBusy(false) }
  }

  if (completed) {
    const readiness = completed.historicalEvidence
    return <section className="card import-complete" aria-label="Completed job import result">
      <CheckCircle2 size={34}/><div><div className="eyebrow">Completed job imported</div><h2>{completed.job.name || metadata.name}</h2>
        <div className="import-check-list">
          <span>✓ Estimate and actual source records preserved</span>
          {readiness?.actualCostsReconciled && <span>✓ Actual costs and scope reconciled</span>}
          {readiness?.laborComparisonAvailable && <span>✓ Labor comparison available</span>}
          {readiness?.eligible && <span>✓ Eligible for future Margin Checks</span>}
        </div>
        {readiness && !readiness.eligible && <div className="warning-banner"><strong>Historical evidence is limited.</strong><ul>{readiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>This job remains in history but will not be used for numerical historical evidence.</div>}
        {completed.warnings?.map(warning => <div className="warning-banner" key={warning}>{warning}</div>)}
        {completed.idempotentReplay && <p className="helper">This request was already completed, so Margin Memory returned the existing job instead of creating a duplicate.</p>}
        <div className="actions"><button type="button" className="btn primary" onClick={() => router.push(`/jobs/${completed.job.id}`)}>View completed job</button><button type="button" className="btn" onClick={() => router.push('/jobs')}>Back to job history</button></div>
      </div>
    </section>
  }

  const reviewedSource = Boolean(preview?.review && preview.canImport)
  return <form ref={formRef} className="card form-card" onSubmit={submit}>
    <section className="historical-import-step">
      <div className="eyebrow">1 · Source records</div><h2>Choose the estimate and final job costs</h2>
      <p className="subtle">Margin Memory will interpret the files first. You will review only choices that affect the comparison.</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="historical-estimate-file">Estimate used as the comparison baseline</label><div className="file-drop"><input id="historical-estimate-file" name="estimateFile" type="file" accept=".xlsx,.csv" required onChange={sourcesChanged}/><div className="helper">XLSX or UTF-8 CSV</div></div></div>
        <div className="field"><label htmlFor="historical-actual-file">Final actual job costs</label><div className="file-drop"><input id="historical-actual-file" name="actualFile" type="file" accept=".xlsx,.csv" required onChange={sourcesChanged}/><div className="helper">XLSX or UTF-8 CSV</div></div></div>
        <div className="field full"><label htmlFor="historical-baseline">What does the estimate file represent?</label><select id="historical-baseline" value={metadata.estimateBaselineRole} onChange={event => update('estimateBaselineRole', event.currentTarget.value as MetadataState['estimateBaselineRole'], true)}><option value="final_submitted">Final submitted bid</option><option value="original_bid">Original bid</option><option value="historical_unknown">Historical baseline / not sure</option></select><input type="hidden" name="estimateBaselineRole" value={metadata.estimateBaselineRole}/><div className="helper">Margin Memory may suggest this from the filename. An unknown baseline is kept as limited history.</div><label className="import-confirmation"><input type="checkbox" name="estimateBaselineConfirmed" value="true" checked={baselineConfirmed} onChange={event => { setBaselineConfirmed(event.currentTarget.checked); invalidatePreview() }}/>I confirm this describes the estimate file selected above.</label></div>
        <details className="field full"><summary>Add a closeout notes file</summary><div className="file-drop" style={{ marginTop: 8 }}><input name="notesFile" type="file" accept=".txt,.md,.pdf" onChange={sourcesChanged}/><div className="helper">Optional TXT, Markdown, or PDF source evidence</div></div></details>
        <ImportPreview key={previewRevision} formRef={formRef} mode="pair" disabled={!baselineConfirmed} onReady={setPreviewReady} onAnalysis={value => { setPreview(value); applySuggestions(value?.metadataSuggestions) }}/>
      </div>
    </section>

    {reviewedSource && <section className="historical-import-step" aria-label="Completed job details">
      <div className="eyebrow">2 · Confirm job context</div><h2>{metadata.name || 'Completed job details'}</h2>
      <p className="subtle">Suggested details come from the source filenames. Edit anything that is not correct.</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="historical-job-name">Job name</label><input id="historical-job-name" name="name" required value={metadata.name} onChange={event => update('name', event.currentTarget.value)} placeholder="Baker Office Renovation"/></div>
        <div className="field"><label htmlFor="historical-completed-at">Completed date</label><input id="historical-completed-at" type="date" name="completedAt" required value={metadata.completedAt} onChange={event => update('completedAt', event.currentTarget.value)}/></div>
        <div className="field"><label htmlFor="historical-project-type">Project type</label><select id="historical-project-type" name="projectType" required value={metadata.projectType} onChange={event => update('projectType', event.currentTarget.value)}><option value="" disabled>Choose project type</option>{historicalProjectTypes.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label htmlFor="historical-customer-type">Customer type</label><select id="historical-customer-type" name="customerType" required value={metadata.customerType} onChange={event => update('customerType', event.currentTarget.value)}><option value="" disabled>Choose customer type</option>{historicalCustomerTypes.map(value => <option key={value}>{value}</option>)}</select></div>
        <details className="field full"><summary>Optional job details</summary><div className="form-grid" style={{ marginTop: 10 }}>
          <div className="field"><label>Location</label><input name="location" value={metadata.location} onChange={event => update('location', event.currentTarget.value)} placeholder="Philadelphia, PA"/></div>
          <div className="field"><label>Tags</label><input name="tags" value={metadata.tags} onChange={event => update('tags', event.currentTarget.value)} placeholder="occupied, retrofit, after-hours"/></div>
          <div className="field full"><label>Closeout notes</label><textarea name="notes" value={metadata.notes} onChange={event => update('notes', event.currentTarget.value)} placeholder="What changed? What surprised the crew? Why did labor or material differ?"/></div>
        </div></details>
        <ScopeReviewFields/>
      </div>
    </section>}

    {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
    {reviewedSource && <div className="actions" style={{ marginTop: 18 }}><button className="btn primary" disabled={busy || !previewReady}><ArchiveRestore size={16}/>{busy ? 'Importing completed job…' : 'Import completed job'}</button></div>}
  </form>
}
