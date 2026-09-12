'use client'

import Script from 'next/script'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ExternalLink, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ExcelEstimatePresentation, ExcelPreviewResponse } from '@/lib/integrations/excel-contract'
import { canonicalWorkbookLocation, EXCEL_SOURCE_ADAPTER_VERSION, type ExcelLiveSnapshot, type ExcelSourceSelection, type ExcelSnapshotCell } from '@/lib/integrations/excel-snapshot'

type PaneState='signed_out'|'ready'|'inspecting'|'source_selection'|'needs_review'|'ready_check'|'running'|'needs_input'|'findings'|'no_findings'|'error'
type SourceChoice={worksheetId:string;worksheetName:string;kind:'used_range'|'selection'|'table';tableId?:string;tableName?:string;label:string}
type Profile={name:string;projectType:string;customerType:string;location:string;bidDue:string;tags:string[];assumptions:string[]}

const post=async <T,>(url:string,body:unknown):Promise<T>=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json() as T&{error?:string};if(!response.ok)throw new Error(data.error||`Request failed (${response.status}).`);return data}
const sha256=async(value:string)=>{const bytes=new TextEncoder().encode(value);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
const workbookNameFromUrl=(url:string)=>{try{return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1)||'Excel estimate')}catch{return url.split(/[\\/]/).filter(Boolean).at(-1)||'Excel estimate'}}

async function discoverSources():Promise<SourceChoice[]>{
 return Excel.run(async context=>{
  const sheets=context.workbook.worksheets;sheets.load('items/id,name,visibility');await context.sync()
  const visible=sheets.items.filter(sheet=>sheet.visibility===Excel.SheetVisibility.visible)
  for(const sheet of visible)sheet.tables.load('items/id,name')
  await context.sync()
  return visible.flatMap(sheet=>[
   ...sheet.tables.items.map(table=>({worksheetId:sheet.id,worksheetName:sheet.name,kind:'table' as const,tableId:table.id,tableName:table.name,label:`${sheet.name} · table “${table.name}”`})),
   {worksheetId:sheet.id,worksheetName:sheet.name,kind:'used_range' as const,label:`${sheet.name} · used range`},
  ])
 })
}

async function selectedRangeChoice():Promise<SourceChoice>{
 return Excel.run(async context=>{const range=context.workbook.getSelectedRange();range.load('address');range.worksheet.load('id,name,visibility');await context.sync();if(range.worksheet.visibility!==Excel.SheetVisibility.visible)throw new Error('Hidden worksheets cannot be reviewed.');return{worksheetId:range.worksheet.id,worksheetName:range.worksheet.name,kind:'selection',label:`${range.worksheet.name} · ${range.address}`}})
}

async function captureSource(choice:SourceChoice):Promise<ExcelLiveSnapshot>{
 const documentUrl=Office.context.document.url
 if(!documentUrl)throw new Error('Save this workbook before running Margin Check so its revision identity can be preserved.')
 const documentUrlHash=await sha256(canonicalWorkbookLocation(documentUrl))
 return Excel.run(async context=>{
  const sheet=context.workbook.worksheets.getItem(choice.worksheetId);sheet.load('id,name,visibility')
  const range=choice.kind==='table'?sheet.tables.getItem(choice.tableId||choice.tableName!).getRange():choice.kind==='selection'?context.workbook.getSelectedRange():sheet.getUsedRange(true)
  range.load('address,rowCount,columnCount,values,text,formulas');await context.sync()
  if(sheet.visibility!==Excel.SheetVisibility.visible)throw new Error('Hidden worksheets cannot be reviewed.')
  if(choice.kind==='selection'&&sheet.id!==choice.worksheetId)throw new Error('The selected range moved to another worksheet. Select the intended source again.')
  const cells:ExcelSnapshotCell[][]=range.values.map((row,rowIndex)=>row.map((value,columnIndex)=>{
   const formulaValue=range.formulas[rowIndex]?.[columnIndex]
   const formula=typeof formulaValue==='string'&&formulaValue.startsWith('=')?formulaValue:null
   const safeValue=typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null?value:String(value??'')
   return{value:safeValue,text:String(range.text[rowIndex]?.[columnIndex]??''),formula}
  }))
  const selection:ExcelSourceSelection=choice.kind==='table'?{kind:'table',address:range.address,tableId:choice.tableId!,tableName:choice.tableName!}:choice.kind==='selection'?{kind:'selection',address:range.address}:{kind:'used_range',address:range.address}
  return{sourceType:'excel_live_snapshot',adapterVersion:EXCEL_SOURCE_ADAPTER_VERSION,workbook:{name:workbookNameFromUrl(documentUrl),documentUrlHash},worksheet:{id:sheet.id,name:sheet.name,visibility:'visible'},selection,rowCount:range.rowCount,columnCount:range.columnCount,cells,capturedAt:new Date().toISOString()}
 })
}

export function ExcelTaskPane({authenticated,workspaceName}:{authenticated:boolean;workspaceName?:string}){
 const[state,setState]=useState<PaneState>(authenticated?'ready':'signed_out');const[officeReady,setOfficeReady]=useState(false);const[officeError,setOfficeError]=useState('')
 const[choices,setChoices]=useState<SourceChoice[]>([]);const[choice,setChoice]=useState<SourceChoice>();const[snapshot,setSnapshot]=useState<ExcelLiveSnapshot>();const[preview,setPreview]=useState<ExcelPreviewResponse>();const[result,setResult]=useState<ExcelEstimatePresentation>();const[reviewed,setReviewed]=useState(false);const[error,setError]=useState('')
 const[profile,setProfile]=useState<Profile>({name:'Current Excel estimate',projectType:'Office retrofit',customerType:'Commercial',location:'',bidDue:'',tags:[],assumptions:[]})

 const startSignIn=()=>{const url=`${window.location.origin}/login?next=${encodeURIComponent('/integrations/excel/auth-complete')}`;if(typeof Office!=='undefined'&&Office.context.ui?.displayDialogAsync){Office.context.ui.displayDialogAsync(url,{height:65,width:45,displayInIframe:false},response=>{if(response.status!==Office.AsyncResultStatus.Succeeded){window.open(url,'_blank','noopener,noreferrer');return}const dialog=response.value;dialog.addEventHandler(Office.EventType.DialogMessageReceived,()=>{dialog.close();window.location.reload()})})}else window.open(url,'_blank','noopener,noreferrer')}

 const inspectChoice=useCallback(async(selected:SourceChoice)=>{try{setState('inspecting');setError('');setReviewed(false);setChoice(selected);const captured=await captureSource(selected);setSnapshot(captured);setProfile(current=>({...current,name:current.name==='Current Excel estimate'?captured.workbook.name.replace(/\.[^.]+$/,''):current.name}));const response=await post<ExcelPreviewResponse>('/api/integrations/excel/preview',{snapshot:captured,profile:{...profile,name:profile.name==='Current Excel estimate'?captured.workbook.name.replace(/\.[^.]+$/,''):profile.name,bidDue:profile.bidDue||null}});setPreview(response);setState(!response.canImport?'needs_review':response.requiresReview?'needs_review':'ready_check')}catch(cause){setError(cause instanceof Error?cause.message:'Could not inspect this workbook.');setState('error')}},[profile])

 const inspectWorkbook=useCallback(async()=>{try{setState('inspecting');setError('');const discovered=await discoverSources();setChoices(discovered);const visibleSheets=[...new Set(discovered.map(item=>item.worksheetId))];const tables=discovered.filter(item=>item.kind==='table');if(visibleSheets.length===1){if(tables.length===1)return inspectChoice(tables[0]);if(tables.length===0)return inspectChoice(discovered[0])}setState('source_selection')}catch(cause){setError(cause instanceof Error?cause.message:'Could not inspect this workbook.');setState('error')}},[inspectChoice])

 const runCheck=async()=>{if(!choice||!snapshot||!preview?.review)return;try{setState('running');setError('');const current=await captureSource(choice);const response=await post<{estimate:ExcelEstimatePresentation}>('/api/integrations/excel/check',{snapshot:current,reviewId:preview.review.id,reportHash:preview.review.reportHash,runId:preview.runId,reviewed});setResult(response.estimate);setState(response.estimate.result==='needs_input'?'needs_input':response.estimate.result==='findings'?'findings':response.estimate.result==='no_findings'?'no_findings':response.estimate.result==='failed'?'error':'running')}catch(cause){setError(cause instanceof Error?cause.message:'Margin Check failed.');setState('error')}}
 const answerQuestion=async(questionId:string,answer:string)=>{if(!result)return;try{setState('running');const response=await post<{estimate:ExcelEstimatePresentation}>(`/api/integrations/excel/estimates/${result.estimateId}`,{questionId,answer});setResult(response.estimate);setState(response.estimate.result==='needs_input'?'needs_input':response.estimate.result==='findings'?'findings':response.estimate.result==='no_findings'?'no_findings':'running')}catch(cause){setError(cause instanceof Error?cause.message:'Could not resume the review.');setState('error')}}

 useEffect(()=>{if(!officeReady||!authenticated)return;Office.onReady(info=>{if(info.host!==Office.HostType.Excel){setOfficeError('Open this task pane in Microsoft Excel.');return}setState('ready')})},[officeReady,authenticated])

 return <div className="excel-pane">
  <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" onLoad={()=>setOfficeReady(true)} onError={()=>setOfficeError('Office could not initialize. Check your connection and reopen the task pane.')}/>
  <header className="excel-head"><div className="brand"><span className="brand-mark">M</span><span>Margin Memory</span></div>{workspaceName&&<span className="excel-workspace">{workspaceName}</span>}</header>
  {state==='signed_out'&&<section className="excel-state centered"><ShieldCheck size={30}/><h1>Sign in to Margin Memory</h1><p>Your company history and findings stay inside your private workspace.</p><button className="btn primary" onClick={startSignIn}>Sign in <ArrowRight size={16}/></button></section>}
  {authenticated&&officeError&&<div className="error">{officeError}</div>}
  {state==='ready'&&<section className="excel-state"><p className="eyebrow">Pre-submit review</p><h1>Check this estimate before it goes out.</h1><p>Margin Memory will inspect only the worksheet, table, or range you choose. It will not change the workbook.</p><div className="excel-profile"><label>Estimate name<input value={profile.name} onChange={event=>setProfile({...profile,name:event.target.value})}/></label><label>Project type<input value={profile.projectType} onChange={event=>setProfile({...profile,projectType:event.target.value})}/></label><label>Customer type<input value={profile.customerType} onChange={event=>setProfile({...profile,customerType:event.target.value})}/></label><label>Location<input value={profile.location} onChange={event=>setProfile({...profile,location:event.target.value})}/></label></div><button className="btn primary" disabled={!officeReady||Boolean(officeError)} onClick={inspectWorkbook}><Search size={16}/>Inspect workbook</button></section>}
  {(state==='inspecting'||state==='running')&&<section className="excel-state centered"><LoaderCircle className="spin" size={30}/><h2>{state==='inspecting'?'Inspecting selected source':'Running preflight'}</h2><p>{state==='inspecting'?'Applying the same import checks used by Margin Memory.':'Checking trusted history and deterministic evidence. This may take a moment.'}</p></section>}
  {state==='source_selection'&&<section className="excel-state"><p className="eyebrow">Choose source</p><h1>What should Margin Memory review?</h1><p>Only the selected visible source will be transmitted. Hidden and unrelated sheets are excluded.</p><div className="excel-choice-list">{choices.map(item=><button key={`${item.worksheetId}:${item.kind}:${item.tableId||''}`} onClick={()=>inspectChoice(item)}><span>{item.label}</span><ArrowRight size={15}/></button>)}</div><button className="btn" onClick={async()=>inspectChoice(await selectedRangeChoice())}>Use currently selected cells</button></section>}
  {state==='needs_review'&&preview&&<section className="excel-state"><p className="eyebrow">Import review</p><h1>{preview.canImport?'Review the exceptions':'Source needs correction'}</h1><div className="excel-source-summary"><strong>{preview.source.worksheetName}</strong><span>{preview.source.selectionAddress}</span><span>{preview.report.importedRows} detail rows · {preview.report.skippedSummaryRows} totals excluded</span><span>Imported total: ${preview.report.normalizedDetailTotal.toLocaleString()}</span>{preview.report.sourceReportedTotal!==null&&<span>Source total: ${preview.report.sourceReportedTotal.toLocaleString()} · {preview.report.totalReconciliation.state.replaceAll('_',' ')}</span>}</div><div className="excel-issues">{preview.issues.map((issue,index)=><div key={`${issue.code}:${index}`} className={issue.severity==='error'?'issue error':'issue warning'}><AlertTriangle size={16}/><span><strong>{issue.severity==='error'?'Must fix':'Needs review'}</strong>{issue.message}</span></div>)}</div>{preview.canImport&&<label className="excel-review-check"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>I reviewed these specific exceptions and accept this interpretation.</span></label>}<div className="actions"><button className="btn" onClick={inspectWorkbook}><RefreshCw size={15}/>Refresh</button>{preview.canImport&&<button className="btn primary" disabled={!reviewed} onClick={()=>setState('ready_check')}>Continue</button>}</div></section>}
  {state==='ready_check'&&preview&&<section className="excel-state"><CheckCircle2 className="excel-success-icon" size={30}/><p className="eyebrow">Ready for Margin Check</p><h1>{preview.report.importedRows} detail rows understood.</h1><div className="excel-clean-list"><span><CheckCircle2 size={15}/>Worksheet: {preview.source.worksheetName}</span><span><CheckCircle2 size={15}/>Totals: {preview.report.totalReconciliation.state.replaceAll('_',' ')}</span><span><CheckCircle2 size={15}/>Labor hours: {preview.report.laborHourCoverage}</span><span><CheckCircle2 size={15}/>No unresolved hard blockers</span></div><button className="btn primary" onClick={runCheck}>Margin Check <ArrowRight size={16}/></button><p className="helper">The workbook is recaptured before the check. Relevant edits require a fresh review.</p></section>}
  {state==='needs_input'&&result&&<section className="excel-state"><p className="eyebrow">One answer needed</p><h1>Margin Memory needs your judgment.</h1>{result.questions.map(question=><div className="excel-question" key={question.id}><h2>{question.prompt}</h2><p>{question.context}</p><div className="excel-choice-list">{question.options.map(option=><button key={option} onClick={()=>answerQuestion(question.id,option)}><span>{option}</span><ArrowRight size={15}/></button>)}</div></div>)}</section>}
  {state==='findings'&&result&&<section className="excel-state"><p className="eyebrow">Margin Check complete</p><h1>{result.findings.length} item{result.findings.length===1?'':'s'} deserve another look.</h1>{result.findings.map(finding=><article className="excel-finding" key={finding.id}><span className={`badge ${finding.severity}`}>{finding.severity}</span><h2>{finding.title}</h2><h3>Fact</h3><p>{finding.fact}</p><h3>Interpretation</h3><p>{finding.interpretation}</p><h3>Action</h3><p>{finding.action}</p>{finding.evidence.length>0&&<details><summary>View evidence <ChevronDown size={14}/></summary>{finding.evidence.map((item,index)=><div className="excel-evidence" key={`${item.jobId}:${index}`}><strong>{item.label}</strong><span>{item.detail}</span></div>)}</details>}</article>)}<a className="btn" href={result.fullReviewUrl} target="_blank">Open full review <ExternalLink size={15}/></a></section>}
  {state==='no_findings'&&result&&<section className="excel-state centered"><CheckCircle2 className="excel-success-icon" size={36}/><h1>No material historical risks found.</h1><p>{result.summary||'Margin Memory completed the review without finding a company-history issue that deserves escalation.'}</p><a className="btn" href={result.fullReviewUrl} target="_blank">View completed review <ExternalLink size={15}/></a></section>}
  {state==='error'&&<section className="excel-state centered"><AlertTriangle size={30}/><h1>Margin Check stopped safely.</h1><p>{error||'The review could not be completed.'}</p><button className="btn primary" onClick={inspectWorkbook}><RefreshCw size={15}/>Inspect current workbook</button></section>}
 </div>
}
