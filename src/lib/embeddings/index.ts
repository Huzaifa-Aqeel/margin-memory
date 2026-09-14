import 'server-only'
import type {SupabaseClient} from '@supabase/supabase-js'
import type {Estimate,Job,Lesson} from '@/lib/domain/types'
import {canonicalJobMemoryContent,canonicalLessonMemoryContent} from '@/lib/domain/memory-policy'
import {embedText,embeddingConfig} from './provider'

export {embeddingsEnabled,embedText,embeddingConfig} from './provider'
export const jobSearchText=(job:Job)=>canonicalJobMemoryContent(job)
export const lessonSearchText=(lesson:Pick<Lesson,'title'|'category'|'lesson'|'cause'|'impactSummary'>)=>canonicalLessonMemoryContent(lesson)
export function estimateSearchText(estimate:Estimate){return [`Project type: ${estimate.projectType}`,`Commercial class: ${estimate.customerType}`,`Size: ${estimate.estimatedTotal}`,`Tags: ${estimate.tags.join(', ')}`,`Assumptions: ${estimate.assumptions.join(' | ')}`,`Scope: ${estimate.lines.map(x=>x.description).join(' | ')}`].join('\n')}

export async function ensureEmbeddingSpace(supabase:SupabaseClient,organizationId:string){
 const config=embeddingConfig();const{error}=await supabase.rpc('assert_embedding_space',{p_organization_id:organizationId,p_provider:config.provider,p_model:config.model,p_dimensions:config.dimensions});if(error)throw error
}

export async function searchJobsVector(supabase:SupabaseClient,organizationId:string,estimate:Estimate,query:string,candidateIds:string[],limit=8){
 if(!candidateIds.length)return[]
 await ensureEmbeddingSpace(supabase,organizationId)
 const embedding=await embedText(`${estimateSearchText(estimate)}\nInvestigation focus: ${query}`,'search_query')
 const{data,error}=await supabase.rpc('match_trusted_jobs',{p_organization_id:organizationId,query_embedding:embedding,p_candidate_ids:candidateIds,match_threshold:0.12,match_count:limit})
 if(error)throw error;return data??[]
}

export async function searchLessonsVector(supabase:SupabaseClient,organizationId:string,query:string,limit=6){
 await ensureEmbeddingSpace(supabase,organizationId)
 const embedding=await embedText(query,'search_query')
 const{data,error}=await supabase.rpc('match_lessons',{p_organization_id:organizationId,query_embedding:embedding,match_threshold:0.18,match_count:limit})
 if(error)throw error;return data??[]
}
