import {beforeAll,afterAll,it,expect,vi} from 'vitest'
import pg from 'pg'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {createHash} from 'node:crypto'
import {startDatabase} from './database/harness'
import type {Estimate,Job,Lesson} from '../src/lib/domain/types'
import type {ImportLineProvenanceInput,ImportReviewAnalysis,ImportReviewRecord,StagedImportFile} from '../src/lib/import-contract'

const importRouteHooks=vi.hoisted(()=>({
 currentJob:undefined as Job|undefined,
 currentEstimate:undefined as Estimate|undefined,
 reviews:new Map<string,ImportReviewRecord>(),
}))
vi.mock('@/lib/repository/store',()=>({
 getEstimate:async(id:string)=>importRouteHooks.currentEstimate?.id===id?importRouteHooks.currentEstimate:undefined,
 getAuthenticatedSupabase:async()=>({supabase:{},organizationId:orgA,userId:actorA}),
 cleanupExpiredImportReviews:async()=>0,
 createImportReviewRecord:async(args:{id:string;analysis:ImportReviewAnalysis;files:StagedImportFile[];expiresAt:string})=>{
  const{hashImportAnalysis}=await import('../src/lib/import-contract');const reportHash=hashImportAnalysis(args.analysis)
  await database.db.query('select public.create_import_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[orgA,actorA,args.id,args.analysis.importKind,args.analysis.parserVersion,reportHash,args.analysis.context,args.analysis.reports,args.analysis.issues,args.analysis.completeness??null,args.files.map(file=>({id:file.id,role:file.role,ordinal:file.ordinal,file_name:file.fileName,storage_path:file.storagePath,mime_type:file.mimeType,size_bytes:file.sizeBytes,sha256:file.sha256,extracted_text:file.extractedText,worksheet:file.worksheet,source_type:file.sourceType??null,source_adapter_version:file.sourceAdapterVersion??null,source_metadata:file.sourceMetadata??{},canonical_snapshot_hash:file.canonicalSnapshotHash??null,source_captured_at:file.sourceCapturedAt??null})),args.expiresAt].map(value=>typeof value==='object'&&!(value instanceof Date)?JSON.stringify(value):value))
  importRouteHooks.reviews.set(args.id,{id:args.id,organizationId:orgA,userId:actorA,importKind:args.analysis.importKind,parserVersion:args.analysis.parserVersion,reportHash,context:args.analysis.context,reports:args.analysis.reports,issues:args.analysis.issues,completeness:args.analysis.completeness,status:'staged',expiresAt:args.expiresAt,files:args.files});return args.id
 },
 getImportReviewRecord:async(id:string)=>{const review=importRouteHooks.reviews.get(id);if(!review)throw new Error('review missing');return review},
 commitReviewedHistoricalJob:async(args:{reviewId:string;reportHash:string;acknowledged:string[];job:Job;lessons:Lesson[];estimateProvenance:ImportLineProvenanceInput[];actualProvenance:ImportLineProvenanceInput[]})=>{
  const estimateLines=args.job.estimateLines.map(line=>({id:line.id,category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,estimated_hours:line.estimatedHours??null,estimated_cost:line.estimatedCost}));const actualLines=args.job.actualLines.map(line=>({id:line.id,category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,actual_hours:line.actualHours??null,actual_cost:line.actualCost}));const variances=args.job.variances.map(value=>({category:value.category,estimated_cost:value.estimatedCost,actual_cost:value.actualCost,estimated_hours:value.estimatedHours,actual_hours:value.actualHours,cost_delta:value.costDelta,cost_delta_pct:value.costDeltaPct,hours_delta:value.hoursDelta,hours_delta_pct:value.hoursDeltaPct}));const lessons=args.lessons.map(value=>({id:value.id,title:value.title,category:value.category,lesson:value.lesson,cause:value.cause,impact_summary:value.impactSummary,confidence:value.confidence,status:value.status,created_at:value.createdAt}));const payload={scope_review:args.job.scopeReview,id:args.job.id,name:args.job.name,project_type:args.job.projectType,customer_type:args.job.customerType,location:args.job.location,completed_at:args.job.completedAt,tags:args.job.tags,notes:args.job.notes,estimated_total:args.job.estimatedTotal,actual_total:args.job.actualTotal}
  const result=await database.db.query('select public.commit_historical_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) id',[orgA,actorA,args.reviewId,args.reportHash,args.acknowledged,JSON.stringify(payload),JSON.stringify(estimateLines),JSON.stringify(actualLines),JSON.stringify(variances),JSON.stringify(lessons),JSON.stringify(args.estimateProvenance),JSON.stringify(args.actualProvenance)]);importRouteHooks.currentJob=args.job;const review=importRouteHooks.reviews.get(args.reviewId);if(review)importRouteHooks.reviews.set(args.reviewId,{...review,status:'committed',resultJobId:result.rows[0].id});return result.rows[0].id
 },
 getJob:async(id:string)=>importRouteHooks.currentJob?.id===id?importRouteHooks.currentJob:undefined,
 getExcelSourceBinding:async(sourceIdentityHash:string)=>{const result=await database.db.query('select latest_snapshot_hash,latest_profile_hash,latest_review_id,latest_estimate_id from public.estimate_source_bindings where organization_id=$1 and source_identity_hash=$2',[orgA,sourceIdentityHash]);const row=result.rows[0];return row?{latestSnapshotHash:row.latest_snapshot_hash,latestProfileHash:row.latest_profile_hash,latestReviewId:row.latest_review_id,latestEstimateId:row.latest_estimate_id}:undefined},
 createExcelIntegrationRun:async(args:{id:string;sourceIdentityHash:string;snapshotHash:string;adapterVersion:string;capturedAt:string;status:string;reviewId?:string;failureStage?:string;errorMessage?:string})=>{await database.db.query('insert into public.excel_integration_runs(id,organization_id,user_id,source_identity_hash,snapshot_hash,adapter_version,captured_at,status,review_id,failure_stage,error_message) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[args.id,orgA,actorA,args.sourceIdentityHash,args.snapshotHash,args.adapterVersion,args.capturedAt,args.status,args.reviewId??null,args.failureStage??null,args.errorMessage??null])},
 updateExcelIntegrationRun:async(runId:string,args:{reviewId:string;status:string;estimateId?:string;failureStage?:string;errorMessage?:string})=>{await database.db.query('update public.excel_integration_runs set status=$1,estimate_id=coalesce($2,estimate_id),failure_stage=$3,error_message=$4,updated_at=now() where id=$5 and organization_id=$6 and user_id=$7 and review_id=$8',[args.status,args.estimateId??null,args.failureStage??null,args.errorMessage??null,runId,orgA,actorA,args.reviewId])},
 getLatestInvestigationId:async()=>undefined,
 updateLatestExcelRunForEstimate:async()=>undefined,
 commitReviewedEstimate:async(args:{reviewId:string;reportHash:string;acknowledged:string[];estimate:Estimate;provenance:ImportLineProvenanceInput[];parentEstimateId?:string})=>{const payload={id:args.estimate.id,name:args.estimate.name,project_type:args.estimate.projectType,customer_type:args.estimate.customerType,location:args.estimate.location,bid_due:args.estimate.bidDue??'',tags:args.estimate.tags,assumptions:args.estimate.assumptions,created_at:args.estimate.createdAt,parent_estimate_id:args.parentEstimateId??null,baseline_role:args.parentEstimateId?'revision':'original_bid'};const lines=args.estimate.lines.map(line=>({id:line.id,category:line.category,description:line.description,quantity:line.quantity??null,unit:line.unit??null,normalized_unit:line.normalizedUnit??null,unit_cost:line.unitCost??null,cost_code:line.costCode??null,phase:line.phase??null,division:line.division??null,estimated_hours:line.estimatedHours??null,estimated_cost:line.estimatedCost}));const result=await database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,actorA,args.reviewId,args.reportHash,args.acknowledged,JSON.stringify(payload),JSON.stringify(lines),JSON.stringify(args.provenance)]);const id=result.rows[0].id;importRouteHooks.currentEstimate={...args.estimate,id,revisionNumber:args.parentEstimateId?1:0,parentEstimateId:args.parentEstimateId,baselineRole:args.parentEstimateId?'revision':'original_bid'};const review=importRouteHooks.reviews.get(args.reviewId);if(review)importRouteHooks.reviews.set(args.reviewId,{...review,status:'committed',resultEstimateId:id});return id},commitReviewedCloseout:async()=>{throw new Error('unused')},
}))
vi.mock('@/lib/documents',()=>({extractDocumentText:async()=>'',removeStagedImportFiles:async()=>undefined,stageImportFiles:async(args:{organizationId:string;reviewId:string;files:Array<{role:'estimate'|'actuals'|'notes'|'project_document';ordinal?:number;file:File;worksheet?:string|null;extractedText?:string;sourceType?:StagedImportFile['sourceType'];sourceAdapterVersion?:string;sourceMetadata?:Record<string,unknown>;canonicalSnapshotHash?:string;sourceCapturedAt?:string}>})=>{const{sha256Bytes}=await import('../src/lib/import-contract');const staged:StagedImportFile[]=[];for(const source of args.files){const id=crypto.randomUUID(),path=`${orgA}/import-staging/${args.reviewId}/${source.role}/${id}-${source.file.name}`;await database.db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[path]);staged.push({id,role:source.role,ordinal:source.ordinal??0,fileName:source.file.name,storagePath:path,mimeType:source.file.type||'application/octet-stream',sizeBytes:source.file.size,sha256:sha256Bytes(await source.file.arrayBuffer()),extractedText:source.extractedText??'',worksheet:source.worksheet??null,sourceType:source.sourceType,sourceAdapterVersion:source.sourceAdapterVersion,sourceMetadata:source.sourceMetadata,canonicalSnapshotHash:source.canonicalSnapshotHash,sourceCapturedAt:source.sourceCapturedAt})}return staged}}))
vi.mock('@/lib/agent/preflight',()=>({runPreflight:async(id:string)=>importRouteHooks.currentEstimate?.id===id?{...importRouteHooks.currentEstimate,status:'ready',investigationStatus:'completed',agentSummary:'No material historical risk found.'}:undefined}))
vi.mock('@/lib/embeddings/provider',()=>({embeddingsEnabled:()=>false}))
vi.mock('@/lib/embeddings',()=>({embeddingsEnabled:()=>false}))

import {POST as previewImport} from '../src/app/api/import/preview/route'
import {POST as commitHistoricalImport} from '../src/app/api/jobs/import/route'
import {POST as previewExcelImport} from '../src/app/api/integrations/excel/preview/route'
import {POST as checkExcelImport} from '../src/app/api/integrations/excel/check/route'
let database:Awaited<ReturnType<typeof startDatabase>>
const actorA=crypto.randomUUID(),actorB=crypto.randomUUID(),orgA=crypto.randomUUID(),orgB=crypto.randomUUID()
const legacyDemoActor=crypto.randomUUID(),legacyDemoOrg=crypto.randomUUID(),legacyDemoEstimate=crypto.randomUUID()
const uid=()=>crypto.randomUUID()
async function asUser<T>(actor:string,run:(db:pg.Client)=>Promise<T>){const db=new pg.Client(database.config);await db.connect();try{await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return await run(db)}finally{await db.end()}}
async function asTrusted<T>(actor:string,run:(db:pg.Client)=>Promise<T>){const db=new pg.Client(database.config);await db.connect();try{await db.query('set role service_role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return await run(db)}finally{await db.end()}}
async function demoWorkspace(){const actor=uid(),org=uid();await database.db.query('insert into auth.users(id) values($1)',[actor]);await database.db.query('insert into public.organizations(id,name,created_by) values($1,$2,$3)',[org,'Demo test tenant',actor]);await database.db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",[org,actor]);return{actor,org}}
function demoSeedPayload(){
 const jobId=uid(),estimateId=uid()
 return{jobId,estimateId,jobs:[{job:{id:jobId,scope_review:{status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'},name:'Sample completed job',project_type:'Office',completed_at:'2026-01-01',estimate_baseline_role:'historical_unknown',data_origin:'demo'},estimate_lines:[{id:uid(),category:'labor',description:'Labor',estimated_cost:100,estimated_hours:10}],actual_lines:[{id:uid(),category:'labor',description:'Labor',actual_cost:125,actual_hours:12}],variances:[],lessons:[{id:uid(),title:'Sample lesson',category:'labor',lesson:'Sample only',cause:'Sample',impact_summary:'Sample',confidence:.8,status:'confirmed'}]}],estimate:{estimate:{id:estimateId,name:'Sample estimate',project_type:'Office',data_origin:'demo'},lines:[{id:uid(),category:'labor',description:'Labor',estimated_cost:100,estimated_hours:10}]}}
}
async function seedDemo(org:string,actor:string,payload=demoSeedPayload(),version='demo-v1'){return asTrusted(actor,db=>db.query('select public.seed_demo_workspace_server($1,$2,$3,$4,$5) result',[org,actor,version,JSON.stringify(payload.jobs),JSON.stringify(payload.estimate)]))}
async function stagedImportReview(args:{kind:'new_estimate'|'historical_job'|'closeout_actual';context?:Record<string,string|null>;issues?:unknown[];expiresAt?:string;roles?:Array<'estimate'|'actuals'|'notes'>}){
 const reviewId=uid(),hash='a'.repeat(64),context=args.context??{},roles=args.roles??(args.kind==='new_estimate'?['estimate']:args.kind==='historical_job'?['estimate','actuals']:['actuals']);const files=[]
 for(const role of roles){const fileId=uid();const root=args.kind==='closeout_actual'?`${orgA}/${context.estimateId}/closeout/reviews/${reviewId}`:`${orgA}/import-staging/${reviewId}`;const storagePath=`${root}/${role}/${fileId}.csv`;await database.db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[storagePath]);files.push({id:fileId,role,ordinal:0,file_name:`${role}.csv`,storage_path:storagePath,mime_type:'text/csv',size_bytes:20,sha256:'b'.repeat(64),extracted_text:'',worksheet:'CSV'})}
 await database.db.query('select public.create_import_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[orgA,actorA,reviewId,args.kind,'2026-09-p1-v1',hash,JSON.stringify(context),'[]',JSON.stringify(args.issues??[]),null,JSON.stringify(files),args.expiresAt??new Date(Date.now()+60_000).toISOString()])
 return{reviewId,hash,files}
}
async function stagedExcelReview(args:{snapshotHash:string;sourceIdentityHash:string;profileHash:string;parentEstimateId?:string|null;org?:string;actor?:string}){
 const org=args.org??orgA,actor=args.actor??actorA,reviewId=uid(),hash='e'.repeat(64),fileId=uid(),storagePath=`${org}/import-staging/${reviewId}/estimate/0-${fileId}-snapshot.json`
 await database.db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[storagePath])
 const context={sourceType:'excel_live_snapshot',sourceIdentityHash:args.sourceIdentityHash,snapshotHash:args.snapshotHash,sourceAdapterVersion:'office-js-excel-live-v1',sourceCapturedAt:'2026-09-12T09:00:00.000Z',profile:'{}',profileHash:args.profileHash,parentEstimateId:args.parentEstimateId??null,baselineRole:args.parentEstimateId?'revision':'original_bid'}
 const files=[{id:fileId,role:'estimate',ordinal:0,file_name:'bid.margin-memory.json',storage_path:storagePath,mime_type:'application/json',size_bytes:100,file_sha256:'d'.repeat(64),sha256:'d'.repeat(64),extracted_text:'',worksheet:'Bid Detail',source_type:'excel_live_snapshot',source_adapter_version:'office-js-excel-live-v1',source_metadata:{sourceIdentityHash:args.sourceIdentityHash,worksheetId:'sheet-detail'},canonical_snapshot_hash:args.snapshotHash,source_captured_at:'2026-09-12T09:00:00.000Z'}]
 await database.db.query('select public.create_import_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[org,actor,reviewId,'new_estimate','2026-09-p1-v1',hash,JSON.stringify(context),'[]','[]',null,JSON.stringify(files),new Date(Date.now()+60_000).toISOString()])
 return{reviewId,hash,files,context}
}
async function job(org=orgA,actor=actorA){const id=uid();await asTrusted(actor,db=>db.query('select public.create_completed_job_server($1,$2,$3,$4,$5,$6,$7)',[org,actor,{id,scope_review:{status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'},name:'Completed job',project_type:'Office',completed_at:'2026-01-01',estimated_total:100,actual_total:125,estimate_baseline_role:'final_submitted',data_origin:'production'},[{id:uid(),category:'labor',description:'Labor',estimated_cost:100,estimated_hours:10}],[{id:uid(),category:'labor',description:'Labor',actual_cost:125,actual_hours:12}],[],[]].map(value=>typeof value==='string'?value:JSON.stringify(value))));return id}
async function indexMemory(org:string,actor:string,sourceType:'job'|'lesson',sourceId:string,content:string,vector:string){
 await asTrusted(actor,db=>db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[org,actor]))
 const hash=createHash('sha256').update(content).digest('hex')
 await asTrusted(actor,db=>db.query('select public.enqueue_memory_index_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[org,actor,sourceType,sourceId,content,hash,sourceType==='job'?'job-memory-v2':'lesson-memory-v2','bedrock','amazon.titan-embed-text-v1',1536]))
 const claimed=await asTrusted(actor,db=>db.query('select * from public.claim_memory_index_jobs($1,$2,$3,$4)',[org,actor,uid(),50]))
 for(const item of claimed.rows)await asTrusted(actor,db=>db.query('select public.complete_memory_index_job($1,$2,$3,$4,$5,$6)',[org,actor,item.id,item.lease_token,item.desired_content_hash,vector]))
}
async function memoryJob(baseline:'original_bid'|'final_submitted'|'historical_unknown'='final_submitted',origin:'production'|'demo'|'synthetic_test'='production'){
 const id=uid();await asTrusted(actorA,db=>db.query('select public.create_completed_job_server($1,$2,$3,$4,$5,$6,$7)',[orgA,actorA,{id,scope_review:{status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'},name:'Memory candidate',project_type:'Office retrofit',customer_type:'Commercial',completed_at:'2026-01-01',estimate_baseline_role:baseline,data_origin:origin},[{id:uid(),category:'labor',description:'Labor',estimated_cost:100,estimated_hours:10}],[{id:uid(),category:'labor',description:'Labor',actual_cost:125,actual_hours:12}],[],[]].map(value=>typeof value==='string'?value:JSON.stringify(value))));return id
}
async function estimate(org=orgA,actor=actorA){const id=uid();await asTrusted(actor,db=>db.query('select public.create_estimate_with_lines($1,$2)',[{id,organization_id:org,name:'Bid',project_type:'Office',estimated_total:100,estimated_labor_hours:10},[{id:uid(),category:'labor',description:'Labor',estimated_cost:100,estimated_hours:10}]].map(value=>JSON.stringify(value))));return id}
async function begin(id:string,inv=uid()){await database.db.query('select public.begin_investigation($1,$2,$3,$4)',[orgA,id,inv,actorA]);return inv}
function setHistoricalMetadata(data:FormData,name:string,date='2026-08-01'){data.set('name',name);data.set('projectType','Office retrofit');data.set('customerType','Commercial');data.set('completedAt',date)}
async function transition(id:string,to:string){return asUser(actorA,db=>db.query('select public.transition_estimate_lifecycle($1,$2,$3,$4,$5)',[orgA,id,to,'test',150]))}
async function prepared(withFinding=false){const id=await estimate();const inv=await begin(id);const findingId=uid();let findings:unknown[]=[]
 if(withFinding){const jobId=await job();const search=uid(),calc=uid();for(const entry of [{id:search,investigationId:inv,kind:'search',toolName:'search_similar_jobs',result:{jobIds:[jobId]}},{id:calc,investigationId:inv,kind:'calculation',toolName:'calculate_category_risk',result:{category:'labor',comparableJobIds:[jobId],sampleSize:1,overrunCount:1,medianVariancePct:0.2}}])await database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,entry]);findings=[{id:findingId,category:'labor',severity:'high',title:'Review labor',claim:'Persisted calculation',rationale:'Evidence',recommendation:'Check access',confidence:0.7,evidenceRefs:[calc],evidence:[{jobId,label:'Completed job',detail:'Cost difference 25'}]}]}
 await database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,id,inv,'Review','deterministic',{cycleCount:0,toolsUsed:[]},JSON.stringify(findings),'[]',actorA]);return{id,inv,findingId}}
async function atStage(stage:string,withFinding=false){const result=await prepared(withFinding);if(withFinding)await asUser(actorA,db=>db.query('select public.set_finding_status($1,$2,$3)',[orgA,result.findingId,'resolved']));for(const next of ['reviewed','submitted','won','in_progress','completed']){if(stage==='draft')break;await transition(result.id,next);if(next===stage)break;if(stage==='lost'&&next==='submitted'){await transition(result.id,'lost');break}}return result}
async function seedPre021DemoFixture(db:pg.Client){
 await db.query('insert into auth.users(id) values($1)',[legacyDemoActor])
 await db.query('insert into public.organizations(id,name,created_by) values($1,$2,$3)',[legacyDemoOrg,'Legacy demo tenant',legacyDemoActor])
 await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",[legacyDemoOrg,legacyDemoActor])
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[legacyDemoActor])
 const names=['Baker Office Renovation','Delta Dental TI','Ford Street Retail Refresh','Maple Apartments Common Areas','Union Bank Branch','Harbor Medical Suite','Ridge Warehouse Lighting','Oak Street Restaurant']
 for(const name of names)await db.query("insert into public.jobs(id,organization_id,created_by,name,project_type,completed_at,created_at,estimate_baseline_role,data_origin) values($1,$2,$3,$4,'Demo fixture','2026-09-01','2026-09-12T10:00:00Z','historical_unknown','demo')",[uid(),legacyDemoOrg,legacyDemoActor,name])
 await db.query("insert into public.estimates(id,organization_id,created_by,name,project_type,customer_type,location,bid_due,tags,assumptions,estimated_total,estimated_labor_hours,status,investigation_status,agent_mode,lifecycle_status,revision_group_id,revision_number,baseline_role,created_at) values($1,$2,$3,'Riverside Office – Level 3','Office retrofit','Commercial','Philadelphia, PA','2026-09-11',$4,$5,35150,118,'draft','queued',null,'draft',$1,0,'original_bid','2026-09-12T10:05:00Z')",[legacyDemoEstimate,legacyDemoOrg,legacyDemoActor,['occupied','retrofit','conduit-reuse'],['Existing conduit can be reused where accessible','Normal daytime access to work areas','Lighting quote reflects current schedule']])
 for(const [category,description,cost,hours] of [['labor','Level 3 electrical retrofit labor',8850,118],['materials','Wire, devices and lighting',24400,null],['equipment','Access equipment allowance',900,null],['permit','Permit allowance',1000,null]] as const)await db.query('insert into public.estimate_lines(id,organization_id,estimate_id,category,description,estimated_cost,estimated_hours) values($1,$2,$3,$4,$5,$6,$7)',[uid(),legacyDemoOrg,legacyDemoEstimate,category,description,cost,hours])
 await db.query("update public.estimates set investigation_status='failed' where id=$1",[legacyDemoEstimate])
}
beforeAll(async()=>{database=await startDatabase({beforeMigration:async(migration,db)=>{if(migration==='202609120021_safe_demo_seed.sql')await seedPre021DemoFixture(db)}});await database.db.query('insert into auth.users(id) values($1),($2)',[actorA,actorB]);for(const [org,actor] of [[orgA,actorA],[orgB,actorB]]){await database.db.query('insert into public.organizations(id,name,created_by) values($1,$2,$3)',[org,'Test tenant',actor]);await database.db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",[org,actor])}})
afterAll(async()=>{if(database)await database.stop()})
it('applies all migrations from zero',async()=>{const result=await database.db.query("select count(*)::int n from information_schema.tables where table_schema='public'");expect(result.rows[0].n).toBeGreaterThan(15)})
it('backfills only the exact pre-021 demo estimate so the tenant-safe reset removes the failed legacy seed',async()=>{
 expect((await database.db.query('select data_origin from public.estimates where organization_id=$1 and id=$2',[legacyDemoOrg,legacyDemoEstimate])).rows[0].data_origin).toBe('demo')
 const reset=await asTrusted(legacyDemoActor,db=>db.query('select public.reset_demo_workspace_server($1,$2) result',[legacyDemoOrg,legacyDemoActor]))
 expect(reset.rows[0].result).toMatchObject({jobs:8,estimates:1})
 expect((await database.db.query('select count(*)::int n from public.jobs where organization_id=$1',[legacyDemoOrg])).rows[0].n).toBe(0)
 expect((await database.db.query('select count(*)::int n from public.estimates where organization_id=$1',[legacyDemoOrg])).rows[0].n).toBe(0)
})
it('creates a fresh production organization with no implicit demo history',async()=>{const{org}=await demoWorkspace();expect((await database.db.query('select count(*)::int n from public.jobs where organization_id=$1',[org])).rows[0].n).toBe(0);expect((await database.db.query('select count(*)::int n from public.estimates where organization_id=$1',[org])).rows[0].n).toBe(0)})
it('seeds demo core data atomically, with durable origin and idempotent replay',async()=>{
 const{org,actor}=await demoWorkspace(),payload=demoSeedPayload();const first=await seedDemo(org,actor,payload),second=await seedDemo(org,actor,demoSeedPayload())
 expect(first.rows[0].result.estimateId).toBe(payload.estimateId);expect(second.rows[0].result).toMatchObject({estimateId:payload.estimateId,reused:true})
 expect((await database.db.query('select count(*)::int n from public.jobs where organization_id=$1',[org])).rows[0].n).toBe(1)
 expect((await database.db.query('select data_origin from public.jobs where id=$1',[payload.jobId])).rows[0].data_origin).toBe('demo')
 expect((await database.db.query('select data_origin from public.estimates where id=$1',[payload.estimateId])).rows[0].data_origin).toBe('demo')
 expect((await database.db.query('select count(*)::int n from public.lessons where organization_id=$1',[org])).rows[0].n).toBe(1)
})
it('leases demo preflight once, retries failed work, and makes completion idempotent',async()=>{
 const{org,actor}=await demoWorkspace();await seedDemo(org,actor)
 const claim=()=>asTrusted(actor,db=>db.query("select public.claim_demo_preflight_server($1,$2,'demo-v1') result",[org,actor]))
 const first=(await claim()).rows[0].result;expect(first).toMatchObject({claimed:true,status:'preflight_running',leaseToken:expect.any(String)})
 expect((await claim()).rows[0].result).toMatchObject({claimed:false,status:'preflight_running'})
 await expect(asTrusted(actor,db=>db.query("select public.finish_demo_seed_server($1,$2,'demo-v1',$3,false,'provider timeout')",[org,actor,uid()]))).rejects.toThrow('lease lost')
 await asTrusted(actor,db=>db.query("select public.finish_demo_seed_server($1,$2,'demo-v1',$3,false,'provider timeout')",[org,actor,first.leaseToken]))
 const retry=(await claim()).rows[0].result;expect(retry.claimed).toBe(true);expect(retry.leaseToken).not.toBe(first.leaseToken)
 await asTrusted(actor,db=>db.query("select public.finish_demo_seed_server($1,$2,'demo-v1',$3,true,null)",[org,actor,retry.leaseToken]))
 expect((await claim()).rows[0].result).toMatchObject({claimed:false,status:'complete'})
})
it('keeps revisions and closeout-derived jobs from demo estimates non-production',async()=>{
 const{org,actor}=await demoWorkspace(),payload=demoSeedPayload();await seedDemo(org,actor,payload)
 const revision=uid();await asTrusted(actor,db=>db.query('select public.create_estimate_server($1,$2,$3,$4)',[org,actor,{id:revision,name:'Sample revision',project_type:'Office',parent_estimate_id:payload.estimateId,baseline_role:'revision'},[{id:uid(),category:'labor',description:'Labor',estimated_cost:110}]].map(value=>typeof value==='string'?value:JSON.stringify(value))))
 expect((await database.db.query('select data_origin from public.estimates where id=$1',[revision])).rows[0].data_origin).toBe('demo')
 const derived=uid();await database.db.query("insert into public.jobs(id,organization_id,created_by,name,project_type,completed_at,source_estimate_id,data_origin) values($1,$2,$3,'Sample closeout','Office','2026-01-03',$4,'production')",[derived,org,actor,revision])
 expect((await database.db.query('select data_origin from public.jobs where id=$1',[derived])).rows[0].data_origin).toBe('demo')
})
it('rolls back every demo core write when one seeded record is invalid',async()=>{
 const{org,actor}=await demoWorkspace(),payload=demoSeedPayload(),bad=structuredClone(payload);bad.jobs.push({...structuredClone(bad.jobs[0]),job:{...bad.jobs[0].job,id:uid(),name:'Invalid second sample'},estimate_lines:[{...bad.jobs[0].estimate_lines[0],id:uid(),category:'invalid'}]})
 await expect(seedDemo(org,actor,bad)).rejects.toThrow()
 expect((await database.db.query('select count(*)::int n from public.jobs where organization_id=$1',[org])).rows[0].n).toBe(0)
 expect((await database.db.query('select count(*)::int n from public.estimates where organization_id=$1',[org])).rows[0].n).toBe(0)
 expect((await database.db.query('select count(*)::int n from public.demo_seed_operations where organization_id=$1',[org])).rows[0].n).toBe(0)
})
it('resets only demonstrably demo-origin records and enforces the tenant/service boundary',async()=>{
 const{org,actor}=await demoWorkspace(),payload=demoSeedPayload();await seedDemo(org,actor,payload)
 const investigation=uid();await database.db.query('select public.begin_investigation($1,$2,$3,$4)',[org,payload.estimateId,investigation,actor]);await database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[org,investigation,actor,{id:uid(),investigationId:investigation,kind:'calibration',toolName:'get_warning_calibration',result:{total:0,evaluable:0,hitRate:null}}])
 const productionJob=uid();await asTrusted(actor,db=>db.query('select public.create_completed_job_server($1,$2,$3,$4,$5,$6,$7)',[org,actor,{id:productionJob,scope_review:{status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'},name:'Real job',project_type:'Office',completed_at:'2026-01-02',estimate_baseline_role:'final_submitted',data_origin:'production'},[{id:uid(),category:'labor',description:'Labor',estimated_cost:100}],[{id:uid(),category:'labor',description:'Labor',actual_cost:100}],[],[]].map(value=>typeof value==='string'?value:JSON.stringify(value))))
 await expect(asTrusted(actorB,db=>db.query('select public.reset_demo_workspace_server($1,$2)',[org,actorB]))).rejects.toThrow('not a member')
 await asUser(actor,db=>expect(db.query('select public.reset_demo_workspace_server($1,$2)',[org,actor])).rejects.toThrow('permission denied'))
 await asTrusted(actor,db=>db.query('select public.reset_demo_workspace_server($1,$2)',[org,actor]))
 expect((await database.db.query('select id from public.jobs where organization_id=$1',[org])).rows.map(row=>row.id)).toEqual([productionJob])
 expect((await database.db.query("select count(*)::int n from public.estimates where organization_id=$1 and data_origin='demo'",[org])).rows[0].n).toBe(0)
})
it('isolates tenant reads and rejects cross-tenant parent references',async()=>{const foreignJob=await job(orgB,actorB);await asUser(actorA,async db=>{expect((await db.query('select * from public.jobs where id=$1',[foreignJob])).rowCount).toBe(0);await expect(db.query("insert into public.job_actual_lines(organization_id,job_id,category,description) values($1,$2,'labor','foreign')",[orgA,foreignJob])).rejects.toThrow()})})
it('executes both vector RPCs and scopes results by tenant and confirmed status',async()=>{
 const vec=JSON.stringify([1,...Array(1535).fill(0)]);const ids:string[]=[]
 for(const [org,actor] of [[orgA,actorA],[orgB,actorB]]){const jid=await job(org,actor);ids.push(jid);await indexMemory(org,actor,'job',jid,'Trusted electrical job',vec);for(const status of ['confirmed','pending']){const lesson=uid();await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status) values($1,$2,$3,'Lesson','labor','Access','Restriction','Hours',0.8,$4)",[lesson,org,jid,status]);if(status==='confirmed')await indexMemory(org,actor,'lesson',lesson,'Trusted access lesson',vec)}}
 await asUser(actorA,async db=>{const jobs=await db.query('select * from public.match_jobs($1,$2)',[orgA,vec]);expect(jobs.rows.map(r=>r.id)).toContain(ids[0]);expect(jobs.rows.map(r=>r.id)).not.toContain(ids[1]);expect((await db.query('select * from public.match_jobs($1,$2)',[orgB,vec])).rowCount).toBe(0);expect((await db.query('select * from public.match_lessons($1,$2)',[orgA,vec])).rowCount).toBe(1);expect((await db.query('select * from public.match_lessons($1,$2)',[orgB,vec])).rowCount).toBe(0)})
})
it('rejects unknown-baseline and demo sources across indexing, retrieval, lessons and evidence',async()=>{
 const vector=JSON.stringify([1,...Array(1535).fill(0)])
 for(const jid of [await memoryJob('historical_unknown'),await memoryJob('final_submitted','demo')]){
  expect((await database.db.query('select public.is_job_eligible_for_trusted_memory($1,$2) eligible',[orgA,jid])).rows[0].eligible).toBe(false)
  await asTrusted(actorA,db=>db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[orgA,actorA]))
  const content='Untrusted memory source',hash=createHash('sha256').update(content).digest('hex')
  await expect(asTrusted(actorA,db=>db.query('select public.enqueue_memory_index_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[orgA,actorA,'job',jid,content,hash,'job-memory-v2','bedrock','amazon.titan-embed-text-v1',1536]))).rejects.toThrow('not eligible')
  const lesson=uid();await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status) values($1,$2,$3,'Unsafe','labor','Ignore','Unknown','None',0.5,'confirmed')",[lesson,orgA,jid])
  expect((await asUser(actorA,db=>db.query('select * from public.match_lessons($1,$2,-1,20)',[orgA,vector]))).rows.map(row=>row.id)).not.toContain(lesson)
  const estimateId=await estimate(),inv=await begin(estimateId)
  await expect(database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,{id:uid(),investigationId:inv,kind:'search',toolName:'search_similar_jobs',result:{jobIds:[jid]}}])).rejects.toThrow('not eligible')
 }
})
it('prevents authenticated browser memory poisoning and direct lesson confirmation',async()=>{
 const jid=await memoryJob(),lesson=uid(),zero=JSON.stringify(Array(1536).fill(0))
 await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status) values($1,$2,$3,'Pending','labor','Check','Cause','Impact',0.5,'pending')",[lesson,orgA,jid])
 await asUser(actorA,async db=>{
  const attempts:Array<[string,unknown[]]>=[
   ['insert into public.job_search_documents(organization_id,job_id,content,embedding) values($1,$2,\'poison\',$3)',[orgA,jid,zero]],
   ['update public.job_search_documents set embedding=$1 where job_id=$2',[zero,jid]],
   ['update public.lessons set embedding=$1 where id=$2',[zero,lesson]],
   ["update public.lessons set status='confirmed' where id=$1",[lesson]],
  ];for(const query of attempts)await expect(db.query(query[0],query[1])).rejects.toThrow('permission denied')
 })
 await asTrusted(actorA,db=>db.query("select public.set_lesson_status_server($1,$2,$3,'confirmed')",[orgA,actorA,lesson]))
 expect((await database.db.query('select status from public.lessons where id=$1',[lesson])).rows[0].status).toBe('confirmed')
})
it('rejects zero, wrong-space and stale-worker vectors while keeping one current index job',async()=>{
 const jid=await memoryJob(),content='Canonical trusted job content',hash=createHash('sha256').update(content).digest('hex'),zero=JSON.stringify(Array(1536).fill(0)),valid=JSON.stringify([1,...Array(1535).fill(0)])
 await asTrusted(actorA,db=>db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[orgA,actorA]))
 await expect(asTrusted(actorA,db=>db.query('select public.enqueue_memory_index_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[orgA,actorA,'job',jid,content,hash,'job-memory-v2','bedrock','cohere.embed-v4:0',1536]))).rejects.toThrow('mismatch')
 await Promise.all([1,2].map(()=>asTrusted(actorA,db=>db.query('select public.enqueue_memory_index_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[orgA,actorA,'job',jid,content,hash,'job-memory-v2','bedrock','amazon.titan-embed-text-v1',1536]))))
 expect(Number((await database.db.query('select count(*) n from public.memory_index_jobs where job_id=$1',[jid])).rows[0].n)).toBe(1)
 const claim=(await asTrusted(actorA,db=>db.query('select * from public.claim_memory_index_jobs($1,$2,$3,$4)',[orgA,actorA,uid(),20]))).rows.find(row=>row.source_id===jid)
 await expect(asTrusted(actorA,db=>db.query('select public.complete_memory_index_job($1,$2,$3,$4,$5,$6)',[orgA,actorA,claim.id,claim.lease_token,hash,zero]))).rejects.toThrow('invalid embedding')
 await expect(asTrusted(actorA,db=>db.query('select public.complete_memory_index_job($1,$2,$3,$4,$5,$6)',[orgA,actorA,claim.id,claim.lease_token,'f'.repeat(64),valid]))).rejects.toThrow('stale')
 await asTrusted(actorA,db=>db.query('select public.complete_memory_index_job($1,$2,$3,$4,$5,$6)',[orgA,actorA,claim.id,claim.lease_token,hash,valid]))
 expect((await database.db.query('select count(*)::int n from public.job_search_documents where job_id=$1 and embedding is not null',[jid])).rows[0].n).toBe(1)
})
it('invalidates edited lessons and quarantined jobs immediately and retains lesson retrieval provenance',async()=>{
 const vector=JSON.stringify([1,...Array(1535).fill(0)]),jid=await memoryJob(),lesson=uid()
 await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status) values($1,$2,$3,'Access','labor','Confirm access','Occupied','Hours',0.8,'confirmed')",[lesson,orgA,jid])
 await indexMemory(orgA,actorA,'job',jid,'Trusted office job',vector);await indexMemory(orgA,actorA,'lesson',lesson,'Trusted access lesson',vector)
 const estimateId=await estimate(),inv=await begin(estimateId),evidenceId=uid()
 await database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,{id:evidenceId,investigationId:inv,kind:'search',toolName:'search_lessons',result:{jobIds:[jid],lessonIds:[lesson],query:'access'}}])
 expect((await database.db.query('select result from public.investigation_evidence where id=$1',[evidenceId])).rows[0].result.lessonIds).toEqual([lesson])
 await asTrusted(actorA,db=>db.query("select public.revise_lesson_server($1,$2,$3,'Updated access','Confirm restricted access','Occupied floor','Twenty hours')",[orgA,actorA,lesson]))
 expect((await database.db.query('select status,embedding from public.lessons where id=$1',[lesson])).rows[0]).toMatchObject({status:'pending',embedding:null})
 expect((await asUser(actorA,db=>db.query('select * from public.match_lessons($1,$2,-1,20)',[orgA,vector]))).rows.map(row=>row.id)).not.toContain(lesson)
 await asTrusted(actorA,db=>db.query("select public.set_lesson_status_server($1,$2,$3,'confirmed')",[orgA,actorA,lesson]));await indexMemory(orgA,actorA,'lesson',lesson,'Updated trusted access lesson',vector)
 await asTrusted(actorA,db=>db.query("select public.quarantine_job_memory_server($1,$2,$3,'Source export was later found incomplete')",[orgA,actorA,jid]))
 expect((await asUser(actorA,db=>db.query('select * from public.match_jobs($1,$2,null,null,-1,20)',[orgA,vector]))).rows.map(row=>row.id)).not.toContain(jid)
 expect((await asUser(actorA,db=>db.query('select * from public.match_lessons($1,$2,-1,20)',[orgA,vector]))).rows.map(row=>row.id)).not.toContain(lesson)
 const nextEstimate=await estimate(),nextInv=await begin(nextEstimate)
 await expect(database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,nextInv,actorA,{id:uid(),investigationId:nextInv,kind:'search',toolName:'search_similar_jobs',result:{jobIds:[jid]}}])).rejects.toThrow('not eligible')
})
it('invalidates a job vector when canonical source fields change and records retryable failures',async()=>{
 const vector=JSON.stringify([1,...Array(1535).fill(0)]),jid=await memoryJob();await indexMemory(orgA,actorA,'job',jid,'Initial canonical job content',vector)
 await database.db.query("update public.jobs set notes='Occupied access condition changed' where id=$1",[jid])
 expect((await database.db.query('select embedding,source_content_hash from public.job_search_documents where job_id=$1',[jid])).rows[0]).toEqual({embedding:null,source_content_hash:null})
 const content='Refreshed canonical job content',hash=createHash('sha256').update(content).digest('hex')
 await asTrusted(actorA,db=>db.query('select public.enqueue_memory_index_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[orgA,actorA,'job',jid,content,hash,'job-memory-v2','bedrock','amazon.titan-embed-text-v1',1536]))
 const claim=(await asTrusted(actorA,db=>db.query('select * from public.claim_memory_index_jobs($1,$2,$3,$4)',[orgA,actorA,uid(),20]))).rows.find(row=>row.source_id===jid)
 await asTrusted(actorA,db=>db.query("select public.fail_memory_index_job($1,$2,$3,$4,'Bedrock timeout')",[orgA,actorA,claim.id,claim.lease_token]))
 expect((await database.db.query('select status,attempt_count,last_error,next_attempt_at is not null retry from public.memory_index_jobs where id=$1',[claim.id])).rows[0]).toMatchObject({status:'failed',attempt_count:expect.any(Number),last_error:'Bedrock timeout',retry:true})
 await asTrusted(actorA,db=>db.query('select public.enqueue_memory_index_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[orgA,actorA,'job',jid,content,hash,'job-memory-v2','bedrock','amazon.titan-embed-text-v1',1536]))
 expect((await database.db.query('select status from public.memory_index_jobs where id=$1',[claim.id])).rows[0].status).toBe('failed')
})
it('reconciliation removes an ineligible legacy vector and disables its durable job',async()=>{
 const vector=JSON.stringify([1,...Array(1535).fill(0)]),jid=await memoryJob();await indexMemory(orgA,actorA,'job',jid,'Legacy current job memory',vector)
 // Simulate an already-stale pre-migration row; normal source changes invalidate immediately.
 await database.db.query('alter table public.jobs disable trigger invalidate_job_memory_on_source_change')
 try{await database.db.query("update public.jobs set data_origin='demo' where id=$1",[jid])}finally{await database.db.query('alter table public.jobs enable trigger invalidate_job_memory_on_source_change')}
 expect((await database.db.query('select embedding is not null present from public.job_search_documents where job_id=$1',[jid])).rows[0].present).toBe(true)
 await asTrusted(actorA,db=>db.query('select * from public.claim_memory_index_jobs($1,$2,$3,$4)',[orgA,actorA,uid(),20]))
 expect((await database.db.query('select id from public.job_search_documents where job_id=$1',[jid])).rowCount).toBe(0)
 expect((await database.db.query('select status from public.memory_index_jobs where job_id=$1',[jid])).rows[0].status).toBe('disabled')
})
it('blocks live duplicate runs and renews leases',async()=>{const id=await estimate();const inv=await begin(id);await expect(begin(id)).rejects.toThrow('investigation_already_running');await database.db.query('select public.renew_investigation_lease($1,$2,$3,$4)',[orgA,id,inv,actorA]);expect((await database.db.query('select lease_expires_at>now() active from public.investigations where id=$1',[inv])).rows[0].active).toBe(true)})
it('persists an explicit failed state when runtime completion fails and permits a fresh attempt',async()=>{const id=await estimate(),inv=await begin(id);await database.db.query('select public.fail_investigation($1,$2,$3,$4,$5)',[orgA,id,inv,'Agent stopped with limitTurns before producing validated structured output.',actorA]);expect((await database.db.query('select status,error from public.investigations where id=$1',[inv])).rows[0]).toMatchObject({status:'failed',error:expect.stringContaining('limitTurns')});expect((await database.db.query('select investigation_status from public.estimates where id=$1',[id])).rows[0].investigation_status).toBe('failed');expect(await begin(id)).toBeTruthy()})
it('atomically recovers stale leases; only one simultaneous takeover wins',async()=>{const id=await estimate();const stale=await begin(id);await database.db.query("update public.investigations set lease_expires_at=now()-interval '1 second' where id=$1",[stale]);const clients=[new pg.Client(database.config),new pg.Client(database.config)];await Promise.all(clients.map(c=>c.connect()));try{const results=await Promise.allSettled(clients.map(c=>c.query('select public.begin_investigation($1,$2,$3,$4)',[orgA,id,uid(),actorA])));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)}finally{await Promise.all(clients.map(c=>c.end()))}const records=await database.db.query('select status,error,attempt from public.investigations where estimate_id=$1 order by attempt',[id]);expect(records.rows).toEqual([{status:'failed',error:'lease_expired',attempt:1},{status:'investigating',error:null,attempt:2}]);await database.db.query('select public.fail_investigation($1,$2,$3,$4,$5)',[orgA,id,stale,'late old worker',actorA]);expect((await database.db.query('select investigation_status from public.estimates where id=$1',[id])).rows[0].investigation_status).toBe('investigating');await expect(database.db.query('select public.renew_investigation_lease($1,$2,$3,$4)',[orgA,id,stale,actorA])).rejects.toThrow('lease lost')})
it('rejects privileged calls from tenants and spoofed actor membership',async()=>{const id=await estimate();await asUser(actorA,async db=>{await expect(db.query('select public.begin_investigation($1,$2,$3,$4)',[orgA,id,uid(),actorA])).rejects.toThrow('permission denied')});await expect(database.db.query('select public.begin_investigation($1,$2,$3,$4)',[orgA,id,uid(),actorB])).rejects.toThrow('not a member')})
it('prevents authenticated clients from bypassing import review through legacy write RPCs',async()=>{
 await asUser(actorA,async db=>{
  await expect(db.query('select public.create_estimate_with_lines($1,$2)',[JSON.stringify({id:uid(),organization_id:orgA,name:'Bypass',project_type:'Office'}),JSON.stringify([{id:uid(),category:'labor',description:'Labor',estimated_cost:100}])])).rejects.toThrow('permission denied')
  await expect(db.query('select public.create_completed_job($1,$2,$3,$4,$5)',[JSON.stringify({id:uid(),organization_id:orgA,name:'Bypass',project_type:'Office',scope_review:noScopeChanges}),JSON.stringify([{id:uid(),category:'labor',description:'Labor',estimated_cost:100}]),JSON.stringify([{id:uid(),category:'labor',description:'Labor',actual_cost:100}]),'[]','[]'])).rejects.toThrow('permission denied')
  await expect(db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,uid(),'[]','[]','[]','','[]',JSON.stringify(noScopeChanges)])).rejects.toThrow('permission denied')
 })
})
it('rejects forged lifecycle inserts',async()=>{await asUser(actorA,async db=>{await expect(db.query("insert into public.estimates(organization_id,name,project_type,lifecycle_status) values($1,'Forged','Office','learned')",[orgA])).rejects.toThrow()})})
const valid:Record<string,string[]>={draft:['reviewed'],reviewed:['submitted'],submitted:['won','lost'],won:['in_progress'],lost:[],in_progress:['completed'],completed:[]}
for(const from of Object.keys(valid))for(const to of ['reviewed','submitted','won','lost','in_progress','completed','learned'])if(to!==from&&!valid[from].includes(to))it(`rejects lifecycle ${from} -> ${to}`,async()=>{const{id}=await atStage(from);await expect(transition(id,to)).rejects.toThrow()})
it('requires resolved findings and questions before Reviewed',async()=>{const{id,inv}=await prepared(true);await expect(transition(id,'reviewed')).rejects.toThrow('resolve');await database.db.query("insert into public.human_questions(organization_id,estimate_id,investigation_id,prompt,context,options) values($1,$2,$3,'Confirm?','Access',array['Yes','No'])",[orgA,id,inv]);await asUser(actorA,db=>db.query('select public.set_finding_status($1,(select id from public.findings where estimate_id=$2),$3)',[orgA,id,'resolved']));await expect(transition(id,'reviewed')).rejects.toThrow('resolve')})
it('persists an estimator question, records the later answer, and queues a resumable investigation',async()=>{const estimateId=await estimate(),investigationId=await begin(estimateId),questionId=uid();await database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,estimateId,investigationId,'Need site context','deterministic',{cycleCount:1,toolsUsed:['request_human_input']},'[]',JSON.stringify([{id:questionId,prompt:'Is this floor occupied?',context:'Access changes labor productivity.',options:['Yes','No']}]),actorA]);expect((await database.db.query('select investigation_status from public.estimates where id=$1',[estimateId])).rows[0].investigation_status).toBe('needs_input');await asUser(actorA,db=>db.query('select public.answer_estimator_question($1,$2,$3,$4)',[orgA,estimateId,questionId,'Yes']));expect((await database.db.query('select answer,resolved_at is not null resolved from public.human_questions where id=$1',[questionId])).rows[0]).toEqual({answer:'Yes',resolved:true});expect((await database.db.query('select investigation_status,assumptions[array_length(assumptions,1)] response from public.estimates where id=$1',[estimateId])).rows[0]).toMatchObject({investigation_status:'queued',response:expect.stringContaining('Yes')});expect(await begin(estimateId)).toBeTruthy()})
it('freezes snapshot, supporting evidence, source files and submitted line items',async()=>{const{id,findingId}=await atStage('submitted',true);const snapshot=await database.db.query('select evidence_snapshot from public.submission_findings where finding_id=$1',[findingId]);expect(snapshot.rows[0].evidence_snapshot.toolEvidence).toHaveLength(1);expect(snapshot.rows[0].evidence_snapshot.estimateLines).toHaveLength(1);await asUser(actorA,async db=>{for(const query of ['update public.submission_findings set title=\'changed\' where estimate_id=$1','delete from public.submission_findings where estimate_id=$1','update public.estimate_lines set estimated_cost=1 where estimate_id=$1','delete from public.estimate_lines where estimate_id=$1','update public.findings set claim=\'changed\' where estimate_id=$1'])await expect(db.query(query,[id])).rejects.toThrow();await expect(db.query("insert into public.estimate_lines(organization_id,estimate_id,category,description) values($1,$2,'labor','added')",[orgA,id])).rejects.toThrow()});await expect(database.db.query('delete from public.submission_findings where estimate_id=$1',[id])).rejects.toThrow('immutable')})
it('requires Completed for actuals and all reviews for Learned; closeout is idempotent',async()=>{const{id,findingId}=await atStage('won',true);const actuals=JSON.stringify([{category:'labor',description:'Labor',actual_cost:125,actual_hours:12}]);const outcomes=JSON.stringify([{finding_id:findingId,system_verdict:'validated',explanation:'Observed',confidence:0.8}]);const lessons=JSON.stringify([{title:'Access',category:'labor',lesson:'Confirm access',cause:'Restrictions',impact_summary:'Hours',confidence:0.8}]);const close=()=>asTrusted(actorA,async db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,id,actuals,lessons,outcomes,'Closeout',await archivedSource(id),JSON.stringify({status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'})]));await expect(close()).rejects.toThrow('completed');await transition(id,'in_progress');await transition(id,'completed');const first=await close();expect((await close()).rows[0].id).toBe(first.rows[0].id);const finish=()=>asUser(actorA,db=>db.query('select public.try_finalize_estimate_learning($1,$2) done',[orgA,id]));expect((await finish()).rows[0].done).toBe(false);await asUser(actorA,db=>db.query("select public.confirm_finding_outcome($1,(select id from public.finding_outcomes where estimate_id=$2),'validated')",[orgA,id]));expect((await finish()).rows[0].done).toBe(false);const lessonId=(await database.db.query('select id from public.lessons where job_id=$1',[first.rows[0].id])).rows[0].id;await asTrusted(actorA,db=>db.query("select public.set_lesson_status_server($1,$2,$3,'confirmed')",[orgA,actorA,lessonId]));expect((await finish()).rows[0].done).toBe(true)})
it('enforces tenant-private Storage paths',async()=>{await asUser(actorA,async db=>{await db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[`${orgA}/test.txt`]);await expect(db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[`${orgB}/test.txt`])).rejects.toThrow();expect((await db.query('select * from storage.objects where name like $1',[`${orgB}/%`])).rowCount).toBe(0)})})
it('rejects browser embedding-space mutation, model switches and incompatible dimensions',async()=>{await asTrusted(actorA,async db=>{await db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[orgA,actorA]);await expect(db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1024)",[orgA,actorA])).rejects.toThrow('unsupported');await expect(db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','cohere.embed-v4:0',1536)",[orgA,actorA])).rejects.toThrow('mismatch');await expect(db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[orgB,actorA])).rejects.toThrow('not a member')});await asUser(actorA,async db=>{await expect(db.query("select public.ensure_embedding_space($1,'bedrock','cohere.embed-v4:0',1536)",[orgA])).rejects.toThrow('permission denied');await db.query("select public.assert_embedding_space($1,'bedrock','amazon.titan-embed-text-v1',1536)",[orgA])})})

it('recomputes import totals and variances instead of trusting supplied summaries',async()=>{const jid=await job();const row=(await database.db.query('select actual_total from public.jobs where id=$1',[jid])).rows[0];expect(Number(row.actual_total)).toBe(125);const variance=(await database.db.query('select cost_delta from public.job_variances where job_id=$1',[jid])).rows[0];expect(Number(variance.cost_delta)).toBe(25);await asUser(actorA,async db=>{await expect(db.query("insert into public.job_actual_lines(organization_id,job_id,category,description,actual_cost) values($1,$2,'labor','late alteration',99)",[orgA,jid])).rejects.toThrow('permission denied')})})
it('claims a worker once per investigation attempt',async()=>{const id=await estimate();const inv=await begin(id);await database.db.query('select public.claim_investigation_execution($1,$2,$3,$4)',[orgA,id,inv,actorA]);await expect(database.db.query('select public.claim_investigation_execution($1,$2,$3,$4)',[orgA,id,inv,actorA])).rejects.toThrow('already_claimed')})
it('rejects cross-estimate and cross-tenant evidence relationships',async()=>{const first=await prepared();const second=await prepared();await expect(database.db.query("insert into public.human_questions(organization_id,estimate_id,investigation_id,prompt) values($1,$2,$3,'Wrong parent')",[orgA,first.id,second.inv])).rejects.toThrow('foreign key');const foreign=await job(orgB,actorB);await expect(database.db.query("insert into public.job_actual_lines(organization_id,job_id,category,description) values($1,$2,'labor','Wrong tenant')",[orgA,foreign])).rejects.toThrow('foreign key')})
it('requires retrieved jobs and current-investigation calculations in database persistence',async()=>{const id=await estimate();const inv=await begin(id);const jobId=await job();await expect(database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,{id:uid(),investigationId:inv,kind:'inspection',toolName:'inspect_job',result:{jobId}}])).rejects.toThrow('not retrieved');await expect(database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,id,inv,'Review','strands',{},JSON.stringify([{id:uid(),category:'labor',evidenceRefs:[uid()]}]),'[]',actorA])).rejects.toThrow('unknown or foreign')})

it('serializes warning changes behind finalization and freezes the learned verdict',async()=>{
 const {id,findingId}=await atStage('completed',true)
 await asTrusted(actorA,async db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7)',[orgA,id,JSON.stringify([{category:'labor',description:'Labor',actual_cost:125,actual_hours:12}]),'[]',JSON.stringify([{finding_id:findingId,system_verdict:'validated',explanation:'Observed',confidence:0.8}]),'',await archivedSource(id)]))
 const outcome=(await database.db.query('select id from public.finding_outcomes where estimate_id=$1',[id])).rows[0].id
 await asUser(actorA,db=>db.query("select public.confirm_finding_outcome($1,$2,'validated')",[orgA,outcome]))
 const finalizer=new pg.Client(database.config),confirmer=new pg.Client(database.config)
 await Promise.all([finalizer.connect(),confirmer.connect()])
 try{
  for(const db of [finalizer,confirmer]){await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA])}
  await finalizer.query('begin');await finalizer.query('select public.try_finalize_estimate_learning($1,$2)',[orgA,id])
  const confirmerPid=(await confirmer.query('select pg_backend_pid() pid')).rows[0].pid
  const pending=confirmer.query("select public.confirm_finding_outcome($1,$2,'not_observed')",[orgA,outcome]).then(()=>({accepted:true,error:''}),error=>({accepted:false,error:String(error)}))
  // Wait until the real backend is blocked on the parent row, not an arbitrary timer.
  let blocked=false
  for(let i=0;i<100;i++){const r=await database.db.query("select wait_event_type from pg_stat_activity where pid=$1",[confirmerPid]);if(r.rows[0]?.wait_event_type==='Lock'){blocked=true;break}await new Promise(resolve=>setTimeout(resolve,5))}
  await finalizer.query('commit')
  const result=await pending
  expect(blocked).toBe(true);expect(result.accepted).toBe(false);expect(result.error).toContain('learning review')
  expect((await database.db.query('select confirmed_verdict from public.finding_outcomes where id=$1',[outcome])).rows[0].confirmed_verdict).toBe('validated')
  await asUser(actorA,db=>db.query("select public.confirm_finding_outcome($1,$2,'validated')",[orgA,outcome]))
 }finally{await finalizer.query('rollback');await Promise.all([finalizer.end(),confirmer.end()])}
})

async function archivedSource(estimateId:string){const path=`${orgA}/${estimateId}/closeout/${uid()}.csv`;await database.db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[path]);return JSON.stringify([{kind:'actuals',file_name:'actuals.csv',storage_path:path,mime_type:'text/csv',size_bytes:20,extracted_text:''}])}

it('rolls back closeout unless original files exist and belong to this estimate',async()=>{
 const {id}=await atStage('completed')
 const close=(sources:unknown)=>asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7)',[orgA,id,JSON.stringify([{category:'labor',description:'Labor',actual_cost:125,actual_hours:12}]),'[]','[]','',JSON.stringify(sources)]))
 await expect(close([])).rejects.toThrow('archived actuals')
 await expect(close([{kind:'actuals',file_name:'missing.csv',size_bytes:20,storage_path:`${orgA}/${id}/closeout/missing.csv`}])).rejects.toThrow('archived upload')
 const foreignPath=`${orgB}/${id}/closeout/foreign.csv`;await database.db.query("insert into storage.objects(name,bucket_id) values($1,'job-files')",[foreignPath])
 await expect(close([{kind:'actuals',file_name:'foreign.csv',size_bytes:20,storage_path:foreignPath}])).rejects.toThrow('tenant-owned')
 expect((await database.db.query('select lifecycle_status from public.estimates where id=$1',[id])).rows[0].lifecycle_status).toBe('completed')
 expect((await database.db.query('select id from public.jobs where source_estimate_id=$1',[id])).rowCount).toBe(0)
 const sources=JSON.parse(await archivedSource(id));const result=await close(sources)
 const jid=result.rows[0].closeout_estimate_with_actuals
 expect((await database.db.query('select storage_path from public.documents where job_id=$1',[jid])).rows[0].storage_path).toBe(sources[0].storage_path)
 await asUser(actorA,db=>db.query('delete from storage.objects where name=$1',[sources[0].storage_path]))
 expect((await database.db.query('select id from storage.objects where name=$1',[sources[0].storage_path])).rowCount).toBe(1)
 // A retry's new payload cannot replace committed facts or files.
 await asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7)',[orgA,id,JSON.stringify([{category:'labor',actual_cost:99999}]),'[]','[]','changed','[]']))
 expect(Number((await database.db.query('select actual_total from public.jobs where id=$1',[jid])).rows[0].actual_total)).toBe(125)
 expect((await database.db.query('select id from public.documents where job_id=$1',[jid])).rowCount).toBe(1)
 await asUser(actorA,db=>expect(db.query('select public.closeout_estimate_internal($1,$2,$3,$4,$5,$6)',[orgA,id,'[]','[]','[]',''])).rejects.toThrow('permission denied'))
})
it('reports durable memory gaps until vectors exist and hides foreign readiness',async()=>{
 const jid=await job(),vec=JSON.stringify([1,...Array(1535).fill(0)])
 const lesson=uid();await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status) values($1,$2,$3,'Lesson','labor','Access','Constraint','Hours',0.8,'confirmed')",[lesson,orgA,jid])
 const ready=()=>asUser(actorA,db=>db.query('select * from public.get_memory_readiness($1,$2)',[orgA,jid]))
 expect((await ready()).rows[0]).toMatchObject({pending_jobs:'1',pending_lessons:'1'})
 await indexMemory(orgA,actorA,'job',jid,'Trusted completed job',vec)
 await indexMemory(orgA,actorA,'lesson',lesson,'Trusted confirmed lesson',vec)
 expect((await ready()).rows[0]).toMatchObject({pending_jobs:'0',pending_lessons:'0'})
 await asUser(actorB,async db=>expect((await db.query('select * from public.get_memory_readiness($1,$2)',[orgA,jid])).rowCount).toBe(0))
})
it('restores missing legacy actuals only when the original matches canonical costs',async()=>{
 const{id}=await atStage('completed');const actuals=JSON.stringify([{category:'labor',description:'Labor',actual_cost:125,actual_hours:12}])
 // Simulate a closeout committed by the old migration before archive attachment existed.
 await database.db.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA])
 const jid=(await database.db.query('select public.closeout_estimate_internal($1,$2,$3,$4,$5,$6) id',[orgA,id,actuals,'[]','[]',''])).rows[0].id
 await database.db.query("select set_config('request.jwt.claim.sub','',false)")
 const restore=(lines:string,sources:string)=>asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7)',[orgA,id,lines,'[]','[]','',sources]))
 await expect(restore(JSON.stringify([{category:'labor',description:'Labor',actual_cost:999,actual_hours:12}]),await archivedSource(id))).rejects.toThrow('must match')
 const sources=await archivedSource(id);await restore(actuals,sources)
 expect((await database.db.query('select id from public.documents where job_id=$1',[jid])).rowCount).toBe(1)
 expect(Number((await database.db.query('select actual_total from public.jobs where id=$1',[jid])).rows[0].actual_total)).toBe(125)
})
it('allows Titan G1 in an empty workspace but refuses a Cohere/Titan mix or null identity',async()=>{
 const org=uid();await database.db.query('insert into public.organizations(id,name,created_by) values($1,$2,$3)',[org,'Titan test',actorA]);await database.db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",[org,actorA])
 await asTrusted(actorA,async db=>{
  await db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[org,actorA])
  await db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1536)",[org,actorA])
  await expect(db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','cohere.embed-v4:0',1536)",[org,actorA])).rejects.toThrow('model mismatch')
  await expect(db.query("select public.ensure_embedding_space_server($1,$2,'bedrock','amazon.titan-embed-text-v1',1024)",[org,actorA])).rejects.toThrow('unsupported')
  await expect(db.query('select public.ensure_embedding_space_server($1,$2,null,null,null)',[org,actorA])).rejects.toThrow('unsupported')
 })
 await asUser(actorA,db=>db.query("select public.assert_embedding_space($1,'bedrock','amazon.titan-embed-text-v1',1536)",[org]))
 expect((await database.db.query('select model,dimensions from public.embedding_spaces where organization_id=$1',[org])).rows[0]).toEqual({model:'amazon.titan-embed-text-v1',dimensions:1536})
})

const noScopeChanges={status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'}
const scopeChange={reference:'CO-1 approved by customer',description:'Additional circuits',category:'labor',estimatedCost:50,estimatedHours:5,actualCost:50,actualHours:5}
const adjustedScope={status:'adjusted',changes:[scopeChange],actualCompleteness:'confirmed_complete'}
async function importScopedJob(review:unknown,org=orgA,actor=actorA,cost=150,hours=15){
 const id=uid()
 await asTrusted(actor,db=>db.query('select public.create_completed_job($1,$2,$3,$4,$5)',[
  {id,organization_id:org,name:'Scoped history',project_type:'Office',completed_at:'2026-01-01',scope_review:review},
  [{id:uid(),category:'labor',description:'Original circuits',estimated_cost:100,estimated_hours:10}],
  [{id:uid(),category:'labor',description:'All circuits',actual_cost:cost,actual_hours:hours}],
  [{category:'labor',cost_delta:99999}],[]].map(x=>JSON.stringify(x))))
 return id
}
it('requires durable final-actual completeness before a job can become comparison evidence',async()=>{
 await expect(importScopedJob({status:'no_changes',changes:[]})).rejects.toThrow('completeness confirmation')
 const unknown=await importScopedJob({status:'unreconciled',changes:[]})
 expect((await database.db.query('select public.is_job_scope_reconciled($1,$2) usable',[orgA,unknown])).rows[0].usable).toBe(false)
 expect((await database.db.query('select review from public.job_scope_reviews where job_id=$1',[unknown])).rows[0].review.actualCompleteness).toBe('unknown')
 const importMissing=async(review:unknown)=>{const importedId=uid();await asTrusted(actorA,db=>db.query('select public.create_completed_job($1,$2,$3,$4,$5)',[
  {id:importedId,organization_id:orgA,name:'Coverage check',project_type:'Office',completed_at:'2026-01-01',scope_review:review},
  [{id:uid(),category:'labor',description:'Labor',estimated_cost:500,estimated_hours:10},{id:uid(),category:'materials',description:'Wire',estimated_cost:500}],
  [{id:uid(),category:'labor',description:'Labor',actual_cost:500,actual_hours:10}],[],[]].map(value=>JSON.stringify(value))));return importedId}
 await expect(importMissing(noScopeChanges)).rejects.toThrow('missing expected categories')
 await expect(importMissing({status:'unreconciled',changes:[],actualCompleteness:'unknown'})).resolves.toBeDefined()
 const falselyClaimedComplete=await importMissing({status:'unreconciled',changes:[],actualCompleteness:'confirmed_complete'})
 expect((await database.db.query('select review from public.job_scope_reviews where job_id=$1',[falselyClaimedComplete])).rows[0].review.actualCompleteness).toBe('unknown')
})
it('rejects forged authoritative history with net-zero or structured actual coverage gaps',async()=>{
 const create=async(estimateLines:unknown[],actualLines:unknown[],scopeReview:unknown=noScopeChanges)=>{const jobId=uid();await asTrusted(actorA,db=>db.query('select public.create_completed_job($1,$2,$3,$4,$5)',[
  {id:jobId,organization_id:orgA,name:'Coverage boundary',project_type:'Office',completed_at:'2026-01-01',scope_review:scopeReview},estimateLines,actualLines,[],[],
 ].map(value=>JSON.stringify(value))));return jobId}
 await expect(create([
  {id:uid(),category:'materials',description:'Package',estimated_cost:500,estimated_hours:0},
  {id:uid(),category:'materials',description:'Credit',estimated_cost:-500,estimated_hours:0},
 ],[{id:uid(),category:'labor',description:'Labor',actual_cost:100,actual_hours:1}])).rejects.toThrow('missing expected categories')
 const structuredEstimate=[
  {id:uid(),category:'other',description:'Rough',estimated_cost:500,cost_code:'260100',phase:'ROUGH'},
  {id:uid(),category:'other',description:'Trim',estimated_cost:500,cost_code:'260200',phase:'TRIM'},
 ]; const structuredActual=[{id:uid(),category:'other',description:'Rough',actual_cost:550,cost_code:'260100',phase:'ROUGH'}]
 await expect(create(structuredEstimate,structuredActual)).rejects.toThrow('structured coverage')
 const archived=await create(structuredEstimate,structuredActual,{status:'unreconciled',changes:[],actualCompleteness:'confirmed_complete'})
 expect((await database.db.query('select review from public.job_scope_reviews where job_id=$1',[archived])).rows[0].review.actualCompleteness).toBe('unknown')
 expect((await database.db.query('select public.is_job_scope_reconciled($1,$2) usable',[orgA,archived])).rows[0].usable).toBe(false)
})
it('returns an actionable preview error for unsupported XLSX workbook XML without staging an import',async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Estimate');sheet.addRow(['Description','Cost']);sheet.addRow(['Wire',100])
 const archive=await JSZip.loadAsync(await book.xlsx.writeBuffer());archive.file('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><unsupported-workbook/>')
 const bytes=await archive.generateAsync({type:'uint8array'});const reviewsBefore=importRouteHooks.reviews.size
 const form=new FormData();form.set('mode','pair');form.set('estimateBaselineConfirmed','true');form.set('estimateFile',new File([new Uint8Array(bytes)],'unsupported-export.xlsx'));form.set('actualFile',new File(['Description,Cost\nWire,100'],'actual.csv'))
 const response=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:form}));const body=await response.json()
 expect(response.status).toBe(400);expect(body.error).toContain('could not be read safely as a standard XLSX file');expect(body.error).not.toContain("reading 'sheets'");expect(importRouteHooks.reviews.size).toBe(reviewsBefore)
})
it('commits a reviewed contractor component-cost workbook through the real preview route with category provenance',async()=>{
 const estimateBook=new ExcelJS.Workbook();const estimateSheet=estimateBook.addWorksheet('Final Estimate');for(let row=1;row<=15;row+=1)estimateSheet.addRow([`Project metadata ${row}`,`Value ${row}`]);estimateSheet.addRow([]);estimateSheet.addRow(['Phase','Cost Code','Description','Qty','Unit','Mat Unit $','Material Ext $','Labor Unit Hrs','Labor Hours','Labor Rate','Labor Ext $','Equipment $','Subcontract $','Direct Cost']);estimateSheet.addRow(['Raceway','26-0533','EMT raceway',100,'LF',2,200,.1,10,60,600,50,25,875]);estimateSheet.addRow(['DIRECT COST TOTAL','DIRECT COST TOTAL','DIRECT COST TOTAL',null,null,null,200,null,10,null,600,50,25,875])
 const actualBook=new ExcelJS.Workbook();const actualSheet=actualBook.addWorksheet('Job Cost Summary');for(let row=1;row<=10;row+=1)actualSheet.addRow([`Project metadata ${row}`,`Value ${row}`]);actualSheet.addRow(['Phase','Cost Code','Description','Qty Actual','Unit','Labor Hours','Labor Cost','Material Cost','Equipment','Subcontract','Other','Total Actual']);actualSheet.addRow(['Raceway','26-0533','EMT raceway',105,'LF',12,720,210,55,30,0,1015]);actualSheet.addRow(['ACTUAL TOTALS','ACTUAL TOTALS','ACTUAL TOTALS',null,null,12,720,210,55,30,0,1015])
 const estimateBytes=new Uint8Array(await estimateBook.xlsx.writeBuffer()),actualBytes=new Uint8Array(await actualBook.xlsx.writeBuffer());const files=()=>({estimate:new File([estimateBytes],'contractor-estimate.xlsx'),actual:new File([actualBytes],'contractor-actuals.xlsx')})
 const previewFiles=files();const previewForm=new FormData();previewForm.set('mode','pair');previewForm.set('estimateBaselineConfirmed','true');previewForm.set('estimateBaselineRole','final_submitted');previewForm.set('estimateFile',previewFiles.estimate);previewForm.set('actualFile',previewFiles.actual)
 const previewResponse=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:previewForm}));const preview=await previewResponse.json();expect(previewResponse.status).toBe(200);expect(preview.canImport).toBe(true);expect(preview.reports).toEqual(expect.arrayContaining([expect.objectContaining({kind:'estimate',headerRow:17,normalizedDetailTotal:875,sourceReportedTotal:875,categoryCounts:expect.objectContaining({labor:1,materials:1,equipment:1,subcontractor:1})}),expect.objectContaining({kind:'actual',headerRow:11,normalizedDetailTotal:1015,sourceReportedTotal:1015,categoryCounts:expect.objectContaining({labor:1,materials:1,equipment:1,subcontractor:1})})]))
 const commitFiles=files();const commit=new FormData();commit.set('estimateFile',commitFiles.estimate);commit.set('actualFile',commitFiles.actual);setHistoricalMetadata(commit,'Contractor component import');commit.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));commit.set('importReviewId',preview.review.id);commit.set('importReportHash',preview.review.reportHash);commit.set('actualCompletenessConfirmed','true')
 const response=await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:commit}));const result=await response.json();expect(response.status).toBe(200)
 expect((await database.db.query('select category,estimated_cost,estimated_hours from public.job_estimate_lines where job_id=$1 order by category',[result.job.id])).rows.map(row=>({category:row.category,cost:Number(row.estimated_cost),hours:row.estimated_hours===null?null:Number(row.estimated_hours)}))).toEqual([{category:'equipment',cost:50,hours:null},{category:'labor',cost:600,hours:10},{category:'materials',cost:200,hours:null},{category:'subcontractor',cost:25,hours:null}])
 expect((await database.db.query('select count(*)::int n from public.import_line_provenance where organization_id=$1 and (job_estimate_line_id in(select id from public.job_estimate_lines where job_id=$2) or job_actual_line_id in(select id from public.job_actual_lines where job_id=$2))',[orgA,result.job.id])).rows[0].n).toBe(8)
})
it('uses the reviewed API preview interpretation for committed database values',async()=>{
 const estimateCsv='Description,Category,Cost Code,Phase,Quantity,UOM,Unit Cost,Estimated Cost,Hours\nCrew labor,Labor,260100,ROUGH,10,HR,125,"$1,250.00",10\nWire,Materials,260200,TRIM,100,LF,7.5,750,0\nGrand Total,,,,,,,2000,\n'
 const actualCsv='Description,Category,Cost Code,Phase,Quantity,UOM,Unit Cost,Actual Cost,Hours\nCrew labor,Labor,260100,ROUGH,10,HR,130,1300,11\nWire,Materials,260200,TRIM,100,LF,7,700,0\nGrand Total,,,,,,,2000,\n'
 const form=()=>{
  const data=new FormData()
  data.set('estimateFile',new File([estimateCsv],'reviewed-estimate.csv',{type:'text/csv'}))
  data.set('actualFile',new File([actualCsv],'reviewed-actual.csv',{type:'text/csv'}))
  return data
 }
 const previewForm=form();previewForm.set('mode','pair');previewForm.set('estimateBaselineConfirmed','true')
 const previewResponse=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:previewForm}))
 expect(previewResponse.status).toBe(200)
 const preview=await previewResponse.json()
 expect(preview.reports).toEqual(expect.arrayContaining([
  expect.objectContaining({kind:'estimate',mappedColumns:expect.objectContaining({cost:'estimated cost',costCode:'cost code',phase:'phase'}),structuredDimensions:{costCodes:['260100','260200'],phases:['ROUGH','TRIM'],divisions:[]},sourceReportedTotal:2000,normalizedDetailTotal:2000,totalReconciliation:expect.objectContaining({state:'matched'})}),
  expect.objectContaining({kind:'actual',mappedColumns:expect.objectContaining({cost:'actual cost',costCode:'cost code',phase:'phase'}),structuredDimensions:{costCodes:['260100','260200'],phases:['ROUGH','TRIM'],divisions:[]},sourceReportedTotal:2000,normalizedDetailTotal:2000,totalReconciliation:expect.objectContaining({state:'matched'})}),
 ]))
 expect(preview.completeness).toEqual(expect.objectContaining({state:'complete',missingActualCategories:[]}))
 const missingMetadata=form();missingMetadata.set('name','Incomplete metadata');missingMetadata.set('completedAt','2026-08-01');missingMetadata.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));missingMetadata.set('importReviewId',preview.review.id);missingMetadata.set('importReportHash',preview.review.reportHash);missingMetadata.set('actualCompletenessConfirmed','true')
 const missingMetadataResponse=await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:missingMetadata}));expect(missingMetadataResponse.status).toBe(400);expect(await missingMetadataResponse.json()).toMatchObject({error:expect.stringContaining('Project type is required')})
 const switched=form();switched.set('actualFile',new File([actualCsv.replace('1300','9300')],'reviewed-actual.csv',{type:'text/csv'}));setHistoricalMetadata(switched,'Substitution');switched.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));switched.set('importReviewId',preview.review.id);switched.set('importReportHash',preview.review.reportHash);switched.set('importReviewed','true');switched.set('actualCompletenessConfirmed','true')
 expect((await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:switched}))).status).toBe(409)
 const tampered=form();setHistoricalMetadata(tampered,'Tampered');tampered.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));tampered.set('importReviewId',preview.review.id);tampered.set('importReportHash','0'.repeat(64));tampered.set('importReviewed','true');tampered.set('actualCompletenessConfirmed','true')
 expect((await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:tampered}))).status).toBe(409)
 const commitForm=form()
 setHistoricalMetadata(commitForm,'API import parity')
 commitForm.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}))
 commitForm.set('importReviewId',preview.review.id)
 commitForm.set('importReportHash',preview.review.reportHash)
 commitForm.set('importReviewed','true')
 commitForm.set('actualCompletenessConfirmed','true')
 const commitResponse=await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:commitForm}))
 expect(commitResponse.status).toBe(200)
 const committed=await commitResponse.json()
 const jobRow=(await database.db.query('select estimated_total,actual_total from public.jobs where id=$1',[committed.job.id])).rows[0]
 expect({estimated:Number(jobRow.estimated_total),actual:Number(jobRow.actual_total)}).toEqual({estimated:2000,actual:2000})
 const estimateRows=(await database.db.query('select description,estimated_cost,estimated_hours from public.job_estimate_lines where job_id=$1 order by description',[committed.job.id])).rows
 expect(estimateRows.map(row=>({description:row.description,cost:Number(row.estimated_cost),hours:Number(row.estimated_hours)}))).toEqual([{description:'Crew labor',cost:1250,hours:10},{description:'Wire',cost:750,hours:0}])
 const actualRows=(await database.db.query('select description,actual_cost,actual_hours from public.job_actual_lines where job_id=$1 order by description',[committed.job.id])).rows
 expect(actualRows.map(row=>({description:row.description,cost:Number(row.actual_cost),hours:Number(row.actual_hours)}))).toEqual([{description:'Crew labor',cost:1300,hours:11},{description:'Wire',cost:700,hours:0}])
 const dimensions=(await database.db.query('select cost_code,phase from public.job_estimate_lines where job_id=$1 order by description',[committed.job.id])).rows
 expect(dimensions).toEqual([{cost_code:'260100',phase:'ROUGH'},{cost_code:'260200',phase:'TRIM'}])
 const actualDimensions=(await database.db.query('select cost_code,phase from public.job_actual_lines where job_id=$1 order by description',[committed.job.id])).rows
 expect(actualDimensions).toEqual([{cost_code:'260100',phase:'ROUGH'},{cost_code:'260200',phase:'TRIM'}])
 const actualUnits=(await database.db.query('select description,quantity,unit,normalized_unit,unit_cost from public.job_actual_lines where job_id=$1 order by description',[committed.job.id])).rows
 expect(actualUnits.map(row=>({description:row.description,quantity:Number(row.quantity),unit:row.unit,normalizedUnit:row.normalized_unit,unitCost:Number(row.unit_cost)}))).toEqual([{description:'Crew labor',quantity:10,unit:'HR',normalizedUnit:'HR',unitCost:130},{description:'Wire',quantity:100,unit:'LF',normalizedUnit:'LF',unitCost:7}])
 const sourceTrace=(await database.db.query('select p.source_row,p.worksheet,f.file_name,p.original_values from public.import_line_provenance p join public.import_review_files f on f.id=p.import_review_file_id where p.job_actual_line_id is not null and p.organization_id=$1 and f.file_name=$2 order by p.source_row',[orgA,'reviewed-actual.csv'])).rows
 expect(sourceTrace).toEqual([{source_row:2,worksheet:'CSV',file_name:'reviewed-actual.csv',original_values:expect.objectContaining({cost:'1300',quantity:'10',unit:'HR'})},{source_row:3,worksheet:'CSV',file_name:'reviewed-actual.csv',original_values:expect.objectContaining({cost:'700',quantity:'100',unit:'LF'})}])
 const replay=form();setHistoricalMetadata(replay,'Changed on retry');replay.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));replay.set('importReviewId',preview.review.id);replay.set('importReportHash',preview.review.reportHash);replay.set('importReviewed','true');replay.set('actualCompletenessConfirmed','true')
 const replayResponse=await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:replay}));expect(replayResponse.status).toBe(200);expect((await replayResponse.json()).job.id).toBe(committed.job.id)
 expect(Number((await database.db.query("select count(*) n from public.jobs where name='API import parity'")).rows[0].n)).toBe(1)
 })
it('resolves an ambiguous workbook through preview and persists the exact selected worksheet',async()=>{
 const book=new ExcelJS.Workbook();for(const[name,cost]of[['Summary',900],['Bid Detail',100]]as const){const sheet=book.addWorksheet(name);sheet.addRow(['Description','Category','Cost','Hours']);sheet.addRow(['Wire','Materials',cost,0])}const bytes=new Uint8Array(await book.xlsx.writeBuffer());const estimateFile=()=>new File([bytes],'multi-sheet.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const actualFile=()=>new File(['Description,Category,Cost,Hours\nWire,Materials,100,0'],'actual.csv',{type:'text/csv'})
 const first=new FormData();first.set('mode','pair');first.set('estimateBaselineConfirmed','true');first.set('estimateFile',estimateFile());first.set('actualFile',actualFile());const ambiguous=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:first}));expect(ambiguous.status).toBe(200);const blocked=await ambiguous.json();expect(blocked.canImport).toBe(false);expect(blocked.review).toBeUndefined()
 const selected=new FormData();selected.set('mode','pair');selected.set('estimateBaselineConfirmed','true');selected.set('estimateWorksheet','Bid Detail');selected.set('estimateFile',estimateFile());selected.set('actualFile',actualFile());const response=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:selected}));const preview=await response.json();expect(response.status).toBe(200);expect(preview.reports[0]).toMatchObject({sheetName:'Bid Detail',normalizedDetailTotal:100});expect(preview.review.id).toBeTruthy()
 const commit=new FormData();commit.set('estimateFile',estimateFile());commit.set('actualFile',actualFile());setHistoricalMetadata(commit,'Selected worksheet job','2026-08-02');commit.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));commit.set('importReviewId',preview.review.id);commit.set('importReportHash',preview.review.reportHash);commit.set('importReviewed','true');commit.set('actualCompletenessConfirmed','true');const committed=await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:commit}));expect(committed.status).toBe(200);const body=await committed.json();expect(Number((await database.db.query('select estimated_total from public.jobs where id=$1',[body.job.id])).rows[0].estimated_total)).toBe(100);expect((await database.db.query('select distinct worksheet from public.import_line_provenance where job_estimate_line_id in(select id from public.job_estimate_lines where job_id=$1)',[body.job.id])).rows).toEqual([{worksheet:'Bid Detail'}])
})
it('binds an explicit ambiguous column choice through preview, commit, provenance, and retry',async()=>{
 const estimate=()=>new File(['Description,Category,Amount,Cost,Hours\nWire,Materials,999,100,0'],'mapping-estimate.csv',{type:'text/csv'})
 const actual=()=>new File(['Description,Category,Actual Cost,Hours\nWire,Materials,100,0'],'mapping-actual.csv',{type:'text/csv'})
 const unconfirmed=new FormData();unconfirmed.set('mode','pair');unconfirmed.set('estimateFile',estimate());unconfirmed.set('actualFile',actual());const unconfirmedResponse=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:unconfirmed}));expect(unconfirmedResponse.status).toBe(400);expect(await unconfirmedResponse.json()).toMatchObject({error:expect.stringContaining('Confirm what the estimate file represents')})
 const first=new FormData();first.set('mode','pair');first.set('estimateBaselineConfirmed','true');first.set('estimateFile',estimate());first.set('actualFile',actual())
 const blocked=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:first}));expect(blocked.status).toBe(200);expect((await blocked.json()).review).toBeUndefined()
 const selected=new FormData();selected.set('mode','pair');selected.set('estimateBaselineConfirmed','true');selected.set('estimateFile',estimate());selected.set('actualFile',actual());selected.set('estimateMapping',JSON.stringify({cost:4}));selected.set('estimateBaselineRole','final_submitted')
 const previewResponse=await previewImport(new Request('http://localhost/api/import/preview',{method:'POST',body:selected}));expect(previewResponse.status).toBe(200);const preview=await previewResponse.json()
 expect(preview.reports[0]).toMatchObject({mappedColumns:{description:'description',category:'category',cost:'cost',hours:'hours'},mappedColumnIndexes:{description:1,category:2,cost:4,hours:5},normalizedDetailTotal:100})
 const commit=new FormData();commit.set('estimateFile',estimate());commit.set('actualFile',actual());commit.set('estimateMapping',JSON.stringify({cost:3}));setHistoricalMetadata(commit,'Mapping-bound job');commit.set('scopeReview',JSON.stringify({status:'no_changes',changes:[]}));commit.set('importReviewId',preview.review.id);commit.set('importReportHash',preview.review.reportHash);commit.set('actualCompletenessConfirmed','true')
 const response=await commitHistoricalImport(new Request('http://localhost/api/jobs/import',{method:'POST',body:commit}));expect(response.status).toBe(200);const body=await response.json()
 expect(body.historicalEvidence).toMatchObject({eligible:true,actualCostsReconciled:true})
 expect(Number((await database.db.query('select estimated_total from public.jobs where id=$1',[body.job.id])).rows[0].estimated_total)).toBe(100)
 const trace=(await database.db.query('select resolved_mapping,original_values from public.import_line_provenance where job_estimate_line_id in(select id from public.job_estimate_lines where job_id=$1)',[body.job.id])).rows[0]
 expect(trace).toMatchObject({resolved_mapping:expect.objectContaining({cost:'cost'}),original_values:expect.objectContaining({cost:'100'})})
})
it('executes real Excel snapshot bytes through preview and commit routes into PostgreSQL exactly once',async()=>{
 const cell=(value:string|number)=>({value,text:String(value),formula:null})
 const snapshot={sourceType:'excel_live_snapshot',adapterVersion:'office-js-excel-live-v1',workbook:{name:'route-bid.xlsx',documentUrlHash:'a'.repeat(64)},worksheet:{id:'sheet-route',name:'Bid Detail',visibility:'visible'},selection:{kind:'table',address:'Bid Detail!A1:D4',tableId:'estimate-table',tableName:'EstimateTable'},rowCount:4,columnCount:4,cells:[['Description','Category','Cost','Hours'].map(cell),['Crew labor','Labor',1250,10].map(cell),['Wire','Materials',750,0].map(cell),['Grand Total','',2000,''].map(cell)],capturedAt:'2026-09-12T09:00:00.000Z'}
 const profile={name:'Route Excel bid',projectType:'Tenant fit-out',customerType:'Commercial',location:'Philadelphia',bidDue:null,tags:['occupied'],assumptions:[]}
 const previewResponse=await previewExcelImport(new Request('http://localhost/api/integrations/excel/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot,profile})}))
 expect(previewResponse.status).toBe(200);const preview=await previewResponse.json();expect(preview).toMatchObject({canImport:true,report:{sheetName:'Bid Detail',normalizedDetailTotal:2000,sourceReportedTotal:2000,totalReconciliation:{state:'matched'}},source:{sourceType:'excel_live_snapshot'}})
 const requestBody={snapshot,reviewId:preview.review.id,reportHash:preview.review.reportHash,runId:preview.runId,reviewed:false}
 const commitResponse=await checkExcelImport(new Request('http://localhost/api/integrations/excel/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requestBody)}));expect(commitResponse.status).toBe(200)
 const committed=await commitResponse.json();expect(committed.estimate.result).toBe('no_findings')
 const estimateId=committed.estimate.estimateId
 const estimateRow=(await database.db.query('select name,estimated_total,revision_number from public.estimates where id=$1',[estimateId])).rows[0];expect({name:estimateRow.name,total:Number(estimateRow.estimated_total),revision:estimateRow.revision_number}).toEqual({name:'Route Excel bid',total:2000,revision:0})
 expect((await database.db.query('select description,estimated_cost from public.estimate_lines where estimate_id=$1 order by description',[estimateId])).rows.map(row=>({description:row.description,cost:Number(row.estimated_cost)}))).toEqual([{description:'Crew labor',cost:1250},{description:'Wire',cost:750}])
 expect((await database.db.query('select worksheet,source_row from public.import_line_provenance where estimate_line_id in(select id from public.estimate_lines where estimate_id=$1) order by source_row',[estimateId])).rows).toEqual([{worksheet:'Bid Detail',source_row:2},{worksheet:'Bid Detail',source_row:3}])
 const retry=await checkExcelImport(new Request('http://localhost/api/integrations/excel/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requestBody)}));expect(retry.status).toBe(200);expect((await retry.json()).estimate.estimateId).toBe(estimateId)
 expect(Number((await database.db.query("select count(*) n from public.estimates where name='Route Excel bid'")).rows[0].n)).toBe(1)
 const changed=structuredClone(snapshot);changed.cells[1][2]={value:900,text:'900',formula:null}
 const stale=await checkExcelImport(new Request('http://localhost/api/integrations/excel/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...requestBody,snapshot:changed})}));expect(stale.status).toBe(409)
 const tampered=await checkExcelImport(new Request('http://localhost/api/integrations/excel/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...requestBody,reportHash:'0'.repeat(64)})}));expect(tampered.status).toBe(409)
})
it('commits a staged estimate exactly once and retains immutable row-level source provenance',async()=>{
 const review=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'}});const estimateId=uid(),lineId=uid();const estimate={id:estimateId,name:'Bound estimate',project_type:'Office',customer_type:'Commercial',location:'',tags:[],assumptions:[],baseline_role:'original_bid'};const lines=[{id:lineId,category:'materials',description:'Feeder',quantity:100,unit:'lf',normalized_unit:'LF',unit_cost:2,estimated_cost:200}];const provenance=[{lineId,fileRole:'estimate',worksheet:'CSV',sourceRow:184,mapping:{description:'description',cost:'cost'},originalValues:{description:'Feeder',cost:'200'},normalizationDecisions:['unit_normalized_to_LF'],parserVersion:'2026-09-p1-v1'}]
 const commit=(payload=estimate)=>database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,actorA,review.reviewId,review.hash,[],JSON.stringify(payload),JSON.stringify(lines),JSON.stringify(provenance)])
 const first=(await commit()).rows[0].id;expect(first).toBe(estimateId)
 const replay=(await commit({...estimate,id:uid(),name:'Forged retry'})).rows[0].id;expect(replay).toBe(estimateId)
 expect(Number((await database.db.query("select count(*) n from public.estimates where name in('Bound estimate','Forged retry')")).rows[0].n)).toBe(1)
 expect((await database.db.query('select file_name from public.documents where estimate_id=$1',[estimateId])).rows).toEqual([{file_name:'estimate.csv'}])
 expect((await database.db.query('select source_row,worksheet,original_values,normalization_decisions from public.import_line_provenance where estimate_line_id=$1',[lineId])).rows[0]).toEqual({source_row:184,worksheet:'CSV',original_values:{description:'Feeder',cost:'200'},normalization_decisions:['unit_normalized_to_LF']})
 await expect(database.db.query("update public.estimates set revision_number=9 where id=$1",[estimateId])).rejects.toThrow('immutable')
})
it('binds Excel snapshots idempotently to one immutable revision chain with source provenance',async()=>{
 const sourceIdentity='1'.repeat(64),profileHash='2'.repeat(64),firstSnapshot='3'.repeat(64),nextSnapshot='4'.repeat(64)
 const commit=async(review:{reviewId:string;hash:string},estimateId:string,cost:number,parentEstimateId?:string)=>{
  const lineId=uid(),payload={id:estimateId,name:'Excel bid',project_type:'Tenant fit-out',customer_type:'Commercial',location:'',tags:[],assumptions:[],parent_estimate_id:parentEstimateId??null,baseline_role:parentEstimateId?'revision':'original_bid'}
  const lines=[{id:lineId,category:'materials',description:'Branch wiring',quantity:10,unit:'EA',normalized_unit:'EA',unit_cost:cost/10,estimated_cost:cost}]
  const provenance=[{lineId,fileRole:'estimate',worksheet:'Bid Detail',sourceRow:184,mapping:{description:'description',cost:'cost'},originalValues:{description:'Branch wiring',cost:String(cost)},normalizationDecisions:['excel_live_snapshot'],parserVersion:'2026-09-p1-v1'}]
  const result=await database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,actorA,review.reviewId,review.hash,[],JSON.stringify(payload),JSON.stringify(lines),JSON.stringify(provenance)])
  return{estimateId:result.rows[0].id,lineId}
 }
 const firstReview=await stagedExcelReview({snapshotHash:firstSnapshot,sourceIdentityHash:sourceIdentity,profileHash})
 const firstId=uid(),first=await commit(firstReview,firstId,100);expect(first.estimateId).toBe(firstId)
 expect((await commit(firstReview,uid(),999)).estimateId).toBe(firstId)

 const sameReview=await stagedExcelReview({snapshotHash:firstSnapshot,sourceIdentityHash:sourceIdentity,profileHash,parentEstimateId:firstId})
 expect((await commit(sameReview,uid(),999,firstId)).estimateId).toBe(firstId)
 expect(Number((await database.db.query('select count(*) n from public.estimates where revision_group_id=$1',[firstId])).rows[0].n)).toBe(1)

 const changedReview=await stagedExcelReview({snapshotHash:nextSnapshot,sourceIdentityHash:sourceIdentity,profileHash,parentEstimateId:firstId})
 const revisionId=uid(),revision=await commit(changedReview,revisionId,125,firstId);expect(revision.estimateId).toBe(revisionId)
 expect((await database.db.query('select id,parent_estimate_id,revision_number,baseline_role from public.estimates where revision_group_id=$1 order by revision_number',[firstId])).rows).toEqual([{id:firstId,parent_estimate_id:null,revision_number:0,baseline_role:'original_bid'},{id:revisionId,parent_estimate_id:firstId,revision_number:1,baseline_role:'revision'}])
 expect(Number((await database.db.query('select estimated_cost from public.estimate_lines where id=$1',[first.lineId])).rows[0].estimated_cost)).toBe(100)
 const source=(await database.db.query('select p.source_row,p.worksheet,f.source_type,f.canonical_snapshot_hash,d.source_type document_source,d.canonical_snapshot_hash document_hash from public.import_line_provenance p join public.import_review_files f on f.id=p.import_review_file_id join public.estimate_lines l on l.id=p.estimate_line_id join public.documents d on d.estimate_id=l.estimate_id where p.estimate_line_id=$1',[revision.lineId])).rows[0]
 expect(source).toEqual({source_row:184,worksheet:'Bid Detail',source_type:'excel_live_snapshot',canonical_snapshot_hash:nextSnapshot,document_source:'excel_live_snapshot',document_hash:nextSnapshot})
})
it('rejects stale Excel baselines and keeps source bindings and integration runs server-only and tenant-scoped',async()=>{
 const sourceIdentity='5'.repeat(64),profileHash='6'.repeat(64),firstSnapshot='7'.repeat(64),nextSnapshot='8'.repeat(64)
 const review=await stagedExcelReview({snapshotHash:firstSnapshot,sourceIdentityHash:sourceIdentity,profileHash});const estimateId=uid(),lineId=uid()
 const commit=(candidate:typeof review,id=estimateId,parent:string|null=null,snapshotCost=100)=>database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,actorA,candidate.reviewId,candidate.hash,[],JSON.stringify({id,name:'Excel security',project_type:'Office',parent_estimate_id:parent,baseline_role:parent?'revision':'original_bid'}),JSON.stringify([{id:lineId,category:'labor',description:'Labor',estimated_cost:snapshotCost}]),JSON.stringify([{lineId,fileRole:'estimate',worksheet:'Bid Detail',sourceRow:2,mapping:{cost:'cost'},originalValues:{cost:String(snapshotCost)},normalizationDecisions:[],parserVersion:'2026-09-p1-v1'}])])
 await commit(review)
 const stale=await stagedExcelReview({snapshotHash:nextSnapshot,sourceIdentityHash:sourceIdentity,profileHash})
 await expect(commit(stale,uid(),null,120)).rejects.toThrow('stale estimate baseline')
 const foreign=await stagedExcelReview({snapshotHash:firstSnapshot,sourceIdentityHash:sourceIdentity,profileHash,org:orgB,actor:actorB})
 expect((await database.db.query('select count(*)::int n from public.estimate_source_bindings where source_identity_hash=$1',[sourceIdentity])).rows[0].n).toBe(1)
 await asUser(actorA,async db=>{
  await expect(db.query('select * from public.estimate_source_bindings where organization_id=$1',[orgA])).rejects.toThrow('permission denied')
  await expect(db.query("insert into public.excel_integration_runs(organization_id,user_id,source_identity_hash,snapshot_hash,adapter_version,captured_at,status) values($1,$2,$3,$4,'poison',now(),'ready')",[orgA,actorA,sourceIdentity,firstSnapshot])).rejects.toThrow('permission denied')
  await expect(db.query("update public.import_review_files set canonical_snapshot_hash=$1 where import_review_id=$2",['9'.repeat(64),review.reviewId])).rejects.toThrow('permission denied')
 })
 await expect(database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,actorB,foreign.reviewId,foreign.hash,[],'{}','[]','[]'])).rejects.toThrow()
})
it('rejects a reviewed import when any normalized line lacks source provenance',async()=>{
 const review=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'}});const estimateId=uid();const lineId=uid()
 await expect(database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,actorA,review.reviewId,review.hash,[],JSON.stringify({id:estimateId,name:'Missing provenance',project_type:'Office',baseline_role:'original_bid'}),JSON.stringify([{id:lineId,category:'materials',description:'Feeder',estimated_cost:100}]),'[]'])).rejects.toThrow('provenance')
 expect((await database.db.query('select id from public.estimates where id=$1',[estimateId])).rowCount).toBe(0)
})
it('rolls back business state on commit failure and rejects unreviewed warnings, expired contracts, and tenant spoofing',async()=>{
 const failed=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'}});const estimateId=uid();const commit=(reviewId:string,hash:string,acknowledged:string[]=[])=>database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,actorA,reviewId,hash,acknowledged,JSON.stringify({id:estimateId,name:'Must roll back',project_type:'Office',baseline_role:'original_bid'}),'[]','[]'])
 await expect(commit(failed.reviewId,failed.hash)).rejects.toThrow('estimate lines required');expect((await database.db.query('select id from public.estimates where id=$1',[estimateId])).rowCount).toBe(0);expect((await database.db.query('select status from public.import_reviews where id=$1',[failed.reviewId])).rows[0].status).toBe('staged')
 const warning=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'},issues:[{severity:'warning',code:'hours_missing',message:'Hours missing'}]});await expect(commit(warning.reviewId,warning.hash)).rejects.toThrow('acknowledged warnings');await expect(commit(warning.reviewId,warning.hash,['different_warning'])).rejects.toThrow('acknowledged warnings')
 const expired=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'},expiresAt:new Date(Date.now()+1000).toISOString()});await database.db.query("update public.import_reviews set created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' where id=$1",[expired.reviewId]);await expect(commit(expired.reviewId,expired.hash)).rejects.toThrow('expired')
 await expect(database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,actorB,failed.reviewId,failed.hash,[],JSON.stringify({id:uid(),name:'Foreign',project_type:'Office',baseline_role:'original_bid'}),JSON.stringify([{id:uid(),category:'labor',description:'Labor',estimated_cost:1}]),'[]'])).rejects.toThrow('owned by this user')
 await asUser(actorA,db=>expect(db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,actorA,failed.reviewId,failed.hash,[],'{}','[]','[]'])).rejects.toThrow('permission denied'))
})
it('creates immutable estimate revisions and keeps actual comparison on the submitted revision baseline',async()=>{
 const original=await estimate();const review=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:original,baselineRole:'revision'}});const revision=uid(),line=uid();const result=await database.db.query('select public.commit_estimate_import($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,actorA,review.reviewId,review.hash,[],JSON.stringify({id:revision,name:'Bid revision',project_type:'Office',parent_estimate_id:original,baseline_role:'revision'}),JSON.stringify([{id:line,category:'labor',description:'Revised labor',estimated_cost:200,estimated_hours:20}]),JSON.stringify([{lineId:line,fileRole:'estimate',worksheet:'CSV',sourceRow:2,mapping:{cost:'cost'},originalValues:{cost:'200'},normalizationDecisions:[],parserVersion:'2026-09-p1-v1'}])]);expect(result.rows[0].id).toBe(revision)
 const identities=(await database.db.query('select id,revision_group_id,parent_estimate_id,revision_number,baseline_role from public.estimates where id=any($1) order by revision_number',[[original,revision]])).rows
 expect(identities).toEqual([{id:original,revision_group_id:original,parent_estimate_id:null,revision_number:0,baseline_role:'original_bid'},{id:revision,revision_group_id:original,parent_estimate_id:original,revision_number:1,baseline_role:'revision'}])
 const inv=await begin(revision);await database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,revision,inv,'Review','deterministic',{cycleCount:0,toolsUsed:[]},'[]','[]',actorA]);for(const stage of ['reviewed','submitted','won','in_progress','completed'])await transition(revision,stage)
 const source=await archivedSource(revision);const jobId=(await asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,revision,JSON.stringify([{category:'labor',description:'Actual',actual_cost:220,actual_hours:22}]),'[]','[]','',source,JSON.stringify(noScopeChanges)]))).rows[0].id
 expect((await database.db.query('select source_estimate_id from public.jobs where id=$1',[jobId])).rows[0].source_estimate_id).toBe(revision);expect(Number((await database.db.query('select estimated_cost from public.job_estimate_lines where job_id=$1',[jobId])).rows[0].estimated_cost)).toBe(200)
})
it('commits reviewed closeout actuals once with quantity, units, provenance, and submitted baseline identity',async()=>{
 const{id}=await atStage('completed');const review=await stagedImportReview({kind:'closeout_actual',context:{estimateId:id},roles:['actuals']});const line=uid();const actuals=[{id:line,category:'labor',description:'Field labor',quantity:12,unit:'HR',normalized_unit:'HR',unit_cost:10,actual_cost:120,actual_hours:12}];const provenance=[{lineId:line,fileRole:'actuals',worksheet:'CSV',sourceRow:9,mapping:{quantity:'quantity',unit:'uom',cost:'actual cost'},originalValues:{quantity:'12',unit:'HR',cost:'120'},normalizationDecisions:['unit_normalized_to_HR'],parserVersion:'2026-09-p1-v1'}]
 const commit=(lines:unknown=actuals)=>database.db.query('select public.commit_closeout_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) id',[orgA,actorA,review.reviewId,review.hash,[],id,JSON.stringify(lines),'[]','[]','',JSON.stringify(noScopeChanges),JSON.stringify(provenance)])
 const first=(await commit()).rows[0].id;expect((await commit([{...actuals[0],actual_cost:99999}])).rows[0].id).toBe(first)
 const actual=(await database.db.query('select quantity,unit,normalized_unit,unit_cost,actual_cost from public.job_actual_lines where id=$1',[line])).rows[0];expect({quantity:Number(actual.quantity),unit:actual.unit,normalizedUnit:actual.normalized_unit,unitCost:Number(actual.unit_cost),cost:Number(actual.actual_cost)}).toEqual({quantity:12,unit:'HR',normalizedUnit:'HR',unitCost:10,cost:120})
 expect((await database.db.query('select estimate_baseline_role from public.jobs where id=$1',[first])).rows[0].estimate_baseline_role).toBe('final_submitted');expect((await database.db.query('select source_row,worksheet from public.import_line_provenance where job_actual_line_id=$1',[line])).rows[0]).toEqual({source_row:9,worksheet:'CSV'});expect((await database.db.query('select count(*)::int n from public.documents where job_id=$1',[first])).rows[0].n).toBe(1)
})
it('claims and finalizes cleanup only for expired uncommitted staged evidence',async()=>{
 const expired=await stagedImportReview({kind:'new_estimate',context:{parentEstimateId:null,baselineRole:'original_bid'}});await database.db.query("update public.import_reviews set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id=$1",[expired.reviewId]);const claimed=await database.db.query('select * from public.claim_expired_import_files($1,$2,$3)',[orgA,actorA,20]);expect(claimed.rows.filter(row=>row.review_id===expired.reviewId).map(row=>row.storage_path)).toEqual(expired.files.map(file=>file.storage_path));for(const row of claimed.rows)await database.db.query('delete from storage.objects where name=$1',[row.storage_path]);const reviewIds=[...new Set(claimed.rows.map(row=>row.review_id))];expect((await database.db.query('select public.finish_import_cleanup($1,$2,$3) n',[orgA,actorA,reviewIds])).rows[0].n).toBe(reviewIds.length);expect((await database.db.query('select status from public.import_reviews where id=$1',[expired.reviewId])).rows[0].status).toBe('cleaned')
})
it('applies actual category completeness at the closeout database boundary',async()=>{
 const id=uid()
 await asTrusted(actorA,db=>db.query('select public.create_estimate_with_lines($1,$2)',[
  {id,organization_id:orgA,name:'Closeout coverage',project_type:'Office',estimated_total:600,estimated_labor_hours:10},
  [{id:uid(),category:'labor',description:'Labor',estimated_cost:100,estimated_hours:10},{id:uid(),category:'materials',description:'Wire',estimated_cost:500}],
 ].map(value=>JSON.stringify(value))))
 const investigation=await begin(id)
 await database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,id,investigation,'Review','deterministic',{cycleCount:0,toolsUsed:[]},'[]','[]',actorA])
 for(const stage of ['reviewed','submitted','won','in_progress','completed'])await transition(id,stage)
 const actuals=JSON.stringify([{category:'labor',description:'Labor',actual_cost:100,actual_hours:10}])
 const source=await archivedSource(id)
 const close=(review:unknown)=>asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,id,actuals,'[]','[]','',source,JSON.stringify(review)]))
 await expect(close(noScopeChanges)).rejects.toThrow('missing expected categories')
 const closed=await close({status:'unreconciled',changes:[],actualCompleteness:'confirmed_complete'})
 const jobId=closed.rows[0].id
 expect((await database.db.query('select review from public.job_scope_reviews where job_id=$1',[jobId])).rows[0].review.actualCompleteness).toBe('unknown')
 expect((await database.db.query('select public.is_job_scope_reconciled($1,$2) usable',[orgA,jobId])).rows[0].usable).toBe(false)
})
it('applies structured actual completeness at the closeout database boundary',async()=>{
 const id=uid()
 await asTrusted(actorA,db=>db.query('select public.create_estimate_with_lines($1,$2)',[
  {id,organization_id:orgA,name:'Structured closeout',project_type:'Office'},
  [{id:uid(),category:'other',description:'Rough',estimated_cost:300,cost_code:'260100',phase:'ROUGH'},{id:uid(),category:'other',description:'Trim',estimated_cost:300,cost_code:'260200',phase:'TRIM'}],
 ].map(value=>JSON.stringify(value))))
 const investigation=await begin(id)
 await database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,id,investigation,'Review','deterministic',{cycleCount:0,toolsUsed:[]},'[]','[]',actorA])
 for(const stage of ['reviewed','submitted','won','in_progress','completed'])await transition(id,stage)
 const source=await archivedSource(id)
 const close=()=>asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,id,JSON.stringify([{id:uid(),category:'other',description:'Rough',actual_cost:300,cost_code:'260100',phase:'ROUGH'}]),'[]','[]','',source,JSON.stringify(noScopeChanges)]))
 await expect(close()).rejects.toThrow('structured coverage')
})
it('scope comparison is canonical and preserves original estimate, raw variance and total actuals',async()=>{
 const jid=await importScopedJob(adjustedScope)
 await asUser(actorA,async db=>{
  const job=(await db.query('select estimated_total,actual_total from public.jobs where id=$1',[jid])).rows[0]
  expect(Number(job.estimated_total)).toBe(100);expect(Number(job.actual_total)).toBe(150)
  expect(Number((await db.query('select cost_delta from public.job_variances where job_id=$1',[jid])).rows[0].cost_delta)).toBe(50)
  const adjusted=(await db.query('select * from public.job_scope_variances where job_id=$1',[jid])).rows[0]
  expect(Number(adjusted.estimated_cost)).toBe(150);expect(Number(adjusted.cost_delta)).toBe(0)
  expect(Number(adjusted.hours_delta)).toBe(0);expect(Number(adjusted.original_scope_actual_cost)).toBe(100)
  expect((await db.query('select reviewed_by,review from public.job_scope_reviews where job_id=$1',[jid])).rows[0]).toEqual({reviewed_by:actorA,review:adjustedScope})
 })
})
it('database scope comparison supports deductions and retains real residual overruns',async()=>{
 const deducted=await importScopedJob({status:'adjusted',actualCompleteness:'confirmed_complete',changes:[{...scopeChange,estimatedCost:-50,estimatedHours:-5,actualCost:0,actualHours:0}]},orgA,actorA,50,5)
 const overrun=await importScopedJob(adjustedScope,orgA,actorA,180,18)
 expect(Number((await database.db.query('select cost_delta from public.job_scope_variances where job_id=$1',[deducted])).rows[0].cost_delta)).toBe(0)
 expect(Number((await database.db.query('select cost_delta_pct from public.job_scope_variances where job_id=$1',[overrun])).rows[0].cost_delta_pct)).toBe(0.2)
})
it.each([
 {...scopeChange,actualCost:151},{...scopeChange,actualHours:16},
 {...scopeChange,estimatedCost:-101},{...scopeChange,estimatedHours:-11},
 {...scopeChange,category:'materials'},{...scopeChange,reference:''},
 {...scopeChange,estimatedCost:'50'},{...scopeChange,actualCost:-1},
 {...scopeChange,actualHours:0.001},{...scopeChange,unexpected:'ignored?'},
])('database rejects malformed/overallocated scope and rolls back the whole import: %j',async change=>{
 const before=Number((await database.db.query('select count(*) n from public.jobs')).rows[0].n)
 await expect(importScopedJob({status:'adjusted',actualCompleteness:'confirmed_complete',changes:[change]})).rejects.toThrow(/scope/)
 expect(Number((await database.db.query('select count(*) n from public.jobs')).rows[0].n)).toBe(before)
})
it.each([null,{status:'adjusted',changes:[],actualCompleteness:'confirmed_complete'},{status:'no_changes',changes:[scopeChange],actualCompleteness:'confirmed_complete'},{status:'unreconciled',changes:[scopeChange],actualCompleteness:'unknown'},{status:'no_changes',changes:[],actualCompleteness:'confirmed_complete',extra:true}])('database rejects invalid assessment shapes: %j',async review=>{
 await expect(importScopedJob(review)).rejects.toThrow(/scope/)
})
it('scope assessments and derived comparisons enforce tenant boundaries and immutability',async()=>{
 const jid=await importScopedJob(adjustedScope),foreign=await importScopedJob(adjustedScope,orgB,actorB)
 await asUser(actorA,async db=>{
  expect((await db.query('select * from public.job_scope_reviews where job_id=$1',[foreign])).rowCount).toBe(0)
  expect((await db.query('select * from public.job_scope_variances where job_id=$1',[foreign])).rowCount).toBe(0)
  for(const sql of ['update public.job_scope_reviews set review=$2 where job_id=$1','delete from public.job_scope_reviews where job_id=$1 returning $2::jsonb'])await expect(db.query(sql,[jid,noScopeChanges])).rejects.toThrow('permission denied')
  await expect(db.query('select public.store_job_scope_review($1,$2,$3)',[orgA,foreign,noScopeChanges])).rejects.toThrow('permission denied')
  await expect(db.query('insert into public.job_scope_reviews(job_id,organization_id,review,reviewed_by) values($1,$2,$3,$4)',[foreign,orgA,noScopeChanges,actorA])).rejects.toThrow('permission denied')
 })
 await expect(importScopedJob(adjustedScope,orgB,actorA)).rejects.toThrow('not authorized')
 await expect(database.db.query('update public.job_scope_reviews set review=$1 where job_id=$2',[noScopeChanges,jid])).rejects.toThrow('immutable')
 // The compound FK is still a boundary when a privileged caller bypasses RLS.
 const unlinked=uid();await database.db.query("insert into public.jobs(id,organization_id,created_by,name,project_type,completed_at) values($1,$2,$3,'Legacy parent','Office','2026-01-01')",[unlinked,orgB,actorB])
 await expect(database.db.query('insert into public.job_scope_reviews(job_id,organization_id,review,reviewed_by) values($1,$2,$3,$4)',[unlinked,orgA,noScopeChanges,actorA])).rejects.toThrow('foreign key')
})
it('unknown scope excludes existing vectors, lessons, comparisons and new investigation evidence',async()=>{
 const jid=await importScopedJob({status:'unreconciled',changes:[]}),vec=JSON.stringify([1,...Array(1535).fill(0)]),lesson=uid()
 await database.db.query('insert into public.job_search_documents(organization_id,job_id,content,embedding) values($1,$2,$3,$4)',[orgA,jid,'Previously indexed raw overrun',vec])
 await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status,embedding) values($1,$2,$3,'Old lesson','labor','Old claim','Unknown','Raw costs',0.8,'confirmed',$4)",[lesson,orgA,jid,vec])
 await asUser(actorA,async db=>{
  expect((await db.query('select * from public.job_scope_variances where job_id=$1',[jid])).rowCount).toBe(0)
  expect((await db.query('select * from public.match_jobs($1,$2,null,null,-1,20)',[orgA,vec])).rows.map(r=>r.id)).not.toContain(jid)
  expect((await db.query('select * from public.match_lessons($1,$2,-1,20)',[orgA,vec])).rows.map(r=>r.id)).not.toContain(lesson)
  expect((await db.query('select * from public.get_memory_readiness($1,$2)',[orgA,jid])).rows[0]).toMatchObject({pending_jobs:'0',pending_lessons:'0',unreconciled_jobs:'1'})
 })
 const id=await estimate(),inv=await begin(id)
 await expect(database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,{id:uid(),investigationId:inv,kind:'search',toolName:'search_similar_jobs',result:{jobIds:[jid]}}])).rejects.toThrow('not eligible')
 // Simulate retrieval performed before this migration; new calculations still fail.
 await database.db.query('alter table public.investigation_evidence disable trigger scope_evidence')
 try{await database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,{id:uid(),investigationId:inv,kind:'search',toolName:'search_similar_jobs',result:{jobIds:[jid]}}])}finally{await database.db.query('alter table public.investigation_evidence enable trigger scope_evidence')}
 await expect(database.db.query('select public.append_investigation_evidence($1,$2,$3,$4)',[orgA,inv,actorA,{id:uid(),investigationId:inv,kind:'calculation',toolName:'calculate_category_risk',result:{comparableJobIds:[jid]}}])).rejects.toThrow('not eligible')
 expect((await database.db.query('select id from public.lessons where id=$1',[lesson])).rowCount).toBe(1)
})
it('unreconciled closeout cannot assert an automatic verdict or feed warning calibration',async()=>{
 const{id,findingId}=await atStage('completed',true)
 const jid=(await asTrusted(actorA,async db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7) id',[orgA,id,JSON.stringify([{category:'labor',description:'Labor',actual_cost:150,actual_hours:15}]),'[]',JSON.stringify([{finding_id:findingId,system_verdict:'validated',explanation:'Forged certainty',confidence:1}]),'',await archivedSource(id)]))).rows[0].id
 const outcome=(await database.db.query('select * from public.finding_outcomes where job_id=$1',[jid])).rows[0]
 expect(outcome.system_verdict).toBe('not_evaluable');expect(Number(outcome.confidence)).toBe(0)
 const before=await asUser(actorA,db=>db.query('select * from public.get_warning_calibration($1)',[orgA]))
 await asUser(actorA,db=>db.query("select public.confirm_finding_outcome($1,$2,'validated')",[orgA,outcome.id]))
 const after=await asUser(actorA,db=>db.query('select * from public.get_warning_calibration($1)',[orgA]))
 expect(after.rows).toEqual(before.rows)
})
it('closeout saves scope atomically with original submission and concurrent retries keep one assessment',async()=>{
 const{id,findingId}=await atStage('completed',true)
 const before=(await database.db.query('select evidence_snapshot from public.submission_findings where finding_id=$1',[findingId])).rows[0]
 const source1=await archivedSource(id),source2=await archivedSource(id)
 const close=(scope:unknown,source:string)=>asTrusted(actorA,db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8) id',[orgA,id,JSON.stringify([{category:'labor',description:'All circuits',actual_cost:150,actual_hours:15}]),'[]',JSON.stringify([{finding_id:findingId,system_verdict:'not_observed',explanation:'Scope-only change',confidence:0.8}]),'',source,JSON.stringify(scope)]))
 await expect(close({...adjustedScope,changes:[{...scopeChange,actualCost:999}]},source1)).rejects.toThrow('scope allocation')
 expect((await database.db.query('select lifecycle_status from public.estimates where id=$1',[id])).rows[0].lifecycle_status).toBe('completed')
 expect((await database.db.query('select id from public.jobs where source_estimate_id=$1',[id])).rowCount).toBe(0)
 const results=await Promise.all([close(adjustedScope,source1),close(adjustedScope,source2)])
 const jid=results[0].rows[0].id;expect(results[1].rows[0].id).toBe(jid)
 await close(noScopeChanges,'[]')
 expect((await database.db.query('select review from public.job_scope_reviews where job_id=$1',[jid])).rows).toEqual([{review:adjustedScope}])
 expect((await database.db.query('select evidence_snapshot from public.submission_findings where finding_id=$1',[findingId])).rows[0]).toEqual(before)
 expect(Number((await database.db.query('select estimated_cost from public.estimate_lines where estimate_id=$1',[id])).rows[0].estimated_cost)).toBe(100)
 expect(Number((await database.db.query('select cost_delta from public.job_scope_variances where job_id=$1',[jid])).rows[0].cost_delta)).toBe(0)
})
it('duplicate scope references cannot double the adjusted category budget',async()=>{
 await expect(importScopedJob({status:'adjusted',actualCompleteness:'confirmed_complete',changes:[scopeChange,{...scopeChange,reference:' CO-1 APPROVED BY CUSTOMER '}]})).rejects.toThrow('duplicate scope')
})
it('unknown-scope lessons cannot be newly confirmed',async()=>{
 const jid=await importScopedJob({status:'unreconciled',changes:[]}),lesson=uid()
 await database.db.query("insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status) values($1,$2,$3,'Pending','labor','Review','Unknown','Raw variance',0.5,'pending')",[lesson,orgA,jid])
 await asUser(actorA,async db=>{
  await expect(db.query("update public.lessons set status='confirmed' where id=$1",[lesson])).rejects.toThrow('permission denied')
  await expect(db.query("update public.lessons set status='rejected' where id=$1",[lesson])).rejects.toThrow('permission denied')
 })
})
it('older jobs without an assessment remain readable but excluded from comparisons',async()=>{
 const jid=uid()
 await database.db.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA])
 try{await database.db.query('select public.create_completed_job_before_scope($1,$2,$3,$4,$5)',[
  {id:jid,organization_id:orgA,name:'Pre-migration history',project_type:'Office',completed_at:'2026-01-01'},
  [{id:uid(),category:'labor',description:'Original',estimated_cost:100,estimated_hours:10}],
  [{id:uid(),category:'labor',description:'Final',actual_cost:150,actual_hours:15}],[],[]].map(x=>JSON.stringify(x)))}finally{await database.db.query("select set_config('request.jwt.claim.sub','',false)")}
 await asUser(actorA,async db=>{
  expect((await db.query('select * from public.jobs where id=$1',[jid])).rowCount).toBe(1)
  expect((await db.query('select * from public.job_scope_reviews where job_id=$1',[jid])).rowCount).toBe(0)
  expect((await db.query('select * from public.job_scope_variances where job_id=$1',[jid])).rowCount).toBe(0)
  expect((await db.query('select * from public.get_memory_readiness($1,$2)',[orgA,jid])).rows[0].unreconciled_jobs).toBe('1')
 })
})

const responsePayload=(kind='mitigation_completed')=>({kind,note:'Booked shutdown and crew; field log checked.',revisionReference:'Workbook R2'})
async function recordResponse(findingId:string,kind='mitigation_completed',status:string|null=null,responseId=uid(),actor=actorA,org=orgA){
 await asUser(actor,db=>db.query('select public.record_finding_response($1,$2,$3,$4,$5)',[org,findingId,responseId,responsePayload(kind),status]));return responseId
}
async function closeWarning(id:string,findingId:string){
 await asTrusted(actorA,async db=>db.query('select public.closeout_estimate_with_actuals($1,$2,$3,$4,$5,$6,$7,$8)',[orgA,id,JSON.stringify([{category:'labor',description:'Labor',actual_cost:100,actual_hours:10}]),'[]',JSON.stringify([{finding_id:findingId,system_verdict:'not_observed',explanation:'Within budget',evidence_summary:'Cost variance 0%; hours variance 0%.',confidence:0.9}]),'Field log',await archivedSource(id),JSON.stringify({status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'})]))
 return (await database.db.query<{id:string}>('select id from public.finding_outcomes where estimate_id=$1',[id])).rows[0].id
}
const helped=(responseId:string)=>({condition:'not_observed',mitigation:'helped',responseId,note:'Review of field logs confirms the shutdown avoided occupied-hours work.'})
const confirmResponse=(outcomeId:string,verdict:string,assessment:unknown)=>asUser(actorA,db=>db.query('select public.confirm_finding_outcome($1,$2,$3,$4)',[orgA,outcomeId,verdict,assessment]))
it('records an attributable decision atomically and freezes only pre-submission responses',async()=>{
 const{id,findingId}=await prepared(true)
 const responseId=await recordResponse(findingId,'mitigation_planned','resolved')
 const original=(await database.db.query('select * from public.finding_responses where id=$1',[responseId])).rows[0]
 expect(original).toMatchObject({organization_id:orgA,estimate_id:id,finding_id:findingId,recorded_by:actorA,recorded_stage:'draft',requested_status:'resolved'})
 expect((await database.db.query('select status from public.estimates where id=$1',[id])).rows[0].status).toBe('ready')
 await transition(id,'reviewed');await transition(id,'submitted')
 const snapshot=(await database.db.query('select response_snapshot,evidence_snapshot from public.submission_findings where estimate_id=$1',[id])).rows[0]
 expect(snapshot.response_snapshot).toHaveLength(1);expect(snapshot.response_snapshot[0].id).toBe(responseId)
 const later=await recordResponse(findingId)
 expect((await database.db.query('select recorded_stage from public.finding_responses where id=$1',[later])).rows[0].recorded_stage).toBe('submitted')
 expect((await database.db.query('select response_snapshot,evidence_snapshot from public.submission_findings where estimate_id=$1',[id])).rows[0]).toEqual(snapshot)
 await expect(database.db.query("update public.submission_findings set response_snapshot='[]' where estimate_id=$1",[id])).rejects.toThrow('immutable')
 await expect(recordResponse(findingId,'verified','resolved')).rejects.toThrow('frozen')
 await recordResponse(findingId,'mitigation_planned','resolved',responseId)
 expect((await database.db.query('select * from public.finding_responses where id=$1',[responseId])).rows[0]).toEqual(original)
 await expect(recordResponse(findingId,'verified',null,responseId)).rejects.toThrow('conflicts')
})
it('rejects malformed response and status mismatches without changing the finding',async()=>{
 const{findingId}=await prepared(true)
 for(const payload of [{...responsePayload(),note:' '},{...responsePayload(),recordedBy:actorB},{...responsePayload(),revisionReference:7}])await asUser(actorA,db=>expect(db.query('select public.record_finding_response($1,$2,$3,$4,$5)',[orgA,findingId,uid(),payload,'resolved'])).rejects.toThrow('invalid'))
 await expect(recordResponse(findingId,'dismissed','resolved')).rejects.toThrow('match')
 expect((await database.db.query('select status from public.findings where id=$1',[findingId])).rows[0].status).toBe('open')
 expect((await database.db.query('select id from public.finding_responses where finding_id=$1',[findingId])).rowCount).toBe(0)
 await recordResponse(findingId,'dismissed','dismissed')
 expect((await database.db.query('select status from public.findings where id=$1',[findingId])).rows[0].status).toBe('dismissed')
})
it('isolates immutable response records and rejects cross-tenant and cross-estimate parent IDs',async()=>{
 const{id,findingId}=await prepared(true);const responseId=await recordResponse(findingId,'verified','resolved')
 await asUser(actorB,async db=>{expect((await db.query('select id from public.finding_responses where id=$1',[responseId])).rowCount).toBe(0)})
 await expect(recordResponse(findingId,'verified',null,uid(),actorB,orgA)).rejects.toThrow('not authorized')
 await expect(recordResponse(findingId,'verified',null,uid(),actorB,orgB)).rejects.toThrow('not found')
 await asUser(actorA,async db=>{
  for(const q of ['update public.finding_responses set note=\'changed\' where id=$1','delete from public.finding_responses where id=$1'])await expect(db.query(q,[responseId])).rejects.toThrow('permission denied')
  await expect(db.query("insert into public.finding_responses(id,organization_id,estimate_id,finding_id,kind,note,recorded_stage,recorded_by) values($1,$2,$3,$4,'verified','forged','draft',$5)",[uid(),orgA,id,findingId,actorA])).rejects.toThrow('permission denied')
 })
 await expect(database.db.query('delete from public.finding_responses where id=$1',[responseId])).rejects.toThrow('immutable')
 const other=await estimate()
 for(const[org,parent]of[[orgB,id],[orgA,other]])await expect(database.db.query("insert into public.finding_responses(id,organization_id,estimate_id,finding_id,kind,note,recorded_stage,recorded_by) values($1,$2,$3,$4,'verified','forged','draft',$5)",[uid(),org,parent,findingId,actorA])).rejects.toThrow('foreign key')
})
it('preserves a reopened response history when a rerun replaces active findings',async()=>{
 const{id,findingId}=await prepared(true);const responseId=await recordResponse(findingId,'verified','resolved')
 await asUser(actorA,db=>db.query("select public.set_finding_status($1,$2,'open')",[orgA,findingId]))
 const inv=await begin(id)
 await database.db.query('select public.persist_investigation_result($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,id,inv,'Rerun','deterministic',{},'[]','[]',actorA])
 expect((await database.db.query('select status from public.findings where id=$1',[findingId])).rows[0].status).toBe('superseded')
 expect((await database.db.query('select id from public.finding_responses where id=$1',[responseId])).rowCount).toBe(1)
 await asUser(actorA,db=>expect(db.query("select public.set_finding_status($1,$2,'open')",[orgA,findingId])).rejects.toThrow('historical'))
 await transition(id,'reviewed');await transition(id,'submitted')
 expect((await database.db.query('select id from public.submission_findings where estimate_id=$1',[id])).rowCount).toBe(0)
 await expect(recordResponse(findingId)).rejects.toThrow('submitted warning')
})
it.each(['lost','learning_review','learned'])('closes responses at %s while permitting exact committed retries',async stage=>{
 const{id,findingId}=await atStage(stage==='lost'?'submitted':'completed',true);const responseId=await recordResponse(findingId)
 if(stage==='lost')await transition(id,'lost')
 else{const outcome=await closeWarning(id,findingId);if(stage==='learned'){await confirmResponse(outcome,'mitigated',helped(responseId));await asUser(actorA,db=>db.query('select public.try_finalize_estimate_learning($1,$2)',[orgA,id]))}}
 await expect(recordResponse(findingId)).rejects.toThrow('closed')
 await recordResponse(findingId,'mitigation_completed',null,responseId)
})
it('requires structured mitigation attribution and counts helped responses outside the hit-rate denominator',async()=>{
 const{id,findingId}=await atStage('completed',true);const responseId=await recordResponse(findingId);const outcome=await closeWarning(id,findingId)
 expect((await database.db.query('select system_verdict,confidence::float8,evidence_summary from public.finding_outcomes where id=$1',[outcome])).rows[0]).toMatchObject({system_verdict:'not_evaluable',confidence:0,evidence_summary:'Cost variance 0%; hours variance 0%.'})
 await asUser(actorA,db=>expect(db.query("select public.confirm_finding_outcome($1,$2,'not_observed')",[orgA,outcome])).rejects.toThrow('structured'))
 await expect(confirmResponse(outcome,'validated',helped(responseId))).rejects.toThrow('match')
 const before=(await asUser(actorA,db=>db.query('select * from public.get_warning_calibration($1)',[orgA]))).rows[0]
 await confirmResponse(outcome,'mitigated',helped(responseId))
 const after=(await asUser(actorA,db=>db.query('select * from public.get_warning_calibration($1)',[orgA]))).rows[0]
 expect(Number(after.mitigated)).toBe(Number(before.mitigated)+1);expect(Number(after.total)).toBe(Number(before.total)+1)
 expect(after.evaluable).toBe(before.evaluable);expect(after.hit_rate).toBe(before.hit_rate)
 expect((await asUser(actorB,db=>db.query('select * from public.get_warning_calibration($1)',[orgA]))).rowCount).toBe(0)
 await asUser(actorA,db=>db.query('select public.try_finalize_estimate_learning($1,$2)',[orgA,id]))
 await confirmResponse(outcome,'mitigated',helped(responseId))
 await expect(confirmResponse(outcome,'mitigated',{...helped(responseId),note:'Changed after learning'})).rejects.toThrow('learning review')
 expect((await database.db.query('select confirmed_assessment from public.finding_outcomes where id=$1',[outcome])).rows[0].confirmed_assessment).toEqual(helped(responseId))
})
it('rejects unknown, planned and other-warning mitigation references and misleading unattempted assessments',async()=>{
 const first=await atStage('completed',true),second=await prepared(true)
 const completed=await recordResponse(first.findingId),planned=await recordResponse(first.findingId,'mitigation_planned'),other=await recordResponse(second.findingId)
 const outcome=await closeWarning(first.id,first.findingId)
 for(const ref of [uid(),planned,other])await expect(confirmResponse(outcome,'mitigated',helped(ref))).rejects.toThrow('completed response')
 await expect(confirmResponse(outcome,'mitigated',{...helped(completed),responseId:null})).rejects.toThrow('completed response')
 await expect(confirmResponse(outcome,'not_observed',{...helped(completed),mitigation:'not_attempted',responseId:null})).rejects.toThrow('recorded mitigation')
 await expect(confirmResponse(outcome,'mitigated',{...helped(completed),condition:'unknown'})).rejects.toThrow('condition')
 await expect(confirmResponse(outcome,'mitigated',{...helped(completed),savedCost:1000})).rejects.toThrow('invalid')
 await confirmResponse(outcome,'not_evaluable',{...helped(completed),mitigation:'unknown'})
 expect((await database.db.query('select confirmed_verdict from public.finding_outcomes where id=$1',[outcome])).rows[0].confirmed_verdict).toBe('not_evaluable')
})

async function waitForDatabaseLock(pid:number){
 for(let i=0;i<100;i++){const result=await database.db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(result.rows[0]?.wait_event_type==='Lock')return true;await new Promise(resolve=>setTimeout(resolve,5))}
 return false
}
it.each(['submission','closeout','learning'])('serializes response evidence behind %s using the estimate lock',async boundary=>{
 const{id,findingId}=await atStage(boundary==='submission'?'reviewed':'completed',true)
 const responseId=await recordResponse(findingId)
 let outcome:string|undefined
 if(boundary==='learning'){outcome=await closeWarning(id,findingId);await confirmResponse(outcome,'mitigated',helped(responseId))}
 const writer=new pg.Client(database.config),responder=new pg.Client(database.config)
 await Promise.all([writer.connect(),responder.connect()])
 try{
  for(const db of [writer,responder]){await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actorA])}
  await writer.query('begin')
  if(boundary==='submission')await writer.query("select public.transition_estimate_lifecycle($1,$2,'submitted','',150)",[orgA,id])
  else if(boundary==='learning')await writer.query('select public.try_finalize_estimate_learning($1,$2)',[orgA,id])
  else {await writer.query('set role service_role');await writer.query('select public.closeout_estimate_server($1,$2,$3,$4,$5,$6,$7,$8,$9)',[orgA,actorA,id,JSON.stringify([{category:'labor',description:'Labor',actual_cost:100,actual_hours:10}]),'[]',JSON.stringify([{finding_id:findingId,system_verdict:'not_observed',explanation:'Within budget',confidence:0.9}]),'',await archivedSource(id),JSON.stringify({status:'no_changes',changes:[],actualCompleteness:'confirmed_complete'})])}
  const pid=(await responder.query('select pg_backend_pid() pid')).rows[0].pid
  const later=uid()
  const pending=(boundary==='learning'
   ?responder.query('select public.confirm_finding_outcome($1,$2,$3,$4)',[orgA,outcome,'mitigated',{...helped(responseId),note:'Concurrent rewrite'}])
   :responder.query('select public.record_finding_response($1,$2,$3,$4)',[orgA,findingId,later,responsePayload()])
  ).then(()=>({accepted:true,error:''}),error=>({accepted:false,error:String(error)}))
  const blocked=await waitForDatabaseLock(pid);await writer.query('commit');const result=await pending
  expect(blocked).toBe(true)
  if(boundary==='submission'){
   expect(result.accepted).toBe(true)
   expect((await database.db.query('select recorded_stage from public.finding_responses where id=$1',[later])).rows[0].recorded_stage).toBe('submitted')
   expect((await database.db.query('select response_snapshot from public.submission_findings where estimate_id=$1',[id])).rows[0].response_snapshot.map((r:{id:string})=>r.id)).toEqual([responseId])
  }else{expect(result.accepted).toBe(false);expect(result.error).toContain(boundary==='learning'?'learning review':'closed')}
 }finally{await writer.query('rollback');await Promise.all([writer.end(),responder.end()])}
})
