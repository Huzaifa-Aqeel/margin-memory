import {InvestigationAlreadyRunningError} from '@/lib/agent/errors'
import { NextResponse } from 'next/server'
import { runPreflight } from '@/lib/agent/preflight'
export const runtime='nodejs'
export const maxDuration=300
export async function POST(_:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;return NextResponse.json({estimate:await runPreflight(id)})}catch(error){if(error instanceof InvestigationAlreadyRunningError)return NextResponse.json({error:error.message},{status:409});return NextResponse.json({error:error instanceof Error?error.message:'Review failed.'},{status:500})}}
