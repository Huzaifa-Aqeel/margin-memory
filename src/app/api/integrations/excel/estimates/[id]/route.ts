import { NextResponse } from 'next/server'
import { InvestigationAlreadyRunningError } from '@/lib/agent/errors'
import { runPreflight } from '@/lib/agent/preflight'
import { presentExcelEstimate } from '@/lib/integrations/excel-contract'
import { answerHumanQuestion, getEstimate, updateLatestExcelRunForEstimate } from '@/lib/repository/store'

export const runtime='nodejs'
export const maxDuration=300
const authFailure=(error:unknown)=>error instanceof Error&&/authentication|workspace required/i.test(error.message)

export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 try{const{id}=await context.params;const estimate=await getEstimate(id);if(!estimate)return NextResponse.json({error:'Estimate not found.'},{status:404});return NextResponse.json({estimate:presentExcelEstimate(estimate)})}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not load Margin Check.'},{status:authFailure(error)?401:500})}
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const{id}=await context.params
 try{const body=await request.json() as {questionId?:unknown;answer?:unknown};if(typeof body.questionId!=='string'||typeof body.answer!=='string'||!body.answer.trim())return NextResponse.json({error:'Choose or enter an answer.'},{status:400});await answerHumanQuestion(id,body.questionId,body.answer.trim());await updateLatestExcelRunForEstimate(id,'running');const estimate=await runPreflight(id);if(!estimate)throw new Error('Preflight completed without a persisted estimate result.');const presentation=presentExcelEstimate(estimate);await updateLatestExcelRunForEstimate(id,presentation.result==='needs_input'?'needs_input':presentation.result==='failed'?'failed':presentation.result==='running'?'running':'completed');return NextResponse.json({estimate:presentation})}
 catch(error){if(error instanceof InvestigationAlreadyRunningError){const estimate=await getEstimate(id);if(estimate)return NextResponse.json({estimate:presentExcelEstimate(estimate),alreadyRunning:true},{status:202})}const message=error instanceof Error?error.message:'Could not resume Margin Check.';try{await updateLatestExcelRunForEstimate(id,'failed',message)}catch{}return NextResponse.json({error:message},{status:authFailure(error)?401:500})}
}
