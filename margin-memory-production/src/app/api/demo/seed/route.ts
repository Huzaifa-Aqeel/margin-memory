import { NextResponse } from 'next/server'
import { seedStore } from '@/lib/seed'
import { id } from '@/lib/domain/ids'
import type { Estimate, Job, Lesson } from '@/lib/domain/types'
import { readStore, saveEstimate, saveJob } from '@/lib/repository/store'
import { runPreflight } from '@/lib/agent/preflight'

export const runtime='nodejs';export const maxDuration=300
export async function POST(){
  try{const current=await readStore();if(current.jobs.length||current.estimates.length)return NextResponse.json({error:'Demo data can only be loaded into an empty workspace.'},{status:409});const jobMap=new Map<string,string>();const lessonMap=new Map<string,Lesson[]>()
    for(const source of seedStore.jobs){const newId=id();jobMap.set(source.id,newId);const job:Job={...source,id:newId,dataOrigin:'demo',memoryStatus:'trusted',estimateBaselineRole:'historical_unknown',estimateLines:source.estimateLines.map(x=>({...x,id:id()})),actualLines:source.actualLines.map(x=>({...x,id:id()}))};job.variances=source.variances.map(v=>({...v}));const lessons=seedStore.lessons.filter(l=>l.jobId===source.id).map(l=>({...l,id:id(),jobId:newId,createdAt:new Date().toISOString()}));lessonMap.set(newId,lessons);await saveJob(job,lessons)}
    const source=seedStore.estimates[0];const estimate:Estimate={...source,id:id(),lines:source.lines.map(x=>({...x,id:id()})),findings:[],submittedFindingIds:[], findingOutcomes:[],questions:[],status:'draft',investigationStatus:'queued',lifecycleStatus:'draft',agentSummary:undefined,agentMode:undefined,agentTelemetry:undefined,reviewedAt:undefined,createdAt:new Date().toISOString()};await saveEstimate(estimate);await runPreflight(estimate.id);return NextResponse.json({ok:true,estimateId:estimate.id,jobs:jobMap.size,lessons:[...lessonMap.values()].flat().length})
  }catch(error){console.error(error);return NextResponse.json({error:error instanceof Error?error.message:'Could not seed demo data.'},{status:500})}
}
