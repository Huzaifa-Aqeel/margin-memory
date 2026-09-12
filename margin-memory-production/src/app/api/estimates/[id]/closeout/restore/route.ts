import {NextResponse} from 'next/server'
import {getAuthenticatedSupabase,getEstimate} from '@/lib/repository/store'
import {stageCloseoutDocument} from '@/lib/documents'
import {parseActualFile} from '@/lib/spreadsheet'
import {createAdminClient} from '@/lib/supabase/admin'
export const runtime='nodejs';export const maxDuration=60
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params;const estimate=await getEstimate(id)
  if(!estimate?.linkedJobId)return NextResponse.json({error:'A committed closeout is required.'},{status:409})
  const form=await request.formData(),file=form.get('actualFile')
  if(!(file instanceof File)||!file.size||file.size>25*1024*1024)return NextResponse.json({error:'Attach the original actuals CSV/XLSX, up to 25 MB.'},{status:400})
  const lines=await parseActualFile(file),auth=await getAuthenticatedSupabase()
  const source=await stageCloseoutDocument({supabase:auth.supabase,organizationId:auth.organizationId,estimateId:id,kind:'actuals',file,extractedText:''})
  const {error}=await createAdminClient().rpc('closeout_estimate_server',{p_organization_id:auth.organizationId,p_actor_user_id:auth.userId,p_estimate_id:id,p_actual_lines:lines.map(l=>({category:l.category,description:l.description,quantity:l.quantity??null,unit:l.unit??null,normalized_unit:l.normalizedUnit??null,unit_cost:l.unitCost??null,cost_code:l.costCode??null,phase:l.phase??null,division:l.division??null,actual_cost:l.actualCost,actual_hours:l.actualHours??null})),p_lessons:[],p_outcomes:[],p_closeout_notes:'',p_source_documents:[source],p_scope_review:{status:'unreconciled',changes:[],actualCompleteness:'unknown'}})
  if(error)throw error
  return NextResponse.json({ok:true})
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not restore the file. It must match the saved actual-cost lines.'},{status:400})}
}
