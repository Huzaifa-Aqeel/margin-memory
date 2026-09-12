import { beforeEach, expect, it, vi } from 'vitest'

const state=vi.hoisted(()=>({authError:true,reviewError:false,stageError:false,preflightError:false,runs:[] as Array<{status:string;failureStage?:string}>,latest:[] as Array<{status:string;message?:string}>}))
vi.mock('@/lib/repository/store',()=>({
 getAuthenticatedSupabase:async()=>{if(state.authError)throw new Error('Authentication/workspace required');return{supabase:{},organizationId:'org',userId:'user'}},
 cleanupExpiredImportReviews:async()=>0,
 getExcelSourceBinding:async()=>undefined,
 createExcelIntegrationRun:async(args:{status:string;failureStage?:string})=>{state.runs.push(args)},
 createImportReviewRecord:async()=>undefined,
 getImportReviewRecord:async()=>{if(state.reviewError){const{ImportReviewError}=await import('../src/lib/import-contract');throw new ImportReviewError('Import review not found or no longer available.')}throw new Error('unexpected')},
 updateExcelIntegrationRun:async()=>undefined,
 getLatestInvestigationId:async()=>undefined,
 updateLatestExcelRunForEstimate:async(_id:string,status:string,message?:string)=>{state.latest.push({status,message})},
 answerHumanQuestion:async()=>undefined,
 commitReviewedEstimate:async()=>{throw new Error('must not commit')},
 getEstimate:async()=>undefined,
}))
vi.mock('@/lib/documents',()=>({stageImportFiles:async()=>{if(state.stageError)throw new Error('Storage staging unavailable');return[]},removeStagedImportFiles:async()=>undefined}))
vi.mock('@/lib/agent/preflight',()=>({runPreflight:async()=>{if(state.preflightError)throw new Error('Bedrock unavailable');return undefined}}))

import { POST as previewExcel } from '../src/app/api/integrations/excel/preview/route'
import { POST as checkExcel } from '../src/app/api/integrations/excel/check/route'
import { POST as answerExcel } from '../src/app/api/integrations/excel/estimates/[id]/route'

beforeEach(()=>{state.authError=true;state.reviewError=false;state.stageError=false;state.preflightError=false;state.runs=[];state.latest=[]})

const snapshot=()=>{const cell=(value:string|number)=>({value,text:String(value),formula:null});return{sourceType:'excel_live_snapshot' as const,adapterVersion:'office-js-excel-live-v1' as const,workbook:{name:'bid.xlsx',documentUrlHash:'a'.repeat(64)},worksheet:{id:'sheet',name:'Bid',visibility:'visible' as const},selection:{kind:'used_range' as const,address:'Bid!A1:B2'},rowCount:2,columnCount:2,cells:[['Description','Cost'].map(cell),['Wire',100].map(cell)],capturedAt:'2026-09-12T09:00:00.000Z'}}

it('rejects an unauthenticated Excel preview before staging or interpretation',async()=>{
 const response=await previewExcel(new Request('http://localhost/api/integrations/excel/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))
 expect(response.status).toBe(401)
})

it('rejects a forged or foreign review identifier at the trusted server boundary',async()=>{
 state.authError=false;state.reviewError=true
 const response=await checkExcel(new Request('http://localhost/api/integrations/excel/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:snapshot(),reviewId:crypto.randomUUID(),reportHash:'a'.repeat(64),runId:crypto.randomUUID(),reviewed:false})}))
 expect(response.status).toBe(409)
})

it('records source-staging failures instead of leaving an untraceable operation identifier',async()=>{
 state.authError=false;state.stageError=true
 const response=await previewExcel(new Request('http://localhost/api/integrations/excel/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot:snapshot(),profile:{name:'Bid',projectType:'Office',customerType:'Commercial',location:'',bidDue:null,tags:[],assumptions:[]}})}))
 expect(response.status).toBe(500)
 expect(state.runs).toEqual([expect.objectContaining({status:'failed',failureStage:'source_staging'})])
})

it('marks a resumed Excel run failed when preflight fails after a persisted answer',async()=>{
 state.authError=false;state.preflightError=true
 const estimateId=crypto.randomUUID()
 const response=await answerExcel(new Request(`http://localhost/api/integrations/excel/estimates/${estimateId}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionId:crypto.randomUUID(),answer:'Occupied'})}),{params:Promise.resolve({id:estimateId})})
 expect(response.status).toBe(500)
 expect(state.latest.at(-1)).toEqual({status:'failed',message:'Bedrock unavailable'})
})
