import { NextResponse } from 'next/server'
import { findingDecisionSchema } from '@/lib/domain/warning-response'
import { recordFindingResponse, updateFindingStatus } from '@/lib/repository/store'

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    const input=findingDecisionSchema.parse(await request.json())
    const finding=input.status==='open'
      ? await updateFindingStatus(id,'open')
      : await recordFindingResponse(id,input.responseId,input.response,input.status)
    return NextResponse.json({finding})
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not update finding.'},{status:400})
  }
}
