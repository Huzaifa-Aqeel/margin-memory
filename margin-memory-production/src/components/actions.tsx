'use client'

import { WarningResponseForm } from './warning-response-fields'
import {postJson,performMutation} from '@/lib/http'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RefreshCw, X } from 'lucide-react'

export function FindingActions({ findingId, status }: { findingId:string; status:string }) {
  const router=useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  async function update(next:'resolved'|'dismissed'|'open'){await performMutation(()=>postJson(`/api/findings/${findingId}/status`,{status:next}),{busy:setBusy,error:setError},()=>router.refresh())}
  if(status!=='open') return <div>{error&&<div className="error inline-error">{error}</div>}<button className="btn small" disabled={busy} onClick={()=>update('open')}>Reopen</button></div>
  return <details><summary className="btn small">Respond to warning</summary><WarningResponseForm resolve onSave={async input=>{await postJson(`/api/findings/${findingId}/status`,input);router.refresh()}}/></details>
}

export function AnswerQuestion({ estimateId, questionId, options }: { estimateId:string; questionId:string; options:string[] }) {
  const router=useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  async function answer(value:string){await performMutation(()=>postJson(`/api/estimates/${estimateId}/answer`,{questionId,answer:value}),{busy:setBusy,error:setError},()=>router.refresh())}
  return <>{error&&<div className="error">{error}</div>}<div className="question-options">{options.map((option)=><button key={option} disabled={busy} className="btn" onClick={()=>answer(option)}>{busy?'Updating…':option}</button>)}</div></>
}

export function RerunReview({ estimateId }: { estimateId:string }) {
  const router=useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  async function run(){await performMutation(()=>postJson(`/api/estimates/${estimateId}/review`),{busy:setBusy,error:setError},()=>router.refresh())}
  return <div>{error&&<div className="error" style={{marginBottom:8}}>{error}</div>}<button className="btn" disabled={busy} onClick={run}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'Investigating…':'Run preflight again'}</button></div>
}

export function LessonActions({ lessonId }: { lessonId:string }) {
  const router=useRouter(); const [busy,setBusy]=useState(false);const[error,setError]=useState('')
  async function set(status:'confirmed'|'rejected'){await performMutation(()=>postJson(`/api/lessons/${lessonId}/status`,{status}),{busy:setBusy,error:setError},()=>router.refresh())}
  return <div>{error&&<div className="error inline-error">{error}</div>}<div className="lesson-actions"><button className="btn small primary" disabled={busy} onClick={()=>set('confirmed')}><Check size={14}/>Confirm</button><button className="btn small" disabled={busy} onClick={()=>set('rejected')}><X size={14}/>Reject</button></div></div>
}

export function PostSubmissionResponse({findingId}:{findingId:string}){
  const router=useRouter()
  return <details><summary className="btn small">Record a later response</summary><WarningResponseForm onSave={async input=>{await postJson(`/api/findings/${findingId}/response`,input);router.refresh()}}/></details>
}
