import { NextResponse } from 'next/server'
import { z } from 'zod'
import { warningResponseSchema } from '@/lib/domain/warning-response'
import { recordFindingResponse } from '@/lib/repository/store'
const schema=z.strictObject({responseId:z.string().uuid(),response:warningResponseSchema})
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    const input=schema.parse(await request.json())
    await recordFindingResponse(id,input.responseId,input.response)
    return NextResponse.json({ok:true})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not record response.'},{status:400})}
}
