'use client'

import { ScopeReviewFields } from './scope-review-fields'
import { ImportPreview, type ImportPreviewHandle, type PreviewResult } from './import-preview'
import { historicalCustomerTypes, historicalProjectTypes, inferHistoricalImportMetadata, type HistoricalEstimateBaselineRole, type HistoricalImportMetadataSuggestion } from '@/lib/historical-import-metadata'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArchiveRestore, CheckCircle2 } from 'lucide-react'

type MetadataState = {
  name: string
  projectType: string
  customerType: string
  location: string
  completedAt: string
  estimateBaselineRole: HistoricalEstimateBaselineRole | ''
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

export type HistoricalSourcePair = { id: string; estimateFile: File; actualFile: File }
export type HistoricalImportDefaults = Partial<Pick<MetadataState, 'projectType' | 'customerType' | 'location' | 'estimateBaselineRole'>>
export type HistoricalImportFormState = { analyzed: boolean; ready: boolean; busy: boolean; completed: boolean; error: string }
export type ImportJobFormHandle = { analyze: () => Promise<boolean>; importJob: () => Promise<boolean>; isReady: () => boolean }

type ImportJobFormProps = {
  sourcePair?: HistoricalSourcePair
  defaults?: HistoricalImportDefaults
  initialReadyCount?: number
  batch?: boolean
  onStateChange?: (state: HistoricalImportFormState) => void
}

const emptyMetadata: MetadataState = { name: '', projectType: '', customerType: '', location: '', completedAt: '', estimateBaselineRole: '', tags: '', notes: '' }
const baselineOptions: Array<{ value: HistoricalEstimateBaselineRole; label: string; detail: string }> = [
  { value: 'final_submitted', label: 'Final submitted bid', detail: 'The last bid issued before award.' },
  { value: 'original_bid', label: 'Original bid', detail: 'The first commercial estimate for the work.' },
  { value: 'historical_unknown', label: 'Not sure', detail: 'Archive as limited history until the baseline is known.' },
]

function suggestedMetadata(pair?: HistoricalSourcePair) {
  return pair ? inferHistoricalImportMetadata({ estimateFileName: pair.estimateFile.name, actualFileName: pair.actualFile.name }) : undefined
}

function startingMetadata(pair?: HistoricalSourcePair, defaults?: HistoricalImportDefaults): MetadataState {
  const suggestion = suggestedMetadata(pair)
  return {
    ...emptyMetadata,
    name: suggestion?.name ?? '',
    projectType: defaults?.projectType ?? suggestion?.projectType ?? '',
    customerType: defaults?.customerType ?? suggestion?.customerType ?? '',
    location: defaults?.location ?? '',
    completedAt: suggestion?.completedAt ?? '',
    estimateBaselineRole: defaults?.estimateBaselineRole ?? '',
    tags: suggestion?.tags.join(', ') ?? '',
  }
}

function sourceFile(form: HTMLFormElement, name: 'estimateFile' | 'actualFile') {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.files?.[0]
}

export const ImportJobForm = forwardRef<ImportJobFormHandle, ImportJobFormProps>(function ImportJobForm({ sourcePair, defaults, initialReadyCount = 0, batch = false, onStateChange }, ref) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const previewRef = useRef<ImportPreviewHandle>(null)
  const touched = useRef(new Set<keyof MetadataState>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewReady, setPreviewReady] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [metadata, setMetadata] = useState<MetadataState>(() => startingMetadata(sourcePair, defaults))
  const [baselineSuggestion, setBaselineSuggestion] = useState<HistoricalEstimateBaselineRole>(() => suggestedMetadata(sourcePair)?.estimateBaselineRole ?? 'historical_unknown')
  const [completed, setCompleted] = useState<ImportSuccess | null>(null)
  const [readyCount, setReadyCount] = useState(initialReadyCount)
  const [formRevision, setFormRevision] = useState(0)
  const reviewedSource = Boolean(preview?.review && preview.canImport)

  function applySuggestions(suggestions?: HistoricalImportMetadataSuggestion) {
    if (!suggestions) return
    setBaselineSuggestion(suggestions.estimateBaselineRole)
    setMetadata(current => ({
      ...current,
      ...(!touched.current.has('name') ? { name: suggestions.name ?? '' } : {}),
      ...(!touched.current.has('projectType') ? { projectType: defaults?.projectType ?? suggestions.projectType ?? '' } : {}),
      ...(!touched.current.has('customerType') ? { customerType: defaults?.customerType ?? suggestions.customerType ?? '' } : {}),
      ...(!touched.current.has('completedAt') ? { completedAt: suggestions.completedAt ?? '' } : {}),
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
    setMetadata(current => ({ ...current, estimateBaselineRole: '' }))
    const form = formRef.current
    if (!form) return
    const estimate = sourceFile(form, 'estimateFile'), actual = sourceFile(form, 'actualFile')
    if (estimate && actual) applySuggestions(inferHistoricalImportMetadata({ estimateFileName: estimate.name, actualFileName: actual.name }))
  }

  function supportingSourceChanged() {
    invalidatePreview()
  }

  function update<Field extends keyof MetadataState>(field: Field, value: MetadataState[Field], invalidatesReview = false) {
    touched.current.add(field)
    setMetadata(current => ({ ...current, [field]: value }))
    if (invalidatesReview) invalidatePreview()
  }

  function buildFormData() {
    const form = formRef.current
    if (!form) return null
    const data = new FormData(form)
    if (sourcePair) {
      data.set('estimateFile', sourcePair.estimateFile)
      data.set('actualFile', sourcePair.actualFile)
    }
    return data
  }

  function isReady() {
    return Boolean(reviewedSource && previewReady && formRef.current?.checkValidity())
  }

  async function commit(form: HTMLFormElement) {
    if (!previewReady) { setError('Complete the source review and required confirmations before importing.'); return false }
    if (!form.reportValidity()) return false
    const body = buildFormData()
    if (!body) return false
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/jobs/import', { method: 'POST', body })
      const data = await response.json() as ImportSuccess & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Import failed.')
      setCompleted(data)
      if (data.historicalEvidence?.eligible && !data.idempotentReplay) setReadyCount(value => value + 1)
      router.refresh()
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import failed.'); return false }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await commit(event.currentTarget)
  }

  function startAnother() {
    touched.current.clear()
    formRef.current?.reset()
    setMetadata(emptyMetadata)
    setBaselineSuggestion('historical_unknown')
    setCompleted(null)
    setError('')
    setPreviewReady(false)
    setPreview(null)
    setPreviewRevision(value => value + 1)
  }

  useImperativeHandle(ref, () => ({
    analyze: async () => Boolean(await previewRef.current?.inspect()),
    importJob: async () => formRef.current ? commit(formRef.current) : false,
    isReady,
  }))

  useEffect(() => {
    onStateChange?.({ analyzed: Boolean(preview), ready: Boolean(reviewedSource && previewReady && formRef.current?.checkValidity()), busy, completed: Boolean(completed), error })
  }, [busy, completed, error, formRevision, metadata, onStateChange, preview, previewReady, reviewedSource])

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
        <div className="actions">
          {!batch && <button type="button" className="btn primary" onClick={startAnother}>Import another similar job</button>}
          <button type="button" className={batch ? 'btn primary' : 'btn'} onClick={() => router.push(`/jobs/${completed.job.id}`)}>View completed job</button>
          <button type="button" className="btn" onClick={() => router.push('/jobs')}>Back to job history</button>
        </div>
      </div>
    </section>
  }

  return <form ref={formRef} className="card form-card" onSubmit={submit} onChange={() => setFormRevision(value => value + 1)}>
    {!batch && <div className="onboarding-progress" aria-label="Historical evidence progress">
      <strong>{readyCount} trusted completed {readyCount === 1 ? 'job' : 'jobs'} ready</strong>
      <span>{readyCount >= 3 ? 'You have a useful starting set. Add jobs that are comparable to upcoming bids.' : 'Repeated-variance findings require at least 2 usable comparisons; start with 3–5 similar recent jobs.'}</span>
    </div>}
    <section className="historical-import-step">
      <div className="eyebrow">1 · Source records</div><h2>Choose the estimate and final job costs</h2>
      <p className="subtle">Margin Memory will interpret the files first. You will review only choices that affect the comparison.</p>
      <div className="form-grid">
        {sourcePair ? <>
          <div className="import-source-file"><strong>Estimate</strong><span>{sourcePair.estimateFile.name}</span></div>
          <div className="import-source-file"><strong>Final actuals</strong><span>{sourcePair.actualFile.name}</span></div>
        </> : <>
          <div className="field"><label htmlFor="historical-estimate-file">Estimate used as the comparison baseline</label><div className="file-drop"><input id="historical-estimate-file" name="estimateFile" type="file" accept=".xlsx,.csv" required onChange={sourcesChanged}/><div className="helper">XLSX or UTF-8 CSV</div></div></div>
          <div className="field"><label htmlFor="historical-actual-file">Final actual job costs</label><div className="file-drop"><input id="historical-actual-file" name="actualFile" type="file" accept=".xlsx,.csv" required onChange={sourcesChanged}/><div className="helper">XLSX or UTF-8 CSV</div></div></div>
        </>}
        <fieldset className="field full baseline-choice"><legend>What does the estimate file represent?</legend>
          <div className="baseline-choice-grid">{baselineOptions.map(option => <label className="import-choice card flat" key={option.value}><input type="radio" name="estimateBaselineChoice" value={option.value} checked={metadata.estimateBaselineRole === option.value} onChange={() => update('estimateBaselineRole', option.value, true)}/><span><strong>{option.label}</strong>{baselineSuggestion !== 'historical_unknown' && baselineSuggestion === option.value && <span className="badge neutral">Suggested</span>}<span className="helper">{option.detail}</span></span></label>)}</div>
          <input type="hidden" name="estimateBaselineRole" value={metadata.estimateBaselineRole}/>
          <input type="hidden" name="estimateBaselineConfirmed" value={metadata.estimateBaselineRole ? 'true' : 'false'}/>
          <div className="helper">Choose one value deliberately. Changing it invalidates the previous file review.</div>
        </fieldset>
        {!sourcePair && <details className="field full"><summary>Add a closeout notes file</summary><div className="file-drop" style={{ marginTop: 8 }}><input name="notesFile" type="file" accept=".txt,.md,.pdf" onChange={supportingSourceChanged}/><div className="helper">Optional TXT, Markdown, or PDF source evidence</div></div></details>}
        <ImportPreview ref={previewRef} key={previewRevision} formRef={formRef} getFormData={buildFormData} mode="pair" disabled={!metadata.estimateBaselineRole} onReady={setPreviewReady} onAnalysis={value => { setPreview(value); applySuggestions(value?.metadataSuggestions) }}/>
      </div>
    </section>

    {reviewedSource && <section className="historical-import-step" aria-label="Completed job details">
      <div className="eyebrow">2 · Evidence readiness</div><h2>{metadata.name || 'Confirm job context'}</h2>
      <p className="subtle">Suggested details come from the source filenames. Confirm the final actuals and scope below; edit anything that is not correct.</p>
      <div className="form-grid">
        <div className="field"><label htmlFor={`${sourcePair?.id ?? 'historical'}-job-name`}>Job name</label><input id={`${sourcePair?.id ?? 'historical'}-job-name`} name="name" required value={metadata.name} onChange={event => update('name', event.currentTarget.value)} placeholder="Baker Office Renovation"/></div>
        <div className="field"><label htmlFor={`${sourcePair?.id ?? 'historical'}-completed-at`}>Completed date</label><input id={`${sourcePair?.id ?? 'historical'}-completed-at`} type="date" name="completedAt" required value={metadata.completedAt} onChange={event => update('completedAt', event.currentTarget.value)}/></div>
        <div className="field"><label htmlFor={`${sourcePair?.id ?? 'historical'}-project-type`}>Project type</label><select id={`${sourcePair?.id ?? 'historical'}-project-type`} name="projectType" required value={metadata.projectType} onChange={event => update('projectType', event.currentTarget.value)}><option value="" disabled>Choose project type</option>{historicalProjectTypes.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label htmlFor={`${sourcePair?.id ?? 'historical'}-customer-type`}>Customer type</label><select id={`${sourcePair?.id ?? 'historical'}-customer-type`} name="customerType" required value={metadata.customerType} onChange={event => update('customerType', event.currentTarget.value)}><option value="" disabled>Choose customer type</option>{historicalCustomerTypes.map(value => <option key={value}>{value}</option>)}</select></div>
        <details className="field full"><summary>Optional job details</summary><div className="form-grid" style={{ marginTop: 10 }}>
          <div className="field"><label>Location</label><input name="location" value={metadata.location} onChange={event => update('location', event.currentTarget.value)} placeholder="Philadelphia, PA"/></div>
          <div className="field"><label>Tags</label><input name="tags" value={metadata.tags} onChange={event => update('tags', event.currentTarget.value)} placeholder="occupied, retrofit, after-hours"/></div>
          <div className="field full"><label>Closeout notes</label><textarea name="notes" value={metadata.notes} onChange={event => update('notes', event.currentTarget.value)} placeholder="What changed? What surprised the crew? Why did labor or material differ?"/></div>
        </div></details>
        <ScopeReviewFields baselineRole={metadata.estimateBaselineRole || 'historical_unknown'}/>
      </div>
    </section>}

    {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
    {reviewedSource && <div className="actions" style={{ marginTop: 18 }}><button className="btn primary" disabled={busy || !previewReady}><ArchiveRestore size={16}/>{busy ? 'Importing completed job…' : 'Import completed job'}</button></div>}
  </form>
})
