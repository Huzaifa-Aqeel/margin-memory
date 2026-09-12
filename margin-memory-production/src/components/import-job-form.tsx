'use client'

import { ScopeReviewFields } from './scope-review-fields'
import { ImportPreview } from './import-preview'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArchiveRestore } from 'lucide-react'

export function ImportJobForm(){
  const router=useRouter();const formRef=useRef<HTMLFormElement>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[success,setSuccess]=useState('');const[previewReady,setPreviewReady]=useState(false);const[previewRevision,setPreviewRevision]=useState(0)
  function filesChanged(){setPreviewReady(false);setPreviewRevision(value=>value+1)}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!previewReady){setError('Preview the selected files and review any limitations before importing.');return}setBusy(true);setError('');setSuccess('');const res=await fetch('/api/jobs/import',{method:'POST',body:new FormData(event.currentTarget)});const data=await res.json();if(!res.ok){setError(data.error||'Import failed.');setBusy(false);return}const base=data.lesson?'Job imported. Margin Memory proposed a lesson for confirmation.':'Job imported and variance calculated.';const warnings=(data.warnings as string[]|undefined)?.join(' ');setSuccess(warnings?`${base} ${warnings}`:base);(event.currentTarget).reset();setPreviewReady(false);setPreviewRevision(value=>value+1);router.refresh();setBusy(false)}
  return <form ref={formRef} className="card form-card" onSubmit={submit}><div className="form-grid">
    <div className="field"><label>Job name</label><input name="name" required placeholder="Baker Office Renovation"/></div>
    <div className="field"><label>Project type</label><select name="projectType" defaultValue="Office retrofit"><option>Office retrofit</option><option>Retail retrofit</option><option>Multifamily retrofit</option><option>Warehouse lighting</option><option>Restaurant fit-out</option><option>New construction</option></select></div>
    <div className="field"><label>Customer type</label><select name="customerType"><option>Commercial</option><option>Residential</option><option>Public</option></select></div><div className="field"><label>Location</label><input name="location" placeholder="Philadelphia, PA"/></div>
    <div className="field"><label>Completed date</label><input type="date" name="completedAt" required/></div>
    <div className="field"><label>Estimate baseline</label><select name="estimateBaselineRole" defaultValue="historical_unknown" onChange={filesChanged}><option value="final_submitted">Final submitted bid</option><option value="original_bid">Original bid</option><option value="historical_unknown">Historical baseline / unknown</option></select><div className="helper">Choose the commercial estimate that the actual job should be compared against.</div></div>
    <div className="field full"><label>Tags</label><input name="tags" placeholder="occupied, retrofit, after-hours"/></div>
    <div className="field"><label>Original estimate</label><div className="file-drop"><input name="estimateFile" type="file" accept=".xlsx,.csv" required onChange={filesChanged}/><div className="helper">XLSX or CSV</div></div></div>
    <div className="field"><label>Actual job costs</label><div className="file-drop"><input name="actualFile" type="file" accept=".xlsx,.csv" required onChange={filesChanged}/><div className="helper">XLSX or CSV</div></div></div>
    <ImportPreview key={previewRevision} formRef={formRef} mode="pair" onReady={setPreviewReady}/>
    <ScopeReviewFields/><div className="field full"><label>Closeout notes</label><textarea name="notes" placeholder="What changed? What surprised the crew? Why did labor or material differ?"/></div>
    <div className="field full"><label>Optional notes file</label><input name="notesFile" type="file" accept=".txt,.md,.pdf" onChange={filesChanged}/></div>
  </div>{error&&<div className="error" style={{marginTop:14}}>{error}</div>}{success&&<div className="success" style={{marginTop:14}}>{success}</div>}<div className="actions" style={{marginTop:18}}><button className="btn primary" disabled={busy}><ArchiveRestore size={16}/>{busy?'Reconciling…':'Import legacy job'}</button></div></form>
}
