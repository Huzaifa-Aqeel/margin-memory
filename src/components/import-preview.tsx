'use client'

import { forwardRef, useEffect, useImperativeHandle, useState, type RefObject } from 'react'
import type { HistoricalImportMetadataSuggestion } from '@/lib/historical-import-metadata'
import type { ImportIssue, ImportMappingField, ImportMappingSelection, ImportPairReport, SpreadsheetImportReport } from '@/lib/spreadsheet'

export type PreviewResult = {
  reports: SpreadsheetImportReport[]
  issues: ImportIssue[]
  completeness?: ImportPairReport['completeness']
  requiresReview: boolean
  requiresActualCompletenessConfirmation?: boolean
  canImport: boolean
  review?: { id: string; reportHash: string; expiresAt: string }
  metadataSuggestions?: HistoricalImportMetadataSuggestion
}

const fieldLabels: Record<ImportMappingField, string> = {
  rowType: 'row type', description: 'description', category: 'category', costCode: 'cost code', phase: 'phase', division: 'division',
  cost: 'row total', laborCost: 'labor cost', materialCost: 'material cost', equipmentCost: 'equipment cost',
  subcontractorCost: 'subcontract cost', otherCost: 'other cost', hours: 'labor hours', fieldLaborHours: 'field labor hours',
  shopLaborHours: 'shop labor hours', indirectLaborHours: 'indirect labor hours', quantity: 'quantity',
  unitCost: 'unit cost', materialUnitCost: 'material unit cost', laborRate: 'labor rate', unit: 'unit',
}

function money(value: number) { return `$${(Math.round(value * 100) / 100).toLocaleString()}` }

function ReportSummary({ report }: { report: SpreadsheetImportReport }) {
  const reconciliation = report.totalReconciliation
  return <section className="import-source-summary" aria-label={`${report.kind} import summary`}>
    <h3>{report.kind === 'estimate' ? 'Estimate' : 'Actuals'}</h3>
    <div className="import-check-list">
      <span>✓ {report.importedRows.toLocaleString()} detail {report.importedRows === 1 ? 'row' : 'rows'} recognized</span>
      <span>✓ {report.laborHourCoverage === 'present' ? `${Math.round(report.totalHours * 100) / 100} labor hours found` : 'Cost detail found; labor hours are not present'}</span>
      {reconciliation.state === 'matched' && <span>✓ Source total reconciles at {money(report.normalizedDetailTotal)}</span>}
      {reconciliation.state === 'within_tolerance' && <span>✓ Source total reconciles within normal rounding tolerance</span>}
      {reconciliation.state === 'not_available' && <span>Source total was not available for comparison</span>}
      {report.skippedSummaryRows > 0 && <span>✓ {report.skippedSummaryRows} total or subtotal {report.skippedSummaryRows === 1 ? 'row' : 'rows'} excluded</span>}
    </div>
    <details className="import-source-details">
      <summary>View source details</summary>
      <div className="helper">{report.fileName} · {report.sheetName || 'No worksheet selected'} · header row {report.headerRow || 'unresolved'}</div>
      <div className="helper">Worksheets: {report.worksheets.map(sheet => `${sheet.name}${sheet.hidden ? ' (hidden)' : ''}${sheet.selected ? ' (selected)' : ''}`).join(' · ')}</div>
      <div className="helper">{report.worksheetSelectionRationale}</div>
      <div className="helper">Columns used: {Object.entries(report.mappedColumns).filter(([, value]) => value).map(([field, value]) => `${fieldLabels[field as ImportMappingField]} → ${value}`).join(' · ') || 'none'}</div>
      <div className="helper">Categories: {Object.entries(report.categoryCounts).filter(([, count]) => count).map(([category, count]) => `${category} ${count}`).join(' · ') || 'none'}</div>
      <div className="helper">Source total: {report.sourceReportedTotal === null ? 'not available' : money(report.sourceReportedTotal)} · Imported detail total: {money(report.normalizedDetailTotal)} · Difference: {reconciliation.absoluteDifference === null ? 'not available' : money(reconciliation.absoluteDifference)} · Status: {reconciliation.state.replaceAll('_', ' ')}</div>
      {report.excludedRows.length > 0 && <details><summary>{report.excludedRows.length} excluded rows with reasons</summary><div className="helper">{report.excludedRows.map(row => `row ${row.sourceRow}: ${row.reason}${row.description ? ` (${row.description})` : ''}`).join(' · ')}</div></details>}
      {report.malformedCells.length > 0 && <div className="error">Malformed cells: {report.malformedCells.map(cell => `row ${cell.sourceRow}, ${cell.column}: ${cell.reason}`).join(' · ')}</div>}
    </details>
  </section>
}

export function ImportPreviewSummary({ preview, onReady }: { preview: PreviewResult; onReady: (ready: boolean) => void }) {
  const [reviewed, setReviewed] = useState(false)
  const [actualComplete, setActualComplete] = useState(false)
  const materialIssues = preview.issues.filter(issue => issue.severity !== 'info' && issue.code !== 'actual_completeness_confirmation')
  const reviewableWarnings = materialIssues.some(issue => issue.severity === 'warning')
  useEffect(() => onReady(Boolean(preview.review) && preview.canImport && (!reviewableWarnings || reviewed) && (!preview.requiresActualCompletenessConfirmation || actualComplete)), [actualComplete, onReady, preview.canImport, preview.requiresActualCompletenessConfirmation, preview.review, reviewed, reviewableWarnings])
  return <div className="card flat" aria-label="Import preview">
    {preview.review && <><input type="hidden" name="importReviewId" value={preview.review.id}/><input type="hidden" name="importReportHash" value={preview.review.reportHash}/></>}
    <div className="import-summary-grid">{preview.reports.map(report => <ReportSummary report={report} key={report.kind}/>)}</div>
    {preview.completeness && <div className={preview.completeness.state === 'incomplete' ? 'warning-banner' : 'success'}><div>
      <strong>{preview.completeness.state === 'complete' ? 'Actual cost coverage is complete.' : 'Actual export appears incomplete.'}</strong>{' '}
      {[
        preview.completeness.missingActualCategories.length ? `Missing categories: ${preview.completeness.missingActualCategories.join(', ')}` : '',
        preview.completeness.missingActualCostCodes.length ? `Missing cost codes: ${preview.completeness.missingActualCostCodes.join(', ')}` : '',
        preview.completeness.missingActualPhases.length ? `Missing phases: ${preview.completeness.missingActualPhases.join(', ')}` : '',
        preview.completeness.missingActualDivisions.length ? `Missing divisions: ${preview.completeness.missingActualDivisions.join(', ')}` : '',
        preview.completeness.costCodeCoverage === 'unavailable' ? 'Actual export has no cost-code structure.' : '',
        preview.completeness.phaseCoverage === 'unavailable' ? 'Actual export has no phase structure.' : '',
        preview.completeness.divisionCoverage === 'unavailable' ? 'Actual export has no division structure.' : '',
      ].filter(Boolean).join(' · ') || 'Every expected estimate category and available cost-code or phase detail is represented.'}
      {preview.completeness.state === 'incomplete' && <div className="helper" style={{ marginTop: 5 }}>You may archive this job as limited history, but it cannot be used for numerical historical evidence while actual coverage is unresolved.</div>}
    </div></div>}
    {materialIssues.length > 0 ? <section className="import-exceptions"><strong>{materialIssues.length} {materialIssues.length === 1 ? 'item needs' : 'items need'} your review</strong><div className="list">{materialIssues.map((issue, index) => <div className={issue.severity === 'error' ? 'error' : 'warning-banner'} key={`${issue.code}-${index}`}>{issue.message}</div>)}</div></section> : preview.canImport && <div className="helper" style={{ marginTop: 12 }}>No mapping or reconciliation exceptions need attention.</div>}
    {preview.canImport && reviewableWarnings && <label className="import-confirmation"><input type="checkbox" name="importReviewed" value="true" checked={reviewed} onChange={event => setReviewed(event.currentTarget.checked)}/>{preview.completeness?.state === 'incomplete' ? 'I understand these specific limitations and want to archive this job without using it for numerical comparisons.' : 'I reviewed these specific limitations and want to continue.'}</label>}
    {preview.canImport && preview.requiresActualCompletenessConfirmation && <label className="import-confirmation"><input type="checkbox" name="actualCompletenessConfirmed" value="true" checked={actualComplete} onChange={event => setActualComplete(event.currentTarget.checked)}/>I confirm this is the final and complete actual-cost export, including every posted cost category and transaction.</label>}
    {!preview.canImport && <p className="helper" style={{ marginTop: 12 }}>Resolve the highlighted source choice or correct the source file, then analyze it again. Financial integrity errors cannot be approved.</p>}
  </div>
}

export type ImportPreviewHandle = { inspect: () => Promise<boolean> }

type ImportPreviewProps = {
  formRef?: RefObject<HTMLFormElement | null>
  getFormData?: () => FormData | null
  mode: 'estimate' | 'actual' | 'pair'
  onReady: (ready: boolean) => void
  onAnalysis?: (preview: PreviewResult | null) => void
  disabled?: boolean
}

export const ImportPreview = forwardRef<ImportPreviewHandle, ImportPreviewProps>(function ImportPreview({ formRef, getFormData, mode, onReady, onAnalysis, disabled = false }, ref) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [worksheets, setWorksheets] = useState<{ estimate?: string; actual?: string }>({})
  const [mappings, setMappings] = useState<{ estimate?: ImportMappingSelection; actual?: ImportMappingSelection }>({})
  async function inspect() {
    const body = getFormData?.() ?? (formRef?.current ? new FormData(formRef.current) : null)
    if (!body || disabled) return false
    setBusy(true); setError(''); setPreview(null); onAnalysis?.(null); onReady(false)
    try {
      body.set('mode', mode)
      if (worksheets.estimate) body.set('estimateWorksheet', worksheets.estimate)
      if (worksheets.actual) body.set('actualWorksheet', worksheets.actual)
      if (mappings.estimate && Object.keys(mappings.estimate).length) body.set('estimateMapping', JSON.stringify(mappings.estimate))
      if (mappings.actual && Object.keys(mappings.actual).length) body.set('actualMapping', JSON.stringify(mappings.actual))
      const response = await fetch('/api/import/preview', { method: 'POST', body })
      const data = await response.json() as PreviewResult & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Could not analyze spreadsheets.')
      setPreview(data); onAnalysis?.(data)
      if (data.canImport && !data.requiresReview) onReady(true)
      return true
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not analyze spreadsheets.'); return false }
    finally { setBusy(false) }
  }
  useImperativeHandle(ref, () => ({ inspect }))
  const hasSourceChoice = Boolean(preview?.reports.some(report => !report.sheetName && report.worksheets.some(sheet => sheet.plausible && !sheet.hidden)))
  const hasMappingChoice = Boolean(preview?.reports.some(report => preview.issues.some(issue => issue.code === 'ambiguous_mapping') && Object.values(report.mappingOptions ?? {}).some(options => (options?.length ?? 0) > 1)))
  const analyzeLabel = mode === 'pair' ? 'Analyze estimate and actuals' : mode === 'estimate' ? 'Analyze estimate' : 'Analyze actuals'
  const busyLabel = mode === 'pair' ? 'Analyzing estimate and actuals…' : mode === 'estimate' ? 'Analyzing estimate…' : 'Analyzing actuals…'
  return <div className="field full">
    <button type="button" className="btn" onClick={inspect} disabled={busy || disabled}>{busy ? busyLabel : analyzeLabel}</button>
    {disabled && <p className="helper">Confirm what the estimate file represents before analysis.</p>}
    {error && <div className="error" role="alert">{error}</div>}
    {preview?.reports.map(report => !report.sheetName && report.worksheets.some(sheet => sheet.plausible && !sheet.hidden) ? <fieldset className="card flat" key={`select-${report.kind}`}><legend>Which worksheet contains the {report.kind === 'estimate' ? 'submitted estimate' : 'final actual costs'}?</legend>{report.worksheets.filter(sheet => sheet.plausible && !sheet.hidden).map(sheet => <label key={sheet.name} className="import-choice"><input type="radio" name={`${report.kind}WorksheetChoice`} checked={worksheets[report.kind] === sheet.name} onChange={() => { setWorksheets(current => ({ ...current, [report.kind]: sheet.name })); onReady(false) }}/>{sheet.name}</label>)}<p className="helper">Only the selected visible worksheet will be used. If actual costs are split across sheets, export one consolidated worksheet.</p></fieldset> : null)}
    {preview?.reports.map(report => preview.issues.some(issue => issue.code === 'ambiguous_mapping') ? (Object.entries(report.mappingOptions ?? {}) as Array<[ImportMappingField, Array<{ header: string; column: number }>]>).filter(([, options]) => options.length > 1).map(([field, options]) => <fieldset className="card flat" key={`${report.kind}-${field}`}><legend>Which {report.kind === 'estimate' ? 'estimate' : 'actual'} column contains {fieldLabels[field]}?</legend>{options.map(option => <label key={option.column} className="import-choice"><input type="radio" name={`${report.kind}-${field}-choice`} checked={mappings[report.kind]?.[field] === option.column} onChange={() => { setMappings(current => ({ ...current, [report.kind]: { ...current[report.kind], [field]: option.column } })); onReady(false) }}/><span><strong>{option.header}</strong> <span className="helper">column {option.column}</span></span></label>)}</fieldset>) : null)}
    {(hasSourceChoice || hasMappingChoice) && <button type="button" className="btn primary" onClick={inspect} disabled={busy || disabled}>Analyze selected source</button>}
    {preview && <ImportPreviewSummary preview={preview} onReady={onReady}/>} 
  </div>
})
