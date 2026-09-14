'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { SearchCheck } from 'lucide-react'
import { ImportPreview } from './import-preview'

export function UploadEstimateForm({parentEstimateId}:{parentEstimateId?:string}){
  const router=useRouter(); const formRef=useRef<HTMLFormElement>(null);const [busy,setBusy]=useState(false); const [error,setError]=useState('');const[previewReady,setPreviewReady]=useState(false);const[previewRevision,setPreviewRevision]=useState(0)
  function fileChanged(){setPreviewReady(false);setPreviewRevision(value=>value+1)}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!previewReady){setError('Preview the selected estimate and review any limitations before starting Margin Check.');return}setBusy(true);setError('');const form=new FormData(event.currentTarget);const res=await fetch('/api/estimates/review',{method:'POST',body:form});const data=await res.json();if(!res.ok){setError(data.error||'Could not review estimate.');setBusy(false);return}const warning=(data.warnings as string[]|undefined)?.join(' ');router.push(`/estimates/${data.estimate.id}${warning?`?warning=${encodeURIComponent(warning)}`:''}`);router.refresh()}
  return <form ref={formRef} className="card form-card" onSubmit={submit}>
    <div className="form-grid">
      {parentEstimateId&&<input type="hidden" name="parentEstimateId" value={parentEstimateId}/>}<input type="hidden" name="baselineRole" value={parentEstimateId?'revision':'original_bid'}/>
      {parentEstimateId&&<div className="field full"><div className="warning-banner">This upload creates a new immutable revision linked to the earlier estimate. It will not overwrite the original bid or its evidence.</div></div>}
      <div className="field full"><label>Estimate spreadsheet</label><div className="file-drop"><input name="estimateFile" type="file" accept=".xlsx,.csv" required onChange={fileChanged}/><div className="helper">XLSX or CSV. Recommended columns: category, description, estimated cost, estimated hours.</div></div></div>
      <ImportPreview key={previewRevision} formRef={formRef} mode="estimate" onReady={setPreviewReady}/>
      <div className="field"><label>Project name</label><input name="name" placeholder="Riverside Office – Level 3" required/></div>
      <div className="field"><label>Project type</label><select name="projectType" defaultValue="Office retrofit"><option>Office retrofit</option><option>Retail retrofit</option><option>Multifamily retrofit</option><option>Warehouse lighting</option><option>Restaurant fit-out</option><option>New construction</option></select></div>
      <div className="field"><label>Customer type</label><select name="customerType"><option>Commercial</option><option>Residential</option><option>Public</option></select></div>
      <div className="field"><label>Location</label><input name="location" placeholder="Philadelphia, PA"/></div>
      <div className="field"><label>Bid due</label><input name="bidDue" type="date"/></div>
      <div className="field"><label>Tags</label><input name="tags" placeholder="occupied, retrofit, conduit-reuse"/></div>
      <div className="field full"><label>Project documents (optional)</label><div className="file-drop"><input name="projectDocuments" type="file" accept=".pdf,.txt,.md" multiple onChange={fileChanged}/><div className="helper">Up to 5 PDFs/TXT/MD files. Margin Check can review relevant addenda, schedules, scope notes, and specifications.</div></div></div><div className="field full"><label>Assumptions / exclusions</label><textarea name="assumptions" placeholder={'One per line\nExisting conduit can be reused where accessible\nNormal daytime access to work areas'}/><div className="helper">Paste the assumptions you would normally carry in the bid so the review can account for them.</div></div>
    </div>
    {error&&<div className="error" style={{marginTop:14}}>{error}</div>}
    <div className="actions" style={{marginTop:18}}><button className="btn primary" disabled={busy}><SearchCheck size={16}/>{busy?'Running Margin Check…':'Review estimate'}</button></div>
  </form>
}
