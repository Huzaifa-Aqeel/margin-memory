import {beforeEach,expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({
 seedStatus:'preflight_pending' as 'preflight_pending'|'preflight_failed'|'complete',
 preflightError:false,
 ensured:0,
 completed:[] as Array<{leaseToken:string;succeeded:boolean;error?:string}>,
 reset:0,
 authError:false,
 preflights:0,
}))
vi.mock('@/lib/repository/demo',()=>({
 ensureDemoWorkspace:async()=>{if(state.authError)throw new Error('Authentication/workspace required');state.ensured++;return{estimateId:'11111111-1111-4111-8111-111111111111',jobs:8,lessons:8,status:state.seedStatus,reused:state.ensured>1}},
 claimDemoPreflight:async()=>({claimed:true,status:'preflight_running',estimateId:'11111111-1111-4111-8111-111111111111',leaseToken:'22222222-2222-4222-8222-222222222222'}),
 finishDemoSeed:async(args:{leaseToken:string;succeeded:boolean;error?:string})=>{state.completed.push(args);state.seedStatus=args.succeeded?'complete':'preflight_failed'},
 resetDemoWorkspace:async()=>{if(state.authError)throw new Error('Authentication/workspace required');state.reset++;return{jobs:8,estimates:1}},
}))
vi.mock('@/lib/agent/preflight',()=>({runPreflight:async()=>{state.preflights++;if(state.preflightError)throw new Error('Bedrock unavailable')}}))

import {DELETE,POST} from '../src/app/api/demo/seed/route'
import {jobHistoryBadges} from '../src/lib/domain/demo'

beforeEach(()=>{state.seedStatus='preflight_pending';state.preflightError=false;state.ensured=0;state.completed=[];state.reset=0;state.authError=false;state.preflights=0})

it('records a recoverable seed state when preflight fails after the atomic core seed',async()=>{
 state.preflightError=true
 const response=await POST()
 expect(response.status).toBe(202)
 expect(await response.json()).toMatchObject({ok:false,status:'preflight_failed',retryable:true})
 expect(state.completed).toEqual([{leaseToken:'22222222-2222-4222-8222-222222222222',succeeded:false,error:'Bedrock unavailable'}])
})

it('reuses a complete seed operation without starting another preflight',async()=>{
 state.seedStatus='complete'
 expect((await POST()).status).toBe(200)
 expect(state.completed).toEqual([])
})

it('turns a repeated successful seed request into one logical preflight',async()=>{
 expect((await POST()).status).toBe(200)
 expect((await POST()).status).toBe(200)
 expect(state.preflights).toBe(1)
})

it('exposes a tenant-resolved demo-only reset operation',async()=>{
 const response=await DELETE()
 expect(response.status).toBe(200)
 expect(state.reset).toBe(1)
})

it('rejects unauthenticated seed and reset mutations',async()=>{
 state.authError=true
 expect((await POST()).status).toBe(401)
 expect((await DELETE()).status).toBe(401)
})

it('visually separates origin from source semantics',()=>{
 expect(jobHistoryBadges({dataOrigin:'demo'})).toEqual({origin:'Demo',source:'legacy'})
 expect(jobHistoryBadges({dataOrigin:'production'})).toEqual({origin:null,source:'legacy'})
 expect(jobHistoryBadges({dataOrigin:'production',sourceEstimateId:'estimate'})).toEqual({origin:null,source:'closed loop'})
})
