import {z} from 'zod'
import {actions,renderAgentOutput,StrandsAgentOutputSchema,type EvidenceLedger} from './provenance'

const topics=z.enum(['access','pathway','pricing','category','scope'])
const humanInterrupt=z.object({kind:z.literal('human_question'),topic:topics}).strict()

type RuntimeMetrics={cycleCount?:number;toolMetrics?:Record<string,unknown>;totalDuration?:number}
export type StrandsInvocationResult={
 stopReason:string
 structuredOutput?:unknown
 interrupts?:ReadonlyArray<{name:string;reason?:unknown}>
 metrics?:RuntimeMetrics
}
export type RenderedAgentOutput=ReturnType<typeof renderAgentOutput>
export type InvestigationRuntimeOutcome={
 kind:'completed'|'waiting_for_human'
 output:RenderedAgentOutput
 telemetry:{cycleCount:number;toolsUsed:string[];totalDurationMs?:number}
}

export class AgentRuntimeOutputError extends Error{
 readonly retryable:boolean
 constructor(readonly stopReason:string,message?:string){super(message??`Agent stopped with ${stopReason} before producing validated structured output.`);this.name='AgentRuntimeOutputError';this.retryable=['cancelled','maxTokens','limitOutputTokens','limitTotalTokens','limitTurns','pauseTurn','modelContextWindowExceeded'].includes(stopReason)}
}

const telemetry=(result:StrandsInvocationResult)=>({
 cycleCount:result.metrics?.cycleCount??0,
 toolsUsed:Object.keys(result.metrics?.toolMetrics??{}),
 ...(result.metrics?.totalDuration===undefined?{}:{totalDurationMs:Math.round(result.metrics.totalDuration)}),
})

export function interpretStrandsResult(result:StrandsInvocationResult,ledger:EvidenceLedger,render=renderAgentOutput):InvestigationRuntimeOutcome{
 if(result.stopReason==='interrupt'){
  if(result.structuredOutput!==undefined)throw new AgentRuntimeOutputError(result.stopReason,'Interrupted agent returned contradictory final structured output.')
  const interrupts=result.interrupts??[]
  if(!interrupts.length)throw new AgentRuntimeOutputError(result.stopReason,'Agent reported an interrupt without a human question.')
  const questions=interrupts.map(interrupt=>{
   if(interrupt.name!=='margin_memory_human_question')throw new AgentRuntimeOutputError(result.stopReason,`Unsupported agent interrupt: ${interrupt.name}`)
   const request=humanInterrupt.parse(interrupt.reason),definition=actions[request.topic]
   return{prompt:definition.question,context:definition.recommendation,options:['Yes — confirmed','No — not confirmed','Not sure yet']}
  }).filter((question,index,all)=>all.findIndex(candidate=>candidate.prompt===question.prompt)===index).slice(0,2)
  return{kind:'waiting_for_human',output:{summary:'Margin Memory needs estimator input before it can complete this review.',findings:[],questions},telemetry:telemetry(result)}
 }
 if(result.stopReason!=='toolUse')throw new AgentRuntimeOutputError(result.stopReason)
 if(result.structuredOutput===undefined)throw new AgentRuntimeOutputError(result.stopReason,'Agent completed without the required validated structured output.')
 return{kind:'completed',output:render(StrandsAgentOutputSchema.parse(result.structuredOutput),ledger),telemetry:telemetry(result)}
}
