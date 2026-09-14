import {InvestigationAlreadyRunningError} from '@/lib/agent/errors'
import { NextResponse } from 'next/server'
import { answerHumanQuestion } from '@/lib/repository/store'
import { runPreflight } from '@/lib/agent/preflight'

export const runtime='nodejs'
export const maxDuration=300

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{const{id}=await context.params;const body=await request.json() as {questionId?:string;answer?:string};if(!body.questionId||!body.answer)return NextResponse.json({error:'questionId and answer are required.'},{status:400});await answerHumanQuestion(id,body.questionId,body.answer);return NextResponse.json({estimate:await runPreflight(id)})}
  catch(error){if(error instanceof InvestigationAlreadyRunningError)return NextResponse.json({error:error.message},{status:409});return NextResponse.json({error:error instanceof Error?error.message:'Could not save answer.'},{status:500})}
}
