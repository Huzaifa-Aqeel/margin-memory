import { describe, expect, it } from 'vitest'
import type { Estimate } from '../src/lib/domain/types'
import type { ImportReviewRecord } from '../src/lib/import-contract'
import { presentExcelEstimate } from '../src/lib/integrations/excel-contract'
import { analyzeExcelReview, verifyExcelReviewContract } from '../src/lib/integrations/excel-review-server'
import { analyzeExcelSnapshotIdentity } from '../src/lib/integrations/excel-snapshot-server'
import { automaticExcelSourceCandidate, canonicalExcelSnapshot, canonicalWorkbookLocation, EXCEL_SOURCE_ADAPTER_VERSION, type ExcelLiveSnapshot } from '../src/lib/integrations/excel-snapshot'
import { parseEstimateExcelSnapshotWithReport } from '../src/lib/spreadsheet'

const profile={name:'Occupied office renovation',projectType:'Tenant fit-out',customerType:'Commercial',location:'Philadelphia',bidDue:null,tags:['occupied'],assumptions:[]}
const snapshot=(overrides:Partial<ExcelLiveSnapshot>={}):ExcelLiveSnapshot=>({
 sourceType:'excel_live_snapshot',adapterVersion:EXCEL_SOURCE_ADAPTER_VERSION,
 workbook:{name:'final-bid.xlsx',documentUrlHash:'a'.repeat(64)},
 worksheet:{id:'sheet-detail',name:'Bid Detail',visibility:'visible'},
 selection:{kind:'table',address:'Bid Detail!A1:F3',tableId:'table-estimate',tableName:'EstimateTable'},
 rowCount:3,columnCount:6,
 cells:[
  ['Description','Category','Quantity','Unit','Cost','Hours'],
  ['Branch wiring','Materials',10,'EA',1250,0],
  ['Installation','Labor',1,'LS',300,12],
 ].map(row=>row.map(value=>({value,text:String(value),formula:null}))),
 capturedAt:'2026-09-12T09:00:00.000Z',...overrides,
})

describe('Excel live-source identity and review binding',()=>{
 it('auto-selects one bounded named table but never transmits a bare used range without explicit selection',()=>{
  const usedRange={worksheetId:'sheet',kind:'used_range' as const}
  const table={worksheetId:'sheet',kind:'table' as const,label:'Estimate table'}
  expect(automaticExcelSourceCandidate([usedRange])).toBeUndefined()
  expect(automaticExcelSourceCandidate([usedRange,table])).toBe(table)
  expect(automaticExcelSourceCandidate([usedRange,table,{worksheetId:'other',kind:'used_range'}])).toBeUndefined()
 })

 it('gives the same logical identity to the same relevant state and ignores capture/display-only changes',()=>{
  const first=snapshot();const second=snapshot({capturedAt:'2026-09-12T10:00:00.000Z',cells:snapshot().cells.map(row=>row.map(cell=>({...cell,text:`display:${cell.text}`})))})
  expect(canonicalExcelSnapshot(second)).toBe(canonicalExcelSnapshot(first))
 expect(analyzeExcelSnapshotIdentity(second).snapshotHash).toBe(analyzeExcelSnapshotIdentity(first).snapshotHash)
  expect(canonicalWorkbookLocation('https://TENANT.sharepoint.com/bid.xlsx?token=one#sheet')).toBe(canonicalWorkbookLocation('https://tenant.sharepoint.com/bid.xlsx?token=two'))
 })

 it.each([
  ['cost',4,999],['hours',5,24],['quantity',2,20],
 ] as const)('changes identity when a material %s cell changes',(_label,column,value)=>{
  const cells=snapshot().cells.map(row=>row.map(cell=>({...cell})));cells[1][column]={...cells[1][column],value,text:String(value)}
  expect(analyzeExcelSnapshotIdentity(snapshot({cells})).snapshotHash).not.toBe(analyzeExcelSnapshotIdentity(snapshot()).snapshotHash)
 })

 it('uses the hardened spreadsheet analyzer and preserves line provenance',async()=>{
  const parsed=await parseEstimateExcelSnapshotWithReport(snapshot())
  expect(parsed.report.mappedColumns).toMatchObject({description:'description',category:'category',cost:'cost',hours:'hours',quantity:'quantity',unit:'unit'})
  expect(parsed.lines.map(line=>line.estimatedCost)).toEqual([1250,300])
  expect(parsed.provenance.map(line=>[line.worksheet,line.sourceRow])).toEqual([['Bid Detail',2],['Bid Detail',3]])
 })

 it('keeps strict numeric and formula protections for live snapshots',async()=>{
  const malformedCells=snapshot().cells.map(row=>row.map(cell=>({...cell})));malformedCells[1][4]={value:'1.234,56',text:'1.234,56',formula:null}
  const malformed=await parseEstimateExcelSnapshotWithReport(snapshot({cells:malformedCells}))
  expect(malformed.report.issues.map(issue=>issue.code)).toContain('invalid_numbers')
  const formulaCells=snapshot().cells.map(row=>row.map(cell=>({...cell})));formulaCells[1][4]={value:1250,text:'$1,250.00',formula:'=C2*125'}
  const formula=await parseEstimateExcelSnapshotWithReport(snapshot({cells:formulaCells}))
  expect(formula.report.issues.map(issue=>issue.code)).toContain('formula_cached_value')
  const missingCache=formulaCells.map(row=>row.map(cell=>({...cell})));missingCache[1][4]={value:null,text:'',formula:'=C2*125'}
  expect((await parseEstimateExcelSnapshotWithReport(snapshot({cells:missingCache}))).report.issues.map(issue=>issue.code)).toContain('invalid_numbers')
 })

 it('rejects hidden, malformed, and resource-unbounded snapshots before analysis',()=>{
  expect(()=>analyzeExcelSnapshotIdentity({...snapshot(),worksheet:{...snapshot().worksheet,visibility:'hidden'}})).toThrow()
  expect(()=>analyzeExcelSnapshotIdentity({...snapshot(),rowCount:2})).toThrow('row count')
  expect(()=>analyzeExcelSnapshotIdentity({...snapshot(),columnCount:257})).toThrow()
 })

 it('rejects a changed workbook snapshot after review while accepting an exact recapture',async()=>{
  const analyzed=await analyzeExcelReview({snapshot:snapshot(),profile})
  const review:ImportReviewRecord={id:crypto.randomUUID(),organizationId:crypto.randomUUID(),userId:crypto.randomUUID(),importKind:'new_estimate',parserVersion:analyzed.analysis.parserVersion,reportHash:analyzed.reportHash,context:analyzed.analysis.context,reports:analyzed.analysis.reports,issues:analyzed.analysis.issues,status:'staged',expiresAt:new Date(Date.now()+60_000).toISOString(),files:[{id:crypto.randomUUID(),role:'estimate',ordinal:0,fileName:'snapshot.json',storagePath:'private/snapshot.json',mimeType:'application/json',sizeBytes:analyzed.source.artifactBytes,sha256:'b'.repeat(64),extractedText:'',worksheet:'Bid Detail',sourceType:'excel_live_snapshot',sourceAdapterVersion:EXCEL_SOURCE_ADAPTER_VERSION,sourceMetadata:{sourceIdentityHash:analyzed.source.sourceIdentityHash,worksheetId:'sheet-detail'},canonicalSnapshotHash:analyzed.source.snapshotHash,sourceCapturedAt:snapshot().capturedAt}]}
  await expect(verifyExcelReviewContract({review,snapshot:snapshot({capturedAt:'2026-09-12T10:00:00.000Z'}),submittedReportHash:analyzed.reportHash})).resolves.toBeDefined()
  const changed=snapshot();changed.cells[1][4]={value:900,text:'900',formula:null}
  await expect(verifyExcelReviewContract({review,snapshot:changed,submittedReportHash:analyzed.reportHash})).rejects.toThrow('changed after review')
  await expect(verifyExcelReviewContract({review,snapshot:snapshot(),submittedReportHash:'0'.repeat(64)})).rejects.toThrow('does not match')
 })
})

describe('Excel result presentation',()=>{
 const estimate=(findings:Estimate['findings']=[],questions:Estimate['questions']=[],investigationStatus:Estimate['investigationStatus']=questions.length?'needs_input':'completed'):Estimate=>({id:crypto.randomUUID(),name:'Bid',projectType:'Office',customerType:'Commercial',location:'',tags:[],assumptions:[],lines:[],estimatedTotal:0,estimatedLaborHours:0,createdAt:new Date().toISOString(),status:questions.length?'needs_input':'ready',investigationStatus,lifecycleStatus:'draft',findings,submittedFindingIds:[],findingOutcomes:[],questions:questions})
 it('treats a completed zero-finding review as a successful result',()=>expect(presentExcelEstimate(estimate()).result).toBe('no_findings'))
 it('does not turn queued, running, failed, or waiting states into a zero-finding result',()=>{
  expect(presentExcelEstimate(estimate([],[],'queued')).result).toBe('running')
  expect(presentExcelEstimate(estimate([],[],'investigating')).result).toBe('running')
  expect(presentExcelEstimate(estimate([],[],'failed')).result).toBe('failed')
  expect(presentExcelEstimate(estimate([], [{id:'question',estimateId:'estimate',prompt:'Occupied?',context:'Access',options:['Yes','No']}],'needs_input')).result).toBe('needs_input')
 })
 it('shows no more than three persisted findings',()=>{const finding=(index:number):Estimate['findings'][number]=>({id:String(index),estimateId:'estimate',category:'labor',severity:'medium',title:`Finding ${index}`,claim:'Fact',rationale:'Interpretation',recommendation:'Action',evidence:[],confidence:.6,status:'open',createdAt:new Date().toISOString()});expect(presentExcelEstimate(estimate([0,1,2,3].map(finding))).findings).toHaveLength(3)})
})
