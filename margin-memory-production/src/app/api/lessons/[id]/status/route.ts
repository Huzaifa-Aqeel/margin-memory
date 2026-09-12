import { embeddingsEnabled } from '@/lib/embeddings/provider'
import { NextResponse } from 'next/server'
import { getAuthenticatedSupabase, tryFinalizeEstimateLearning, updateLessonStatus } from '@/lib/repository/store'
import { upsertLessonEmbedding } from '@/lib/embeddings'

export const runtime='nodejs'
export const maxDuration=30

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const{id}=await context.params
    const{status}=await request.json() as {status?:string}
    if(!['confirmed','rejected'].includes(status??''))return NextResponse.json({error:'Invalid lesson status.'},{status:400})
    const lesson=await updateLessonStatus(id,status as 'confirmed'|'rejected')
    const auth=await getAuthenticatedSupabase()
    let embeddingStatus:'indexed'|'skipped'|'failed'='skipped'
    if(status==='confirmed'&&embeddingsEnabled()){try{await upsertLessonEmbedding(auth.supabase,auth.organizationId,lesson);embeddingStatus='indexed'}catch(error){console.error('Lesson embedding failed',error);embeddingStatus='failed'}}
    const {data:job,error:jobError}=await auth.supabase.from('jobs').select('source_estimate_id').eq('organization_id',auth.organizationId).eq('id',lesson.job_id).maybeSingle()
    if(jobError)throw jobError
    const finalized=job?.source_estimate_id?await tryFinalizeEstimateLearning(job.source_estimate_id):false
    return NextResponse.json({lesson,embeddingStatus,finalized})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not update lesson.'},{status:500})}
}
