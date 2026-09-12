import {RestoreCloseoutSource} from './restore-closeout-source'
import {getMemoryReadiness} from '@/lib/repository/memory'
import {ReindexMemory} from './reindex-memory'
export async function MemoryReadiness({jobId,estimateId}:{jobId?:string;estimateId?:string}){
 const state=await getMemoryReadiness(jobId)
 const pending=state.pendingJobs+state.pendingLessons
 return <div className={pending||state.missingFiles||state.unreconciledJobs?'card warning-banner':'card'}>
  <strong>Company memory availability</strong>
  <p>{!state.enabled?'Company memory search is not configured. Your records and review decisions are saved.':pending?`${state.pendingJobs} jobs and ${state.pendingLessons} confirmed lessons are not yet searchable. Saved review decisions are preserved; retry the remaining work.`:'Scope-reconciled jobs and their confirmed lessons are available to company memory search.'}</p>
  {state.unreconciledJobs>0&&<p>{state.unreconciledJobs} jobs have unverified scope. Their records remain available, but they and their lessons are excluded from automated comparisons. Rebuilding search will not reconcile them.</p>}
  {state.missingFiles>0&&<p>Original actuals files are missing for {state.missingFiles} earlier closeouts. They need to be restored from your original uploads; stored cost records are preserved.</p>}
  {estimateId&&state.missingFiles>0&&<RestoreCloseoutSource estimateId={estimateId}/>}
  {estimateId?<ReindexMemory estimateId={estimateId}/>:state.enabled&&pending>0?<ReindexMemory/>:null}
 </div>
}
