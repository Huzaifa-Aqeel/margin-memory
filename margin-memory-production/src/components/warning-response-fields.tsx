'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { assessmentVerdict, conditionLabels, mitigationLabels, responseKinds, responseLabels, validateAssessment, warningResponseSchema, type OutcomeAssessment, type WarningResponse, type WarningResponseInput } from '@/lib/domain/warning-response'

export function WarningResponseForm({onSave,resolve=false}:{onSave:(input:{responseId:string;response:WarningResponseInput;status?:'resolved'|'dismissed'})=>Promise<void>;resolve?:boolean}){
  const prefix=useId();const[busy,setBusy]=useState(false);const[error,setError]=useState('')
  // A transport failure can happen after commit. Identical retries retain their ID.
  const retry=useRef<{payload:string;id:string}|null>(null)
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form)
    setBusy(true);setError('')
    try{
      const response=warningResponseSchema.parse({kind:data.get('kind'),note:data.get('note'),revisionReference:data.get('revisionReference')})
      const payload=JSON.stringify(response)
      if(retry.current?.payload!==payload)retry.current={payload,id:crypto.randomUUID()}
      await onSave({responseId:retry.current.id,response,...(resolve?{status:response.kind==='dismissed'?'dismissed' as const:'resolved' as const}:{})})
      retry.current=null;form.reset()
    }catch(error){setError(error instanceof Error?error.message:'Could not record response.')}finally{setBusy(false)}
  }
  return <form onSubmit={submit} className="form-card"><fieldset disabled={busy} style={{border:0,padding:0,margin:0}}>
    <div className="field"><label htmlFor={`${prefix}-kind`}>Response to this warning</label><select id={`${prefix}-kind`} name="kind" required defaultValue=""><option value="" disabled>Choose your response</option>{responseKinds.map(kind=><option key={kind} value={kind}>{responseLabels[kind]}</option>)}</select></div>
    <div className="field"><label htmlFor={`${prefix}-note`}>What did you do or decide, and why?</label><textarea id={`${prefix}-note`} name="note" required maxLength={4000}/></div>
    <div className="field"><label htmlFor={`${prefix}-revision`}>External bid revision reference (optional)</label><input id={`${prefix}-revision`} name="revisionReference" maxLength={500}/><div className="helper">For example, your revised estimating workbook or quote reference. Recording this does not change the saved bid or its totals.</div></div>
    <p className="helper">Choose completed only for an action you carried out. The record stores when you reported it and the current job stage.</p>
    {error&&<p className="error" role="alert">{error}</p>}<button className="btn small primary" disabled={busy}>{busy?'Saving…':resolve?'Record decision and close finding':'Record response'}</button>
  </fieldset></form>
}

export function WarningResponseHistory({responses=[]}:{responses?:WarningResponse[]}){
  if(!responses.length)return <p className="helper">No response details were recorded.</p>
  return <div className="list" aria-label="Warning response history">{responses.map(response=><div key={response.id} className="rationale"><strong>{responseLabels[response.kind]}</strong><div>{response.note}</div>{response.revisionReference&&<div>External revision: {response.revisionReference}</div>}<small>Recorded {new Date(response.recordedAt).toLocaleString()} · during {response.recordedStage.replaceAll('_',' ')}</small></div>)}</div>
}

export function OutcomeAssessmentForm({responses,onSave}:{responses:WarningResponse[];onSave:(assessment:OutcomeAssessment)=>Promise<void>}){
  const prefix=useId();const[busy,setBusy]=useState(false);const[error,setError]=useState('')
  const completed=responses.filter(response=>response.kind==='mitigation_completed')
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setError('')
    try{const assessment=validateAssessment({condition:data.get('condition'),mitigation:data.get('mitigation'),responseId:data.get('responseId')||null,note:data.get('note')},responses);await onSave(assessment)}catch(error){setError(error instanceof Error?error.message:'Could not confirm outcome.')}finally{setBusy(false)}
  }
  return <form onSubmit={submit}><fieldset disabled={busy} style={{border:0,padding:0,margin:0}}>
    <div className="field"><label htmlFor={`${prefix}-condition`}>Did the warned condition occur?</label><select name="condition" id={`${prefix}-condition`} defaultValue="" required><option value="" disabled>Choose from closeout evidence</option>{Object.entries(conditionLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
    <div className="field"><label htmlFor={`${prefix}-effect`}>Did your mitigation help?</label><select name="mitigation" id={`${prefix}-effect`} defaultValue="" required><option value="" disabled>Assess the response separately</option>{Object.entries(mitigationLabels).map(([key,label])=><option key={key} value={key} disabled={key==='not_attempted'&&completed.length>0}>{label}</option>)}</select></div>
    <div className="field"><label htmlFor={`${prefix}-response`}>Completed response being assessed</label><select name="responseId" id={`${prefix}-response`} defaultValue=""><option value="">No completed response selected</option>{completed.map(response=><option key={response.id} value={response.id}>{response.note}</option>)}</select></div>
    <div className="field"><label htmlFor={`${prefix}-basis`}>Evidence for your assessment</label><textarea name="note" id={`${prefix}-basis`} required maxLength={4000}/></div>
    <p className="helper">A job finishing within budget does not establish whether a warning mattered. Helpful mitigations are human assessments, reported separately from warning hit rate; they do not establish dollars saved.</p>
    {error&&<p role="alert" className="error">{error}</p>}<button className="btn small primary" disabled={busy}>{busy?'Saving…':'Confirm warning assessment'}</button>
  </fieldset></form>
}

export function OutcomeAssessmentSummary({assessment}:{assessment:OutcomeAssessment}){
  return <div className="rationale"><strong>Human assessment: {assessmentVerdict(assessment).replaceAll('_',' ')}</strong><div>Condition: {conditionLabels[assessment.condition]}</div><div>Response: {mitigationLabels[assessment.mitigation]}</div><p>{assessment.note}</p></div>
}
