import {NextResponse} from 'next/server'
import {repairMemory} from '@/lib/repository/memory'
export const runtime='nodejs';export const maxDuration=120
export async function POST(){try{return NextResponse.json({ok:true,...await repairMemory()})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not update company memory.'},{status:500})}}
