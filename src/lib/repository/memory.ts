import 'server-only'
import {z} from 'zod'
import {canonicalJobMemoryContent,canonicalLessonMemoryContent,isJobEligibleForTrustedMemory,isLessonEligibleForTrustedMemory,jobMemoryExclusionReasons,JOB_MEMORY_CONTENT_VERSION,LESSON_MEMORY_CONTENT_VERSION,memoryContentHash} from '@/lib/domain/memory-policy'
import {createAdminClient} from '@/lib/supabase/admin'
import {embedText,embeddingConfig,embeddingsEnabled} from '@/lib/embeddings'
import {getAuthenticatedSupabase,readStore} from './store'

const readinessSchema=z.object({pending_jobs:z.coerce.number(),pending_lessons:z.coerce.number(),missing_closeout_files:z.coerce.number(),unreconciled_jobs:z.coerce.number(),eligible_jobs:z.coerce.number(),indexed_jobs:z.coerce.number(),confirmed_lessons:z.coerce.number(),indexed_lessons:z.coerce.number(),stale_items:z.coerce.number(),failed_items:z.coerce.number(),quarantined_jobs:z.coerce.number(),excluded_jobs:z.coerce.number(),active_provider:z.string().nullable(),active_model:z.string().nullable(),last_reconciled_at:z.string().nullable()})
const claimSchema=z.object({id:z.string().uuid(),source_type:z.enum(['job','lesson']),source_id:z.string().uuid(),desired_content:z.string(),desired_content_hash:z.string().regex(/^[0-9a-f]{64}$/),content_version:z.string(),embedding_provider:z.string(),embedding_model:z.string(),embedding_dimensions:z.coerce.number(),lease_token:z.string().uuid()})

export async function getMemoryReadiness(jobId?:string){
 const auth=await getAuthenticatedSupabase();const{data,error}=await auth.supabase.rpc('get_memory_readiness',{p_organization_id:auth.organizationId,p_job_id:jobId??null});if(error)throw error
 const row=z.array(readinessSchema).length(1).parse(data)[0]
 return{unreconciledJobs:row.unreconciled_jobs,pendingJobs:row.pending_jobs,pendingLessons:row.pending_lessons,missingFiles:row.missing_closeout_files,eligibleJobs:row.eligible_jobs,indexedJobs:row.indexed_jobs,confirmedLessons:row.confirmed_lessons,indexedLessons:row.indexed_lessons,staleItems:row.stale_items,failedItems:row.failed_items,quarantinedJobs:row.quarantined_jobs,excludedJobs:row.excluded_jobs,activeProvider:row.active_provider,activeModel:row.active_model,lastReconciledAt:row.last_reconciled_at,enabled:embeddingsEnabled()}
}

export type PreparedMemoryWork = {removed:number}

/** Persist the desired search projection before any external embedding call. */
export async function prepareMemoryIndexJobs(jobId?:string):Promise<PreparedMemoryWork>{
 if(!embeddingsEnabled())throw new Error('Company memory search is not configured.')
 const auth=await getAuthenticatedSupabase(),admin=createAdminClient(),store=await readStore(),config=embeddingConfig()
 const{error:spaceError}=await admin.rpc('ensure_embedding_space_server',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_provider:config.provider,p_model:config.model,p_dimensions:config.dimensions});if(spaceError)throw spaceError
 let removed=0
 for(const job of store.jobs.filter(job=>!jobId||job.id===jobId)){
  if(isJobEligibleForTrustedMemory(job)){
   const content=canonicalJobMemoryContent(job),hash=memoryContentHash(content)
   const{error}=await admin.rpc('enqueue_memory_index_job',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_source_type:'job',p_source_id:job.id,p_content:content,p_content_hash:hash,p_content_version:JOB_MEMORY_CONTENT_VERSION,p_provider:config.provider,p_model:config.model,p_dimensions:config.dimensions});if(error)throw error
  }else removed++
 }
 for(const lesson of store.lessons.filter(lesson=>!jobId||lesson.jobId===jobId)){
  const job=store.jobs.find(value=>value.id===lesson.jobId)
  if(isLessonEligibleForTrustedMemory(lesson,job)){
   const content=canonicalLessonMemoryContent(lesson),hash=memoryContentHash(content)
   const{error}=await admin.rpc('enqueue_memory_index_job',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_source_type:'lesson',p_source_id:lesson.id,p_content:content,p_content_hash:hash,p_content_version:LESSON_MEMORY_CONTENT_VERSION,p_provider:config.provider,p_model:config.model,p_dimensions:config.dimensions});if(error)throw error
  }else removed++
 }
 return{removed}
}

/** Process a bounded durable work batch. Failed items retain their retry state. */
export async function processMemoryIndexJobs(jobId?:string,prepared:PreparedMemoryWork={removed:0},limit=20){
 const auth=await getAuthenticatedSupabase(),admin=createAdminClient()
 let added=0,refreshed=0,verified=0,failed=0
 const claimLimit=Math.min(Math.max(limit,1),20)
 const workerId=crypto.randomUUID();const{data,error}=await admin.rpc('claim_memory_index_jobs',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_worker_id:workerId,p_limit:claimLimit});if(error)throw error
 const claimed=z.array(claimSchema).parse(data??[])
 for(const item of claimed){
  try{
   const embedding=await embedText(item.desired_content,'search_document')
   const{error:completeError}=await admin.rpc('complete_memory_index_job',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_job_id:item.id,p_lease_token:item.lease_token,p_content_hash:item.desired_content_hash,p_embedding:embedding});if(completeError)throw completeError
   if(item.source_type==='job')added++;else refreshed++
  }catch(cause){
   failed++;const message=cause instanceof Error?cause.message:'Embedding failed'
   const{error:failureError}=await admin.rpc('fail_memory_index_job',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_job_id:item.id,p_lease_token:item.lease_token,p_error:message});if(failureError)console.error('Could not record memory indexing failure',failureError)
  }
 }
 const readiness=await getMemoryReadiness(jobId);verified=readiness.indexedJobs+readiness.indexedLessons
 const{error:runError}=await admin.rpc('record_memory_reconciliation',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_job_id:jobId??null,p_added:added,p_refreshed:refreshed,p_removed:prepared.removed,p_verified:verified,p_failed:failed});if(runError)throw runError
 return{jobs:added,lessons:refreshed,added,refreshed,removed:prepared.removed,verified,failed,readiness}
}

/** Reconcile desired trusted memory, then process a bounded durable work batch. */
export async function repairMemory(jobId?:string){
 const prepared=await prepareMemoryIndexJobs(jobId)
 return processMemoryIndexJobs(jobId,prepared)
}

export async function quarantineJobMemory(jobId:string,reason:string){
 const auth=await getAuthenticatedSupabase(),admin=createAdminClient();const{error}=await admin.rpc('quarantine_job_memory_server',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_job_id:jobId,p_reason:reason});if(error)throw error
 return getMemoryReadiness(jobId)
}

const failureSchema=z.object({source_type:z.enum(['job','lesson']),job_id:z.string().nullable(),lesson_id:z.string().nullable(),attempt_count:z.coerce.number(),last_error:z.string().nullable(),next_attempt_at:z.string().nullable(),updated_at:z.string()})
export async function getMemoryDiagnostics(){
 const auth=await getAuthenticatedSupabase(),admin=createAdminClient(),store=await readStore()
 const{data,error}=await admin.from('memory_index_jobs').select('source_type,job_id,lesson_id,attempt_count,last_error,next_attempt_at,updated_at').eq('organization_id',auth.organizationId).eq('status','failed').order('updated_at',{ascending:false}).limit(100);if(error)throw error
 const readiness=await getMemoryReadiness()
 return{readiness,excludedJobs:store.jobs.map(job=>({jobId:job.id,name:job.name,reasons:jobMemoryExclusionReasons(job)})).filter(job=>job.reasons.length>0),failures:z.array(failureSchema).parse(data??[]).map(row=>({sourceType:row.source_type,sourceId:row.job_id??row.lesson_id,attemptCount:row.attempt_count,error:row.last_error,nextAttemptAt:row.next_attempt_at,updatedAt:row.updated_at}))}
}
