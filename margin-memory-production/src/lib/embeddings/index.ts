import { comparisonVariances, hasReconciledScope } from '@/lib/domain/scope'
import 'server-only'

import { embedText, embeddingConfig } from './provider'
export { embeddingsEnabled } from './provider'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Estimate, Job, Lesson } from '@/lib/domain/types'

export function jobSearchText(job:Job){
  if(!hasReconciledScope(job))throw new Error('Reconcile job scope before indexing numerical history')
  return ['Comparison basis: final approved scope; variance is not proof of cause.',`Project: ${job.name}`,`Type: ${job.projectType}`,`Customer: ${job.customerType}`,`Tags: ${job.tags.join(', ')}`,`Notes: ${job.notes}`,...comparisonVariances(job).map(v=>`${v.category}: cost variance ${Math.round((v.costDeltaPct??0)*100)}%, hours variance ${Math.round((v.hoursDeltaPct??0)*100)}%`)].join('\n')
}
export function lessonSearchText(lesson:Pick<Lesson,'title'|'category'|'lesson'|'cause'|'impactSummary'>){return `${lesson.title}\nCategory: ${lesson.category}\nLesson: ${lesson.lesson}\nCause: ${lesson.cause}\nImpact: ${lesson.impactSummary}`}
export function estimateSearchText(estimate:Estimate){return [`Project type: ${estimate.projectType}`,`Customer: ${estimate.customerType}`,`Tags: ${estimate.tags.join(', ')}`,`Assumptions: ${estimate.assumptions.join(' | ')}`,`Scope: ${estimate.lines.map(x=>x.description).join(' | ')}`].join('\n')}

export async function upsertJobEmbedding(supabase:SupabaseClient,organizationId:string,job:Job){
  await ensureEmbeddingSpace(supabase,organizationId); const content=jobSearchText(job); const embedding=await embedText(content,'search_document')
  const {error}=await supabase.from('job_search_documents').upsert({organization_id:organizationId,job_id:job.id,content,embedding,updated_at:new Date().toISOString()},{onConflict:'job_id'}); if(error)throw error
}
export async function upsertLessonEmbedding(supabase:SupabaseClient,organizationId:string,lesson:{id:string;title:string;category:string;lesson:string;cause:string;impact_summary:string}){
  await ensureEmbeddingSpace(supabase,organizationId); const content=lessonSearchText({title:lesson.title,category:lesson.category as Lesson['category'],lesson:lesson.lesson,cause:lesson.cause,impactSummary:lesson.impact_summary}); const embedding=await embedText(content,'search_document')
  const {error}=await supabase.from('lessons').update({embedding,updated_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('id',lesson.id); if(error)throw error
}
export async function searchJobsVector(supabase:SupabaseClient,organizationId:string,estimate:Estimate,query:string,limit=8){
  await ensureEmbeddingSpace(supabase,organizationId); const embedding=await embedText(`${estimateSearchText(estimate)}\nInvestigation focus: ${query}`,'search_query')
  const initial=await supabase.rpc('match_jobs',{p_organization_id:organizationId,query_embedding:embedding,p_project_type:estimate.projectType,p_customer_type:estimate.customerType,match_threshold:0.12,match_count:limit})
  if(initial.error)throw initial.error
  let data=initial.data
  if((data??[]).length<3){ const retry=await supabase.rpc('match_jobs',{p_organization_id:organizationId,query_embedding:embedding,p_project_type:null,p_customer_type:estimate.customerType,match_threshold:0.12,match_count:limit}); if(retry.error)throw retry.error;data=retry.data }
  return data ?? []
}
export async function searchLessonsVector(supabase:SupabaseClient,organizationId:string,query:string,limit=6){
  await ensureEmbeddingSpace(supabase,organizationId); const embedding=await embedText(query,'search_query'); const {data,error}=await supabase.rpc('match_lessons',{p_organization_id:organizationId,query_embedding:embedding,match_threshold:0.18,match_count:limit}); if(error)throw error; return data??[]
}

async function ensureEmbeddingSpace(supabase:SupabaseClient,organizationId:string){const config=embeddingConfig();const {error}=await supabase.rpc('ensure_embedding_space',{p_organization_id:organizationId,p_provider:config.provider,p_model:config.model,p_dimensions:config.dimensions});if(error)throw error}
