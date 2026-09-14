import {expect,it,vi} from 'vitest'
import {EvidenceLedger} from '../src/lib/agent/provenance'
import {AgentRuntimeOutputError,interpretStrandsResult} from '../src/lib/agent/outcome'

const metrics={cycleCount:2,toolMetrics:{get_current_estimate:{}},totalDuration:15}
const result=(overrides:Record<string,unknown>={})=>({stopReason:'toolUse',structuredOutput:{findings:[],questions:[]},metrics,...overrides})
const ledger=()=>new EvidenceLedger(crypto.randomUUID(),async()=>{})

it('accepts a valid structured completion and preserves legitimate zero findings',async()=>{
 const evidence=ledger();await evidence.record({kind:'search',toolName:'search_similar_jobs',result:{jobIds:[]}})
 const outcome=interpretStrandsResult(result(),evidence)
 expect(outcome.kind).toBe('completed')
 expect(outcome.output).toMatchObject({findings:[],questions:[],summary:'No material historical risks found.'})
})

it('turns a Strands tool interrupt into a persisted-question payload without rendering final output',()=>{
 const render=vi.fn(()=>{throw new Error('must not render')})
 const outcome=interpretStrandsResult(result({stopReason:'interrupt',structuredOutput:undefined,interrupts:[{name:'margin_memory_human_question',reason:{kind:'human_question',topic:'access'}}]}),ledger(),render)
 expect(render).not.toHaveBeenCalled()
 expect(outcome).toMatchObject({kind:'waiting_for_human',output:{findings:[],questions:[{prompt:'Are normal work-area access and shutdown windows confirmed?'}]}})
})

it('fails explicitly when a terminal Strands result has no structured output',()=>{
 try{interpretStrandsResult(result({stopReason:'limitTurns',structuredOutput:undefined}),ledger());throw new Error('expected runtime failure')}catch(error){expect(error).toBeInstanceOf(AgentRuntimeOutputError);expect((error as AgentRuntimeOutputError).retryable).toBe(true)}
 expect(()=>interpretStrandsResult(result({stopReason:'limitTurns',structuredOutput:undefined}),ledger())).toThrow('limitTurns')
})

it('keeps malformed structured output fail-closed',()=>{
 expect(()=>interpretStrandsResult(result({structuredOutput:{findings:'not-an-array',questions:[]}}),ledger())).toThrow()
 expect(()=>interpretStrandsResult(result({structuredOutput:{findings:[],questions:['access']}}),ledger())).toThrow()
})
