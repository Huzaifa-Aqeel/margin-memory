import { hasReconciledScope } from '@/lib/domain/scope'
import 'server-only'
import {z} from 'zod'
import {getAuthenticatedSupabase,readStore} from './store'
import {upsertJobEmbedding,upsertLessonEmbedding} from '@/lib/embeddings'
import {embeddingsEnabled} from '@/lib/embeddings/provider'
const readinessSchema=z.object({pending_jobs:z.coerce.number(),pending_lessons:z.coerce.number(),missing_closeout_files:z.coerce.number(),unreconciled_jobs:z.coerce.number()})
export async function getMemoryReadiness(jobId?:string){
 const auth=await getAuthenticatedSupabase()
 const {data,error}=await auth.supabase.rpc('get_memory_readiness',{p_organization_id:auth.organizationId,p_job_id:jobId??null});if(error)throw error
 const row=z.array(readinessSchema).length(1).parse(data)[0]
 return{unreconciledJobs:row.unreconciled_jobs,pendingJobs:row.pending_jobs,pendingLessons:row.pending_lessons,missingFiles:row.missing_closeout_files,enabled:embeddingsEnabled()}
}
/** Bounded, restartable maintenance. Each successful vector remains durable on a later failure. */
export async function repairMemory(jobId?:string){
 if(!embeddingsEnabled())throw new Error('Company memory search is not configured.')
 const auth=await getAuthenticatedSupabase();const store=await readStore();let jobs=0,lessons=0
 for(const job of store.jobs.filter(j=>hasReconciledScope(j)&&(!jobId||j.id===jobId))){
  const {data,error}=await auth.supabase.from('job_search_documents').select('job_id').eq('organization_id',auth.organizationId).eq('job_id',job.id).not('embedding','is',null).maybeSingle();if(error)throw error
  if(!data){await upsertJobEmbedding(auth.supabase,auth.organizationId,job);jobs++}
  if(jobs>=10)break
 }
 for(const lesson of store.lessons.filter(l=>l.status==='confirmed'&&store.jobs.some(j=>j.id===l.jobId&&hasReconciledScope(j))&&(!jobId||l.jobId===jobId))){
  const {data,error}=await auth.supabase.from('lessons').select('id').eq('organization_id',auth.organizationId).eq('id',lesson.id).is('embedding',null).eq('status','confirmed').maybeSingle();if(error)throw error
  if(data){await upsertLessonEmbedding(auth.supabase,auth.organizationId,{id:lesson.id,title:lesson.title,category:lesson.category,lesson:lesson.lesson,cause:lesson.cause,impact_summary:lesson.impactSummary});lessons++}
  if(lessons>=10)break
 }
 return{jobs,lessons,readiness:await getMemoryReadiness(jobId)}
}
