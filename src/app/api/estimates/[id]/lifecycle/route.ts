import { NextResponse } from 'next/server'
import type { LifecycleStatus } from '@/lib/domain/types'
import { transitionEstimateLifecycle } from '@/lib/repository/store'

const allowed:LifecycleStatus[]=['reviewed','submitted','won','lost','in_progress','completed']
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    const body=await request.json() as {to?:LifecycleStatus;note?:string;amount?:number}
    if(!body.to||!allowed.includes(body.to)) return NextResponse.json({error:'Invalid lifecycle transition.'},{status:400})
    if(body.amount!==undefined && (!Number.isFinite(Number(body.amount))||Number(body.amount)<=0)) return NextResponse.json({error:'Amount must be greater than zero.'},{status:400})
    const stage=await transitionEstimateLifecycle(id,body.to,{note:body.note,amount:body.amount===undefined?undefined:Number(body.amount)})
    return NextResponse.json({stage})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not update lifecycle.'},{status:400})}
}
