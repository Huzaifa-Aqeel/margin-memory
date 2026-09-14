import {RestoreCloseoutSource} from './restore-closeout-source'
import {getMemoryReadiness} from '@/lib/repository/memory'
export async function MemoryReadiness({jobId,estimateId}:{jobId?:string;estimateId?:string}){
 const state=await getMemoryReadiness(jobId)
 const pending=state.pendingJobs+state.pendingLessons
 return <div className={pending||state.failedItems||state.missingFiles||state.unreconciledJobs?'card warning-banner':'card'}>
  <strong>Historical evidence readiness</strong>
  <p>{!state.enabled?'Historical comparisons are not available in this workspace yet. Your records and review decisions are saved.':pending||state.failedItems?'Some completed-job evidence is still being prepared for future comparisons. Your records and review decisions are safe.':'This completed-job evidence is available for future comparisons.'}</p>
  {state.unreconciledJobs>0&&<p>{state.unreconciledJobs} completed {state.unreconciledJobs===1?'job has':'jobs have'} unverified scope. The records remain in Job history but cannot influence future comparisons.</p>}
  {state.quarantinedJobs>0&&<p>{state.quarantinedJobs} completed {state.quarantinedJobs===1?'job has':'jobs have'} been set aside and cannot influence professional findings.</p>}
  {state.failedItems>0&&<p>Some historical evidence is temporarily unavailable. Margin Memory retained the failure for a safe retry.</p>}
  {state.missingFiles>0&&<p>Original actuals files are missing for {state.missingFiles} earlier closeouts. They need to be restored from your original uploads; stored cost records are preserved.</p>}
  {estimateId&&state.missingFiles>0&&<RestoreCloseoutSource estimateId={estimateId}/>}
 </div>
}
