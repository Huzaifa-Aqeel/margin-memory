import { NextResponse } from 'next/server'
import {claimDemoPreflight,ensureDemoWorkspace,finishDemoSeed,resetDemoWorkspace} from '@/lib/repository/demo'
import { runPreflight } from '@/lib/agent/preflight'

export const runtime='nodejs';export const maxDuration=300
const errorResponse=(error:unknown,fallback:string)=>NextResponse.json({error:error instanceof Error?error.message:fallback},{status:error instanceof Error&&/authentication|workspace required/i.test(error.message)?401:500})
export async function POST(){
  try{const seeded=await ensureDemoWorkspace();if(seeded.status==='complete')return NextResponse.json({ok:true,...seeded})
    const claim=await claimDemoPreflight();if(!claim.claimed)return NextResponse.json({ok:false,...seeded,status:claim.status,retryable:true},{status:202});if(!claim.leaseToken)throw new Error('Demo preflight claim did not return a lease token')
    try{await runPreflight(seeded.estimateId);await finishDemoSeed({leaseToken:claim.leaseToken,succeeded:true});return NextResponse.json({ok:true,...seeded,status:'complete'})}
    catch(error){const message=error instanceof Error?error.message:String(error);await finishDemoSeed({leaseToken:claim.leaseToken,succeeded:false,error:message});console.error(error);return NextResponse.json({ok:false,estimateId:seeded.estimateId,jobs:seeded.jobs,lessons:seeded.lessons,status:'preflight_failed',retryable:true,error:`Demo data was created safely, but its sample preflight failed: ${message}`},{status:202})}
  }catch(error){console.error(error);return errorResponse(error,'Could not seed demo data.')}
}

export async function DELETE(){try{return NextResponse.json({ok:true,...await resetDemoWorkspace()})}catch(error){console.error(error);return errorResponse(error,'Could not reset demo data.')}}
