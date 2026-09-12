import { beforeEach, expect, it, vi } from 'vitest'

const state=vi.hoisted(()=>({authError:true,reviewError:false}))
vi.mock('@/lib/repository/store',()=>({
 getAuthenticatedSupabase:async()=>{if(state.authError)throw new Error('Authentication/workspace required');return{supabase:{},organizationId:'org',userId:'user'}},
 cleanupExpiredImportReviews:async()=>0,
 getExcelSourceBinding:async()=>undefined,
 createExcelIntegrationRun:async()=>undefined,
 createImportReviewRecord:async()=>undefined,
 getImportReviewRecord:async()=>{if(state.reviewError){const{ImportReviewError}=await import('../src/lib/import-contract');throw new ImportReviewError('Import review not found or no longer available.')}throw new Error('unexpected')},
 updateExcelIntegrationRun:async()=>undefined,
 getLatestInvestigationId:async()=>undefined,
 updateLatestExcelRunForEstimate:async()=>undefined,
 commitReviewedEstimate:async()=>{throw new Error('must not commit')},
 getEstimate:async()=>undefined,
}))
vi.mock('@/lib/documents',()=>({stageImportFiles:async()=>[],removeStagedImportFiles:async()=>undefined}))
vi.mock('@/lib/agent/preflight',()=>({runPreflight:async()=>undefined}))

import { POST as previewExcel } from '../src/app/api/integrations/excel/preview/route'
import { POST as checkExcel } from '../src/app/api/integrations/excel/check/route'

beforeEach(()=>{state.authError=true;state.reviewError=false})

it('rejects an unauthenticated Excel preview before staging or interpretation',async()=>{
 const response=await previewExcel(new Request('http://localhost/api/integrations/excel/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))
 expect(response.status).toBe(401)
})

it('rejects a forged or foreign review identifier at the trusted server boundary',async()=>{
 state.authError=false;state.reviewError=true
 const cell=(value:string|number)=>({value,text:String(value),formula:null});const snapshot={sourceType:'excel_live_snapshot',adapterVersion:'office-js-excel-live-v1',workbook:{name:'bid.xlsx',documentUrlHash:'a'.repeat(64)},worksheet:{id:'sheet',name:'Bid',visibility:'visible'},selection:{kind:'used_range',address:'Bid!A1:B2'},rowCount:2,columnCount:2,cells:[['Description','Cost'].map(cell),['Wire',100].map(cell)],capturedAt:'2026-09-12T09:00:00.000Z'}
 const response=await checkExcel(new Request('http://localhost/api/integrations/excel/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot,reviewId:crypto.randomUUID(),reportHash:'a'.repeat(64),runId:crypto.randomUUID(),reviewed:false})}))
 expect(response.status).toBe(409)
})
