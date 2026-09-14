import 'server-only'

import { PDFParse } from 'pdf-parse'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256Bytes, type ImportFileRole, type StagedImportFile } from '@/lib/import-contract'

export async function extractDocumentText(file: File) {
  const name=file.name.toLowerCase()
  if(name.endsWith('.txt')||name.endsWith('.md')||file.type.startsWith('text/')) return (await file.text()).slice(0,100000)
  if(name.endsWith('.pdf')||file.type==='application/pdf'){
    const parser=new PDFParse({data:new Uint8Array(await file.arrayBuffer())})
    try { const result=await parser.getText(); return result.text.slice(0,150000) } finally { await parser.destroy() }
  }
  return ''
}

function safeName(name:string){ return name.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120) || 'file' }

export async function stageImportFiles(args:{supabase:SupabaseClient;organizationId:string;reviewId:string;pathScope?:string;files:Array<{role:ImportFileRole;ordinal?:number;file:File;worksheet?:string|null;extractedText?:string;sourceType?:StagedImportFile['sourceType'];sourceAdapterVersion?:string;sourceMetadata?:Record<string,unknown>;canonicalSnapshotHash?:string;sourceCapturedAt?:string}>}):Promise<StagedImportFile[]>{
 const staged:StagedImportFile[]=[]
 try{
  for(const source of args.files){
   const bytes=new Uint8Array(await source.file.arrayBuffer());const fileId=crypto.randomUUID();const ordinal=source.ordinal??0
   const root=args.pathScope?`${args.organizationId}/${args.pathScope}/reviews/${args.reviewId}`:`${args.organizationId}/import-staging/${args.reviewId}`
   const path=`${root}/${source.role}/${ordinal}-${fileId}-${safeName(source.file.name)}`
   const {error}=await args.supabase.storage.from('job-files').upload(path,Buffer.from(bytes),{contentType:source.file.type||'application/octet-stream',upsert:false})
   if(error)throw error
   const sourceType=source.sourceType??(source.role==='estimate'||source.role==='actuals'?(source.file.name.toLowerCase().endsWith('.csv')?'csv_upload':'xlsx_upload'):undefined)
   staged.push({id:fileId,role:source.role,ordinal,fileName:source.file.name,storagePath:path,mimeType:source.file.type||'application/octet-stream',sizeBytes:source.file.size,sha256:sha256Bytes(bytes),extractedText:source.extractedText??'',worksheet:source.worksheet??null,sourceType,sourceAdapterVersion:source.sourceAdapterVersion,sourceMetadata:source.sourceMetadata,canonicalSnapshotHash:source.canonicalSnapshotHash,sourceCapturedAt:source.sourceCapturedAt})
  }
  return staged
 }catch(error){if(staged.length)await args.supabase.storage.from('job-files').remove(staged.map(file=>file.storagePath));throw error}
}

export async function removeStagedImportFiles(supabase:SupabaseClient,files:StagedImportFile[]){if(files.length)await supabase.storage.from('job-files').remove(files.map(file=>file.storagePath))}

export async function uploadDocument(args:{supabase:SupabaseClient;organizationId:string;ownerType:'job'|'estimate';ownerId:string;kind:'estimate'|'actuals'|'notes'|'project_document';file:File;extractedText?:string}){
  const {supabase,organizationId,ownerType,ownerId,kind,file}=args
  const path=`${organizationId}/${ownerId}/${kind}/${crypto.randomUUID()}-${safeName(file.name)}`
  const bytes=Buffer.from(await file.arrayBuffer())
  const {error:uploadError}=await supabase.storage.from('job-files').upload(path,bytes,{contentType:file.type||undefined,upsert:false})
  if(uploadError)throw uploadError
  let extractedText=args.extractedText
  if(extractedText===undefined){
    try { extractedText=await extractDocumentText(new File([bytes],file.name,{type:file.type})) } catch(error){ console.warn('Document text extraction failed:',error); extractedText='' }
  }
  const {error:dbError}=await supabase.from('documents').insert({organization_id:organizationId,job_id:ownerType==='job'?ownerId:null,estimate_id:ownerType==='estimate'?ownerId:null,kind,file_name:file.name,storage_path:path,mime_type:file.type||null,size_bytes:file.size,extracted_text:extractedText??''})
  if(dbError){ await supabase.storage.from('job-files').remove([path]); throw dbError }
  return path
}

// Staged objects are immutable and tenant-private. The closeout RPC atomically
// attaches them to the canonical job. Unattached objects may be retried/cleaned up.
export interface StagedDocument {
 kind:'actuals'|'notes';file_name:string;storage_path:string;mime_type:string;size_bytes:number;extracted_text:string
}
export async function stageCloseoutDocument(args:{supabase:SupabaseClient;organizationId:string;estimateId:string;kind:'actuals'|'notes';file:File;extractedText:string}):Promise<StagedDocument>{
 const path=`${args.organizationId}/${args.estimateId}/closeout/${crypto.randomUUID()}-${safeName(args.file.name)}`
 const {error}=await args.supabase.storage.from('job-files').upload(path,Buffer.from(await args.file.arrayBuffer()),{contentType:args.file.type||'application/octet-stream',upsert:false})
 if(error)throw error
 return{kind:args.kind,file_name:args.file.name,storage_path:path,mime_type:args.file.type||'application/octet-stream',size_bytes:args.file.size,extracted_text:args.extractedText}
}
