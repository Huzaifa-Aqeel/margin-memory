import 'server-only'
import {getEstimate,tryFinalizeEstimateLearning} from '@/lib/repository/store'
import {getMemoryReadiness,repairMemory} from '@/lib/repository/memory'
import {embeddingsEnabled} from '@/lib/embeddings/provider'
export async function resumeCloseout(estimateId:string){
 const estimate=await getEstimate(estimateId)
 if(!estimate?.linkedJobId)throw new Error('No committed closeout exists for this estimate.')
 const warnings:string[]=[]
 // All retry inputs come from committed company records. A repeated upload cannot
 // replace the original actuals or accidentally index another request's values.
 if(embeddingsEnabled()){
  try{await repairMemory(estimate.linkedJobId)}catch(error){console.error('Closeout memory recovery failed',error);warnings.push('Actuals are saved. Some historical evidence is still being prepared and will be retried safely.')}
 }
 const finalized=await tryFinalizeEstimateLearning(estimateId)
 const readiness=await getMemoryReadiness(estimate.linkedJobId)
 return{jobId:estimate.linkedJobId,finalized,readiness,warnings}
}
