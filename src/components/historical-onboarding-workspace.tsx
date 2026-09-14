'use client'

import { ImportJobForm, type HistoricalImportDefaults, type HistoricalImportFormState, type HistoricalSourcePair, type ImportJobFormHandle } from './import-job-form'
import { historicalCustomerTypes, historicalProjectTypes, type HistoricalEstimateBaselineRole } from '@/lib/historical-import-metadata'
import { proposeHistoricalFilePairs } from '@/lib/historical-file-pairing'
import { CheckCircle2, Files, ListChecks } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

type PreparedBatch = { id: number; pairs: HistoricalSourcePair[]; defaults: HistoricalImportDefaults }

function BatchPairCard({ pair, defaults, register, report }: {
  pair: HistoricalSourcePair
  defaults: HistoricalImportDefaults
  register: (id: string, handle: ImportJobFormHandle | null) => void
  report: (id: string, state: HistoricalImportFormState) => void
}) {
  const registerHandle = useCallback((handle: ImportJobFormHandle | null) => register(pair.id, handle), [pair.id, register])
  const reportState = useCallback((state: HistoricalImportFormState) => report(pair.id, state), [pair.id, report])
  return <ImportJobForm ref={registerHandle} sourcePair={pair} defaults={defaults} batch onStateChange={reportState}/>
}

export function HistoricalOnboardingWorkspace({ initialReadyCount }: { initialReadyCount: number }) {
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [estimateFiles, setEstimateFiles] = useState<File[]>([])
  const [actualFiles, setActualFiles] = useState<File[]>([])
  const [pairOverrides, setPairOverrides] = useState<Record<number, string>>({})
  const [prepared, setPrepared] = useState<PreparedBatch | null>(null)
  const [batchId, setBatchId] = useState(0)
  const [baseline, setBaseline] = useState<HistoricalEstimateBaselineRole | ''>('')
  const [projectType, setProjectType] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [location, setLocation] = useState('')
  const [batchError, setBatchError] = useState('')
  const [batchBusy, setBatchBusy] = useState<'analyzing' | 'importing' | ''>('')
  const [states, setStates] = useState<Record<string, HistoricalImportFormState>>({})
  const handles = useRef(new Map<string, ImportJobFormHandle>())
  const proposals = useMemo(() => proposeHistoricalFilePairs(estimateFiles, actualFiles), [actualFiles, estimateFiles])

  const selectedActual = useCallback((estimateIndex: number) => {
    const override = pairOverrides[estimateIndex]
    if (override !== undefined) return override === '' ? undefined : Number(override)
    return proposals[estimateIndex]?.actualIndex
  }, [pairOverrides, proposals])

  const register = useCallback((id: string, handle: ImportJobFormHandle | null) => {
    if (handle) handles.current.set(id, handle)
    else handles.current.delete(id)
  }, [])
  const report = useCallback((id: string, state: HistoricalImportFormState) => {
    setStates(current => {
      const previous = current[id]
      if (previous && previous.analyzed === state.analyzed && previous.ready === state.ready && previous.busy === state.busy && previous.completed === state.completed && previous.error === state.error) return current
      return { ...current, [id]: state }
    })
  }, [])

  function selectFiles(kind: 'estimate' | 'actual', list: FileList | null) {
    const files = [...(list ?? [])]
    if (files.length > 10) { setBatchError(`Choose at most 10 ${kind} files per batch.`); return }
    if (files.some(file => !/\.(?:csv|xlsx)$/i.test(file.name))) { setBatchError('Batch onboarding accepts only CSV and XLSX files.'); return }
    if (kind === 'estimate') setEstimateFiles(files)
    else setActualFiles(files)
    setPairOverrides({}); setPrepared(null); setStates({}); handles.current.clear(); setBatchError('')
  }

  function prepareBatch() {
    if (!estimateFiles.length || !actualFiles.length) { setBatchError('Choose estimate and actual-cost files first.'); return }
    if (!baseline) { setBatchError('Choose the comparison baseline that applies to this batch. You can correct individual jobs before analysis.'); return }
    const used = new Set<number>(), pairs: HistoricalSourcePair[] = []
    for (const [estimateIndex, estimateFile] of estimateFiles.entries()) {
      const actualIndex = selectedActual(estimateIndex)
      if (actualIndex === undefined) continue
      if (used.has(actualIndex)) { setBatchError('Each actual-cost file can be paired with only one estimate.'); return }
      used.add(actualIndex)
      pairs.push({ id: `historical-batch-${batchId}-${estimateIndex}-${actualIndex}`, estimateFile, actualFile: actualFiles[actualIndex] })
    }
    if (!pairs.length) { setBatchError('Pair at least one estimate with its actual-cost file.'); return }
    setPrepared({ id: batchId, pairs, defaults: { estimateBaselineRole: baseline, ...(projectType ? { projectType } : {}), ...(customerType ? { customerType } : {}), ...(location ? { location } : {}) } })
    setBatchId(value => value + 1); setStates({}); handles.current.clear(); setBatchError('')
  }

  async function analyzeAll() {
    if (!prepared) return
    setBatchBusy('analyzing'); setBatchError('')
    for (const pair of prepared.pairs) {
      if (!states[pair.id]?.completed && !states[pair.id]?.analyzed) await handles.current.get(pair.id)?.analyze()
    }
    setBatchBusy('')
  }

  async function importReady() {
    if (!prepared) return
    const ready = prepared.pairs.filter(pair => handles.current.get(pair.id)?.isReady())
    if (!ready.length) { setBatchError('No reviewed jobs are ready. Complete the highlighted metadata, actual-completeness, and scope decisions first.'); return }
    setBatchBusy('importing'); setBatchError('')
    for (const pair of ready) await handles.current.get(pair.id)?.importJob()
    setBatchBusy('')
  }

  function resetBatch() {
    setEstimateFiles([]); setActualFiles([]); setPairOverrides({}); setPrepared(null); setStates({}); handles.current.clear(); setBaseline(''); setBatchError(''); setBatchBusy('')
  }

  const pairedActuals = new Set(proposals.map((_, estimateIndex) => selectedActual(estimateIndex)).filter((value): value is number => value !== undefined))
  const completedCount = prepared?.pairs.filter(pair => states[pair.id]?.completed).length ?? 0
  const readyCount = prepared?.pairs.filter(pair => states[pair.id]?.ready).length ?? 0

  return <>
    <div className="onboarding-mode" aria-label="Historical onboarding mode">
      <button type="button" className={`card flat ${mode === 'single' ? 'selected' : ''}`} onClick={() => setMode('single')}><ListChecks size={20}/><span><strong>One completed job</strong><span className="helper">Review one estimate and actual pair.</span></span></button>
      <button type="button" className={`card flat ${mode === 'batch' ? 'selected' : ''}`} onClick={() => setMode('batch')}><Files size={20}/><span><strong>Several completed jobs</strong><span className="helper">Pair up to 10 jobs and work only the exceptions.</span></span></button>
    </div>
    {mode === 'single' ? <ImportJobForm initialReadyCount={initialReadyCount}/> : <section className="batch-onboarding">
      {!prepared && <div className="card form-card">
        <div className="eyebrow">1 · Select and pair records</div><h2>Bring in a focused set of comparable jobs</h2>
        <p className="subtle">Choose 3–5 recent jobs similar to upcoming work. Suggested file pairs are never committed until you review them.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="batch-estimates">Estimate files</label><div className="file-drop"><input id="batch-estimates" type="file" accept=".xlsx,.csv" multiple onChange={event => selectFiles('estimate', event.currentTarget.files)}/><div className="helper">Up to 10 XLSX or UTF-8 CSV files</div></div></div>
          <div className="field"><label htmlFor="batch-actuals">Final actual-cost files</label><div className="file-drop"><input id="batch-actuals" type="file" accept=".xlsx,.csv" multiple onChange={event => selectFiles('actual', event.currentTarget.files)}/><div className="helper">Up to 10 XLSX or UTF-8 CSV files</div></div></div>
        </div>
        {estimateFiles.length > 0 && actualFiles.length > 0 && <>
          <div className="batch-pair-table" aria-label="Proposed historical file pairs">{estimateFiles.map((estimate, estimateIndex) => {
            const selected = selectedActual(estimateIndex)
            const suggested = proposals[estimateIndex]?.confidence === 'confident' && selected === proposals[estimateIndex]?.actualIndex
            return <div className="batch-pair-row" key={`${estimate.name}-${estimateIndex}`}><div><strong>{estimate.name}</strong><span className="helper">Estimate</span></div><div className="field"><label htmlFor={`batch-actual-${estimateIndex}`}>Matching actuals</label><select id={`batch-actual-${estimateIndex}`} value={selected ?? ''} onChange={event => setPairOverrides(current => ({ ...current, [estimateIndex]: event.currentTarget.value }))}><option value="">Choose actual-cost file</option>{actualFiles.map((actual, actualIndex) => <option value={actualIndex} key={`${actual.name}-${actualIndex}`}>{actual.name}</option>)}</select>{suggested && <span className="helper">Suggested from the shared filename</span>}</div></div>
          })}</div>
          {actualFiles.filter((_, index) => !pairedActuals.has(index)).length > 0 && <p className="helper">Unpaired actual files: {actualFiles.filter((_, index) => !pairedActuals.has(index)).map(file => file.name).join(' · ')}</p>}
          <section className="batch-defaults"><h3>Shared values for this batch</h3><p className="helper">Apply only values that genuinely describe every selected job. Each value remains editable before import.</p><div className="form-grid">
            <div className="field"><label htmlFor="batch-baseline">Comparison baseline</label><select id="batch-baseline" required value={baseline} onChange={event => setBaseline(event.currentTarget.value as HistoricalEstimateBaselineRole)}><option value="" disabled>Choose for this batch</option><option value="final_submitted">Final submitted bid</option><option value="original_bid">Original bid</option><option value="historical_unknown">Not sure / limited history</option></select></div>
            <div className="field"><label htmlFor="batch-project-type">Project type (optional)</label><select id="batch-project-type" value={projectType} onChange={event => setProjectType(event.currentTarget.value)}><option value="">Use filename suggestion or choose per job</option>{historicalProjectTypes.map(value => <option key={value}>{value}</option>)}</select></div>
            <div className="field"><label htmlFor="batch-customer-type">Customer type (optional)</label><select id="batch-customer-type" value={customerType} onChange={event => setCustomerType(event.currentTarget.value)}><option value="">Use filename suggestion or choose per job</option>{historicalCustomerTypes.map(value => <option key={value}>{value}</option>)}</select></div>
            <div className="field"><label htmlFor="batch-location">Location (optional)</label><input id="batch-location" value={location} onChange={event => setLocation(event.currentTarget.value)} placeholder="Philadelphia, PA"/></div>
          </div></section>
        </>}
        {batchError && <div className="error" role="alert">{batchError}</div>}
        <div className="actions"><button type="button" className="btn primary" disabled={!estimateFiles.length || !actualFiles.length} onClick={prepareBatch}>Prepare paired reviews</button></div>
      </div>}
      {prepared && <>
        <div className="card batch-toolbar"><div><div className="eyebrow">Batch review</div><h2>{completedCount} imported · {readyCount} ready · {prepared.pairs.length - completedCount - readyCount} need review</h2><p className="helper">Every job keeps its own expiring review contract. Analysis and imports run one at a time.</p></div><div className="actions"><button type="button" className="btn" disabled={Boolean(batchBusy)} onClick={analyzeAll}>{batchBusy === 'analyzing' ? 'Analyzing pairs…' : 'Analyze all pairs'}</button><button type="button" className="btn primary" disabled={Boolean(batchBusy) || !readyCount} onClick={importReady}>{batchBusy === 'importing' ? 'Importing ready jobs…' : `Import ${readyCount} ready ${readyCount === 1 ? 'job' : 'jobs'}`}</button><button type="button" className="btn small" disabled={Boolean(batchBusy)} onClick={resetBatch}>Start another batch</button></div></div>
        {completedCount === prepared.pairs.length && <div className="success"><CheckCircle2 size={18}/>All reviewed jobs in this batch were imported.</div>}
        {batchError && <div className="error" role="alert">{batchError}</div>}
        <div className="batch-review-list">{prepared.pairs.map(pair => <BatchPairCard key={pair.id} pair={pair} defaults={prepared.defaults} register={register} report={report}/>)}</div>
      </>}
    </section>}
  </>
}
