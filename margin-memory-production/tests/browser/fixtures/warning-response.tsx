import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { OutcomeAssessmentForm, OutcomeAssessmentSummary, WarningResponseForm, WarningResponseHistory } from '../../../src/components/warning-response-fields'
import type { OutcomeAssessment, WarningResponse } from '../../../src/lib/domain/warning-response'

// Real form/validation components; the callback captures their output, not a fake API.
function Fixture(){
 const[responses,setResponses]=useState<WarningResponse[]>([])
 const[assessment,setAssessment]=useState<OutcomeAssessment|null>(null)
 return <><h1>Warning response</h1><WarningResponseForm resolve onSave={async input=>setResponses(current=>[...current,{...input.response,id:input.responseId,findingId:'warning',recordedAt:'2026-01-01T12:00:00Z',recordedStage:'draft',recordedBy:'fixture-human'}])}/>
 <WarningResponseHistory responses={responses}/><h2>Closeout assessment</h2>{assessment?<OutcomeAssessmentSummary assessment={assessment}/>:<OutcomeAssessmentForm responses={responses} onSave={async value=>setAssessment(value)}/>}</>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
