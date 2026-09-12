import {describe,expect,it} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
import {stageImportFiles} from '../src/lib/documents'
import {hashImportAnalysis,sha256Bytes,verifyImportReviewContract,type ImportReviewAnalysis,type ImportReviewRecord} from '../src/lib/import-contract'
import {IMPORT_PARSER_VERSION,parseEstimateFileWithReport} from '../src/lib/spreadsheet'

async function contract(file:File){
 const parsed=await parseEstimateFileWithReport(file);const analysis:ImportReviewAnalysis={parserVersion:IMPORT_PARSER_VERSION,importKind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'},reports:[parsed.report],issues:parsed.report.issues};const reportHash=hashImportAnalysis(analysis)
 const review:ImportReviewRecord={id:crypto.randomUUID(),organizationId:crypto.randomUUID(),userId:crypto.randomUUID(),importKind:'new_estimate',parserVersion:IMPORT_PARSER_VERSION,reportHash,context:analysis.context,reports:analysis.reports,issues:analysis.issues,status:'staged',expiresAt:new Date(Date.now()+60_000).toISOString(),files:[{id:crypto.randomUUID(),role:'estimate',ordinal:0,fileName:file.name,storagePath:'org/import-staging/review/estimate/file.csv',mimeType:'text/csv',sizeBytes:file.size,sha256:sha256Bytes(await file.arrayBuffer()),extractedText:'',worksheet:'CSV'}]}
 return{analysis,review,reportHash}
}

describe('durable import review contracts',()=>{
 it('accepts the exact reviewed bytes and rejects preview-A/commit-B substitution',async()=>{
  const fileA=new File(['Description,Cost\nWire,100'],'bid.csv',{type:'text/csv'});const fileB=new File(['Description,Cost\nWire,900'],'bid.csv',{type:'text/csv'});const{analysis,review,reportHash}=await contract(fileA)
  await expect(verifyImportReviewContract({review,importKind:'new_estimate',submittedReportHash:reportHash,files:[{role:'estimate',file:fileA}],analysis})).resolves.toBeUndefined()
  await expect(verifyImportReviewContract({review,importKind:'new_estimate',submittedReportHash:reportHash,files:[{role:'estimate',file:fileB}],analysis})).rejects.toThrow('changed after preview')
 })
 it('rejects a tampered report hash, changed parser version, or expired review',async()=>{
  const file=new File(['Description,Cost\nWire,100'],'bid.csv',{type:'text/csv'});const{analysis,review}=await contract(file)
  await expect(verifyImportReviewContract({review,importKind:'new_estimate',submittedReportHash:'0'.repeat(64),files:[{role:'estimate',file}],analysis})).rejects.toThrow('does not match')
  await expect(verifyImportReviewContract({review:{...review,parserVersion:'older-parser'},importKind:'new_estimate',submittedReportHash:review.reportHash,files:[{role:'estimate',file}],analysis})).rejects.toThrow('parser changed')
  await expect(verifyImportReviewContract({review:{...review,expiresAt:new Date(Date.now()-1).toISOString()},importKind:'new_estimate',submittedReportHash:review.reportHash,files:[{role:'estimate',file}],analysis})).rejects.toThrow('expired')
 })
 it('removes already staged objects when a later source upload fails',async()=>{
  const uploaded:string[]=[],removed:string[]=[];let calls=0
  const supabase={storage:{from:()=>({upload:async(path:string)=>{calls+=1;if(calls===2)return{error:new Error('storage unavailable')};uploaded.push(path);return{error:null}},remove:async(paths:string[])=>{removed.push(...paths);return{error:null}}})}} as unknown as SupabaseClient
  await expect(stageImportFiles({supabase,organizationId:crypto.randomUUID(),reviewId:crypto.randomUUID(),files:[{role:'estimate',file:new File(['a'],'a.csv')},{role:'project_document',file:new File(['b'],'b.txt')}]})).rejects.toThrow('storage unavailable')
  expect(uploaded).toHaveLength(1);expect(removed).toEqual(uploaded)
 })
})
