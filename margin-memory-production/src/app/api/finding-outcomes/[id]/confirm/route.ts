import { NextResponse } from 'next/server'
import { z } from 'zod'
import { outcomeAssessmentSchema } from '@/lib/domain/warning-response'
import { confirmFindingOutcome, tryFinalizeEstimateLearning } from '@/lib/repository/store'
const schema=z.strictObject({assessment:outcomeAssessmentSchema})
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    const {assessment}=schema.parse(await request.json())
    const estimateId=await confirmFindingOutcome(id,assessment)
    const finalized=await tryFinalizeEstimateLearning(estimateId)
    return NextResponse.json({ok:true,finalized})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not confirm warning outcome.'},{status:400})}
}
