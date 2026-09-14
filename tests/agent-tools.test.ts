import {expect,it} from 'vitest'
import type {InvokableTool,Tool} from '@strands-agents/sdk'
import {createPreflightTools} from '../src/lib/agent/tools'
import {EvidenceLedger} from '../src/lib/agent/provenance'
import {seedStore} from '../src/lib/seed'

function invokable(tools:Tool[],name:string):InvokableTool<unknown,unknown>{
 const selected=tools.find(value=>value.name===name)
 if(!selected||!('invoke' in selected))throw new Error(`Missing invokable tool ${name}`)
 return selected as InvokableTool<unknown,unknown>
}

it('requires current estimate lines to be inspected before historical risk calculations',async()=>{
 const ledger=new EvidenceLedger(crypto.randomUUID(),async()=>{})
 const tools=createPreflightTools({store:seedStore,estimate:seedStore.estimates[0],supabase:{} as never,organizationId:crypto.randomUUID(),ledger,heartbeat:async()=>{}})
 const calculate=invokable(tools,'calculate_category_risk')
 await expect(calculate.invoke({jobIds:[crypto.randomUUID()],category:'labor'})).rejects.toThrow('Inspect the current estimate line items')
 await invokable(tools,'get_estimate_line_items').invoke({offset:0})
 await expect(invokable(tools,'search_lessons').invoke({query:'occupied access',limit:4})).resolves.toMatchObject({skipped:true,reason:expect.stringContaining('comparable jobs')})
 await expect(calculate.invoke({jobIds:[crypto.randomUUID()],category:'labor'})).resolves.toMatchObject({skipped:true,reason:expect.stringContaining('Search comparable jobs')})
})

it('skips absent estimate categories and premature calibration without writing evidence',async()=>{
 const persisted:unknown[]=[];const ledger=new EvidenceLedger(crypto.randomUUID(),async entry=>{persisted.push(entry)})
 const tools=createPreflightTools({store:seedStore,estimate:seedStore.estimates[0],supabase:{} as never,organizationId:crypto.randomUUID(),ledger,heartbeat:async()=>{}})
 await invokable(tools,'get_estimate_line_items').invoke({offset:0})
 await expect(invokable(tools,'calculate_category_risk').invoke({jobIds:[crypto.randomUUID()],category:'other'})).resolves.toMatchObject({skipped:true,reason:expect.stringContaining('no other allowance')})
 await expect(invokable(tools,'get_warning_calibration').invoke({category:'labor'})).resolves.toMatchObject({skipped:true,reason:expect.stringContaining('material category risk')})
 await expect(invokable(tools,'request_human_input').invoke({topic:'access'})).resolves.toMatchObject({skipped:true,reason:expect.stringContaining('after a material category risk')})
 expect(persisted).toEqual([])
})
