'use client'

import { useEffect, useState, type RefObject } from 'react'
import type { ImportIssue, ImportPairReport, SpreadsheetImportReport } from '@/lib/spreadsheet'

export type PreviewResult = { reports: SpreadsheetImportReport[]; issues: ImportIssue[]; completeness?: ImportPairReport['completeness']; requiresReview: boolean; requiresActualCompletenessConfirmation?: boolean; canImport: boolean;review?:{id:string;reportHash:string;expiresAt:string} }

export function ImportPreviewSummary({ preview, onReady }: { preview: PreviewResult; onReady: (ready: boolean) => void }) {
  const [reviewed,setReviewed]=useState(false)
  const [actualComplete,setActualComplete]=useState(false)
  const warnings=preview.issues.some(issue=>issue.severity==='warning')
  useEffect(()=>onReady(Boolean(preview.review)&&preview.canImport&&(!warnings||reviewed)&&(!preview.requiresActualCompletenessConfirmation||actualComplete)),[actualComplete,onReady,preview.canImport,preview.requiresActualCompletenessConfirmation,preview.review,reviewed,warnings])
  return <div className="card flat" aria-label="Import preview">
    {preview.review&&<><input type="hidden" name="importReviewId" value={preview.review.id}/><input type="hidden" name="importReportHash" value={preview.review.reportHash}/></>}
    {preview.reports.map((report) => <div key={report.kind} style={{ marginBottom: 12 }}>
      <strong>{report.kind === 'estimate' ? 'Estimate' : 'Actuals'}: {report.importedRows} detail rows · ${Math.round(report.totalCost).toLocaleString()} · {Math.round(report.totalHours * 100) / 100} hours</strong>
      <div className="helper">{report.fileName} · {report.sheetName||'No worksheet selected'} · header row {report.headerRow||'unresolved'} · {report.skippedSummaryRows} summary rows excluded</div>
      <div className="helper">Worksheets: {report.worksheets.map(sheet=>`${sheet.name}${sheet.hidden?' (hidden)':''}${sheet.selected?' (selected)':''}`).join(' · ')}</div>
      <div className="helper">{report.worksheetSelectionRationale}</div>
      <div className="helper">Mapped: {Object.entries(report.mappedColumns).filter(([, value]) => value).map(([field, value]) => `${field} → ${value}`).join(' · ') || 'none'}</div>
      <div className="helper">Categories: {Object.entries(report.categoryCounts).filter(([, count]) => count).map(([category, count]) => `${category} ${count}`).join(' · ') || 'none'}</div>
      <div className="helper">Source reported total: {report.sourceReportedTotal===null?'not available':`$${report.sourceReportedTotal.toLocaleString()}`} · Normalized imported total: ${report.normalizedDetailTotal.toLocaleString()} · Difference: {report.totalReconciliation.absoluteDifference===null?'not available':`$${report.totalReconciliation.absoluteDifference.toLocaleString()}`} · Reconciliation: {report.totalReconciliation.state.replaceAll('_',' ')}</div>
      {report.excludedRows.length>0&&<details><summary>{report.excludedRows.length} excluded rows with reasons</summary><div className="helper">{report.excludedRows.map(row=>`row ${row.sourceRow}: ${row.reason}${row.description?` (${row.description})`:''}`).join(' · ')}</div></details>}
      {report.malformedCells.length>0&&<div className="error">Malformed cells: {report.malformedCells.map(cell=>`row ${cell.sourceRow}, ${cell.column}: ${cell.reason}`).join(' · ')}</div>}
    </div>)}
    {preview.completeness&&<div className={preview.completeness.state==='incomplete'?'warning-banner':'helper'}>Actual coverage: {preview.completeness.state}. {[
      preview.completeness.missingActualCategories.length?`Missing categories: ${preview.completeness.missingActualCategories.join(', ')}`:'',
      preview.completeness.missingActualCostCodes.length?`Missing cost codes: ${preview.completeness.missingActualCostCodes.join(', ')}`:'',
      preview.completeness.missingActualPhases.length?`Missing phases: ${preview.completeness.missingActualPhases.join(', ')}`:'',
      preview.completeness.missingActualDivisions.length?`Missing divisions: ${preview.completeness.missingActualDivisions.join(', ')}`:'',
      preview.completeness.costCodeCoverage==='unavailable'?'Actual export has no cost-code structure.':'',
      preview.completeness.phaseCoverage==='unavailable'?'Actual export has no phase structure.':'',
      preview.completeness.divisionCoverage==='unavailable'?'Actual export has no division structure.':'',
    ].filter(Boolean).join(' · ')||'All expected estimate categories and available structured dimensions are represented in the actuals.'}{preview.completeness.state==='incomplete'?' Choose “Not sure — archive without using it for comparisons” below unless the source is corrected.':''}</div>}
    {preview.issues.length ? <><strong>{preview.issues.filter(issue=>issue.severity!=='info').length} {preview.issues.filter(issue=>issue.severity!=='info').length===1?'thing needs':'things need'} your attention</strong><div className="list">{preview.issues.map((issue, index) => <div className={issue.severity === 'error' ? 'error' : issue.severity==='warning'?'warning-banner':'helper'} key={`${issue.code}-${index}`}>{issue.message}</div>)}</div></> : <div className="success">Ready to import. Detail rows are normalized, summary rows are excluded, and source totals reconcile.</div>}
    {preview.canImport && warnings && <label style={{ display: 'flex', gap: 8, marginTop: 12 }}><input type="checkbox" name="importReviewed" value="true" checked={reviewed} onChange={event=>setReviewed(event.currentTarget.checked)}/>I reviewed these specific limitations and want to continue.</label>}
    {preview.canImport&&preview.requiresActualCompletenessConfirmation&&<label style={{display:'flex',gap:8,marginTop:12}}><input type="checkbox" name="actualCompletenessConfirmed" value="true" checked={actualComplete} onChange={event=>setActualComplete(event.currentTarget.checked)}/>I confirm this is the final and complete actual-cost export, including every posted cost category and transaction.</label>}
    {!preview.canImport && <p className="helper" style={{ marginTop: 12 }}>Correct the errors in the source file, select it again, then preview it before importing.</p>}
  </div>
}

export function ImportPreview({ formRef, mode, onReady }: { formRef: RefObject<HTMLFormElement | null>; mode: 'estimate' | 'actual' | 'pair'; onReady: (ready: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [worksheets,setWorksheets]=useState<{estimate?:string;actual?:string}>({})
  async function inspect() {
    const form = formRef.current
    if (!form) return
    setBusy(true); setError(''); setPreview(null); onReady(false)
    try {
      const body = new FormData(form); body.set('mode', mode)
      if(worksheets.estimate)body.set('estimateWorksheet',worksheets.estimate)
      if(worksheets.actual)body.set('actualWorksheet',worksheets.actual)
      const response = await fetch('/api/import/preview', { method: 'POST', body })
      const data = await response.json() as PreviewResult & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Could not preview spreadsheet.')
      setPreview(data)
      if (data.canImport && !data.requiresReview) onReady(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not preview spreadsheet.') }
    finally { setBusy(false) }
  }
  return <div className="field full">
    <button type="button" className="btn" onClick={inspect} disabled={busy}>{busy ? 'Inspecting files…' : 'Preview detected data'}</button>
    {error && <div className="error" role="alert">{error}</div>}
    {preview&&preview.reports.map(report=>!report.sheetName&&report.worksheets.some(sheet=>sheet.plausible&&!sheet.hidden)?<fieldset className="card flat" key={`select-${report.kind}`}><legend>Choose the {report.kind==='estimate'?'estimate':'actual-cost'} worksheet</legend>{report.worksheets.filter(sheet=>sheet.plausible&&!sheet.hidden).map(sheet=><label key={sheet.name} style={{display:'flex',gap:8,marginTop:8}}><input type="radio" name={`${report.kind}WorksheetChoice`} checked={worksheets[report.kind]===sheet.name} onChange={()=>{setWorksheets(current=>({...current,[report.kind]:sheet.name}));onReady(false)}}/>{sheet.name}</label>)}<p className="helper">Select a visible worksheet, then preview again. If actual costs are split across sheets, export one consolidated worksheet.</p></fieldset>:null)}
    {preview && <ImportPreviewSummary preview={preview} onReady={onReady}/>} 
  </div>
}
