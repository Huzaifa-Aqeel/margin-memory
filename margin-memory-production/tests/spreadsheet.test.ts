import { describe,it,expect } from 'vitest'
import ExcelJS from 'exceljs'
import { assessImportPair, IMPORT_RESOURCE_LIMITS, parseActualFile,parseActualFileWithReport,parseEstimateFile,parseEstimateFileWithReport,requireImportApproval } from '../src/lib/spreadsheet'
const csv=(value:string)=>new File([value],'cost.csv',{type:'text/csv'})
describe('spreadsheet normalization',()=>{
 it.each(['Subtotal','Total','Grand Total','Labor Total','Material Total','Equipment Total','Section Total','Category Total',''])('does not count %s rollups',async label=>{
  for(const parse of [parseEstimateFile,parseActualFile]) { const rows=await parse(csv('Description,Cost\nWire,100\n'+label+',100'));expect(rows).toHaveLength(1) }
 })
 it('independently checks category and description',async()=>expect(await parseEstimateFile(csv('Category,Description,Cost\nMaterials,Wire,100\nSubtotal,Subtotal,100'))).toHaveLength(1))
 it('handles section totals and title rows',async()=>{const rows=await parseEstimateFile(csv('Contractor cost report\nDescription,Cost\nWire,100\nMaterial total,100\nCrew,200\nLabor total,200\nGrand total,300'));expect(rows.reduce((n,l)=>n+l.estimatedCost,0)).toBe(300)})
 it('preserves real details',async()=>expect(await parseEstimateFile(csv('Description,Cost\nTotal station,100\nSubtotal connector,50'))).toHaveLength(2))
 it('handles XLSX cached formulas, rich text, and quantity rates',async()=>{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Costs');sheet.addRow(['Electrical contractor']);sheet.addRow(['Description','Quantity','Unit Cost','Estimated Cost']);sheet.addRow([{richText:[{text:'Wire'}]},2,50,{formula:'B3*C3',result:100}]);sheet.addRow(['Conduit',3,20]);sheet.addRow(['Total',null,null,{formula:'SUM(D3:D4)',result:160}]);
  const rows=await parseEstimateFile(new File([new Uint8Array(await book.xlsx.writeBuffer())],'cost.xlsx'));expect(rows.map(r=>r.estimatedCost)).toEqual([100,60])
 })
 it('reports detected headers, totals, skipped rollups and category coverage',async()=>{
  const {lines,report}=await parseEstimateFileWithReport(csv('Report title\nCost Type,Item Description,Budget Amount,Budgeted MH\nL,Branch rough-in,1000,12\nMAT,Wire and devices,500,0\nGrand Total,,1500,12'))
  expect(lines.map(line=>line.category)).toEqual(['labor','materials'])
  expect(report).toMatchObject({headerRow:2,importedRows:2,skippedSummaryRows:1,totalCost:1500,totalHours:12,invalidNumericCells:0,categoryCounts:{labor:1,materials:1,equipment:0,subcontractor:0,permit:0,other:0}})
  expect(report.mappedColumns).toMatchObject({category:'cost type',description:'item description',cost:'budget amount',hours:'budgeted mh'})
  expect(report.issues).toEqual([])
 })
 it.each([['tab','\t'],['semicolon',';']] as const)('parses %s-delimited contractor exports',async(_name,delimiter)=>{
  const file=new File([`Activity${delimiter}Class${delimiter}Job Cost${delimiter}Hours Worked\nInstall feeders${delimiter}LAB${delimiter}$1,250${delimiter}10`],'actual.csv',{type:'text/csv'})
  const {lines,report}=await parseActualFileWithReport(file)
  expect(lines[0]).toMatchObject({category:'labor',actualCost:1250,actualHours:10})
  expect(report.issues).toEqual([])
 })
 it('blocks invalid numeric cells instead of silently dropping them',async()=>{
  const {report}=await parseEstimateFileWithReport(csv('Description,Category,Budget Cost,Budget Hours\nLabor,Labor,not-a-number,ten'))
  expect(report.invalidNumericCells).toBe(2)
  expect(report.issues.map(issue=>issue.code)).toContain('invalid_numbers')
  expect(()=>requireImportApproval(report.issues,true)).toThrow('could not be interpreted')
 })
 it('requires explicit review for usable limitations',async()=>{
  const {report}=await parseEstimateFileWithReport(csv('Description,Cost\nBranch labor,100'))
  expect(report.issues).toContainEqual(expect.objectContaining({code:'hours_missing',severity:'warning'}))
  expect(()=>requireImportApproval(report.issues,false)).toThrow('confirm')
  expect(()=>requireImportApproval(report.issues,true)).not.toThrow()
 })
 it('detects category and labor-hour mismatches between estimate and actual exports',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Category,Estimated Cost,Estimated Hours\nLabor,Labor,100,10'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Actual Cost\nLabor,Labor,100\nLift,Equipment,100'))).report
  const pair=assessImportPair(estimate,actual)
  expect(pair.issues.map(issue=>issue.code)).toEqual(expect.arrayContaining(['hours_missing','actual_only_categories','hours_not_comparable']))
  expect(pair.requiresReview).toBe(true)
 })
 it('flags probable unit or scope-scale mismatches without fabricating a correction',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,100,10'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,10000,1000'))).report
  expect(assessImportPair(estimate,actual).issues).toContainEqual(expect.objectContaining({code:'total_scale_mismatch'}))
  expect(estimate.totalCost).toBe(100);expect(actual.totalCost).toBe(10000)
 })
 it('rejects duplicate normalized headers that would otherwise overwrite values',async()=>{
  const {report}=await parseEstimateFileWithReport(csv('Description,Cost, COST \nWire,100,200'))
  expect(report.issues).toContainEqual(expect.objectContaining({code:'duplicate_headers',severity:'error'}))
 })
 it('retains credits and flags commercial rows for human mapping review',async()=>{
  const {lines,report}=await parseActualFileWithReport(csv('Description,Category,Actual Cost,Actual Hours\nMaterial credit,Materials,-50,0\nProject overhead,Other,100,0'))
  expect(lines.map(line=>line.actualCost)).toEqual([-50,100])
  expect(report.issues.map(issue=>issue.code)).toEqual(expect.arrayContaining(['negative_costs','commercial_rows']))
 })

 it.each([
  ['1.234,56',true],['1 234,56',true],['12 hrs',true],['1,200 ea',true],['$12O0',true],['N/A',true],['TBD',true],['-',true],['#VALUE!',true],['#REF!',true],
  ['$1,250.00',false],['(1,250.00)',false],['-$300',false],['1,200',false],['0',false],['0.00',false],
 ] as const)('strictly classifies numeric input %s',async(value,blocked)=>{
  const cell=value.includes(',')?`"${value}"`:value
  const {lines,report}=await parseEstimateFileWithReport(csv(`Description,Category,Cost,Hours\nWire,Materials,${cell},0`))
  expect(report.issues.some(issue=>issue.code==='invalid_numbers')).toBe(blocked)
  if(value==='$1,250.00')expect(lines[0]?.estimatedCost).toBe(1250)
  if(value==='(1,250.00)')expect(lines[0]?.estimatedCost).toBe(-1250)
  if(value==='-$300')expect(lines[0]?.estimatedCost).toBe(-300)
  if(value==='1,200')expect(lines[0]?.estimatedCost).toBe(1200)
  if(value==='0'||value==='0.00')expect(lines[0]?.estimatedCost).toBe(0)
 })

 it('requires review for a notable total discrepancy and never waives a material mismatch',async()=>{
  const notable=await parseEstimateFileWithReport(csv('Description,Category,Cost\nWire,Materials,84290\nGrand Total,,84315'))
  expect(()=>requireImportApproval(notable.report.issues,false)).toThrow('confirm')
  expect(()=>requireImportApproval(notable.report.issues,true)).not.toThrow()
  const material=await parseEstimateFileWithReport(csv('Description,Category,Cost\nWire,Materials,9999000\nGrand Total,,10000000'))
  expect(()=>requireImportApproval(material.report.issues,true)).toThrow('does not reconcile')
 })

 it.each(['Labor & Material Total','Division 26 Total','Phase 1 Total','Total Direct Cost','Direct Job Cost Total'])('excludes realistic %s rollups',async label=>{
  const {lines,report}=await parseEstimateFileWithReport(csv(`Description,Category,Cost,Hours\nLabor,Labor,100,10\nWire,Materials,100,0\n${label},,200,10`))
  expect(lines.reduce((sum,line)=>sum+line.estimatedCost,0)).toBe(200)
  expect(report.excludedRows).toContainEqual(expect.objectContaining({sourceRow:4,reason:'summary'}))
 })

 it.each(['Total Cost','Total Estimated Cost','Total Project Cost','Project Cost Total','Direct Job Cost Total','Total Direct Cost','Grand Total','Job Total'])('captures overall total %s without double-counting it',async label=>{
  const {lines,report}=await parseEstimateFileWithReport(csv(`Description,Category,Cost,Hours\nWire,Materials,100,0\n${label},,100,0`))
  expect(lines.map(line=>line.estimatedCost)).toEqual([100])
  expect(report.sourceReportedTotal).toBe(100)
  expect(report.totalReconciliation.state).toBe('matched')
 })

 it.each(['Total Station Rental','Total Station Power Feed','Install Total Lighting Control System','Subtotal Connector'])('preserves legitimate total-like detail %s',async label=>{
  const {lines,report}=await parseEstimateFileWithReport(csv(`Description,Category,Cost,Hours\n${label},Materials,100,0`))
  expect(lines).toHaveLength(1)
  expect(report.issues).not.toContainEqual(expect.objectContaining({code:'ambiguous_summary_row'}))
 })

 it('keeps a legitimate detail description containing total',async()=>{
  const {lines}=await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nTotal station rental,Equipment,100,0'))
  expect(lines).toHaveLength(1)
 })

 it('captures and reconciles a source-reported total with deterministic tolerances',async()=>{
  const acceptable=await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,84290,10\nGrand Total,,84315,10'))
  expect(acceptable.report.totalReconciliation).toMatchObject({sourceReportedTotal:84315,normalizedDetailTotal:84290,absoluteDifference:25,state:'needs_review'})
  const doubled=await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,84315,10\nWire,Materials,84315,0\nGrand Total,,84315,10'))
  expect(doubled.report.totalReconciliation).toMatchObject({sourceReportedTotal:84315,normalizedDetailTotal:168630,absoluteDifference:84315,state:'failed'})
  expect(doubled.report.issues).toContainEqual(expect.objectContaining({code:'source_total_mismatch',severity:'error'}))
 })

 it.each([
  [10000,1,'within_tolerance'],[84315,1,'within_tolerance'],[1000000,100,'needs_review'],[10000000,100,'needs_review'],
  [10000,10,'needs_review'],[84315,25,'needs_review'],[1000000,500,'failed'],[10000000,1000,'failed'],
 ] as const)('bounds reconciliation for source total %d and difference %d',async(source,difference,state)=>{
  const {report}=await parseEstimateFileWithReport(csv(`Description,Category,Cost\nWire,Materials,${source-difference}\nGrand Total,,${source}`))
  expect(report.totalReconciliation).toMatchObject({sourceReportedTotal:source,absoluteDifference:difference,state})
 })

 it('uses one resolved mapping for both preview and normalized lines',async()=>{
  const {lines,report}=await parseEstimateFileWithReport(csv('Description,Category,Amount,Cost,Hours\nWire,Materials,999,100,0'))
  expect(report.mappedColumns.cost).toBe('cost')
  expect(lines[0]?.estimatedCost).toBe(100)
  expect(report.issues).toContainEqual(expect.objectContaining({code:'ambiguous_mapping',severity:'error'}))
 })

 it('resolves only an explicitly selected ambiguous semantic column and records its identity',async()=>{
  const {lines,report}=await parseEstimateFileWithReport(csv('Description,Category,Amount,Cost,Hours\nWire,Materials,999,100,0'),{mapping:{cost:4}})
  expect(report.issues).not.toContainEqual(expect.objectContaining({code:'ambiguous_mapping'}))
  expect(report.mappedColumns.cost).toBe('cost')
  expect(report.mappedColumnIndexes?.cost).toBe(4)
  expect(lines[0]?.estimatedCost).toBe(100)
  expect(report.mappingOptions?.cost).toEqual([{header:'amount',column:3},{header:'cost',column:4}])
 })

 it('does not let generic review turn a missing actual category into zero',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10\nWire,Materials,500,0'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10'))).report
  const pair=assessImportPair(estimate,actual)
  expect(pair.completeness).toMatchObject({state:'incomplete',missingActualCategories:['materials']})
  expect(()=>requireImportApproval(pair.issues,true,{actualCompletenessConfirmed:true,allowIncompleteActuals:false})).toThrow('missing expected categories')
  expect(()=>requireImportApproval(pair.issues,true,{actualCompletenessConfirmed:true,allowIncompleteActuals:true})).not.toThrow()
 })

 it('requires a specific final-actuals confirmation even when categories are present',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10'))).report
  const pair=assessImportPair(estimate,actual)
  expect(()=>requireImportApproval(pair.issues,true)).toThrow('final and complete')
  expect(()=>requireImportApproval(pair.issues,true,{actualCompletenessConfirmed:true,allowIncompleteActuals:false})).not.toThrow()
  expect(()=>requireImportApproval(pair.issues,false,{actualCompletenessConfirmed:true,allowIncompleteActuals:false})).not.toThrow()
 })

 it('distinguishes an explicit actual zero from an absent actual category',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10\nWire,Materials,500,0'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10\nNo material charge,Materials,0,0'))).report
  const pair=assessImportPair(estimate,actual)
  expect(pair.completeness).toMatchObject({state:'complete',missingActualCategories:[],confirmedZeroCategories:['materials']})
 })

 it('does not erase a category whose estimate transactions net to zero',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Category,Cost,Hours\nMaterial package,Materials,500,0\nMaterial credit,Materials,-500,0'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Cost,Hours\nLabor,Labor,500,10'))).report
  expect(assessImportPair(estimate,actual).completeness).toMatchObject({state:'incomplete',missingActualCategories:['materials']})
 })

 it('compares cost-code and phase coverage when those dimensions are available',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Cost Code,Phase,Cost\nRough conduit,260100,ROUGH,500\nTrim devices,260200,TRIM,500'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Cost Code,Phase,Cost\nRough conduit,260100,ROUGH,550'))).report
  const pair=assessImportPair(estimate,actual)
  expect(pair.completeness).toMatchObject({
   state:'incomplete',missingActualCostCodes:['260200'],missingActualPhases:['TRIM'],
  })
  expect(()=>requireImportApproval(pair.issues,true,{actualCompletenessConfirmed:true})).toThrow('structural coverage')
  expect(()=>requireImportApproval(pair.issues,true,{allowIncompleteActuals:true})).not.toThrow()
 })

 it('compares division coverage independently of broad categories',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Division,Cost\nElectrical,26,500\nCommunications,27,500'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Division,Cost\nElectrical,26,550'))).report
  expect(assessImportPair(estimate,actual).completeness).toMatchObject({state:'incomplete',missingActualDivisions:['27'],divisionCoverage:'incomplete'})
 })

 it('marks structural coverage unavailable when the estimate has codes but actuals expose none',async()=>{
  const estimate=(await parseEstimateFileWithReport(csv('Description,Cost Code,Cost\nRough conduit,260100,500'))).report
  const actual=(await parseActualFileWithReport(csv('Description,Category,Cost\nRough conduit,Other,550'))).report
  expect(assessImportPair(estimate,actual).completeness).toMatchObject({state:'incomplete',costCodeCoverage:'unavailable'})
 })

 it('selects an obvious visible worksheet and reports other candidates',async()=>{
  const book=new ExcelJS.Workbook();book.addWorksheet('Cover').addRow(['Acme Electric']);const estimate=book.addWorksheet('Estimate');estimate.addRow(['Description','Category','Cost','Hours']);estimate.addRow(['Wire','Materials',100,0])
  const {report}=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'sheets.xlsx'))
  expect(report.sheetName).toBe('Estimate')
  expect(report.worksheets.map(sheet=>sheet.name)).toEqual(['Cover','Estimate'])
 })

 it('ignores an empty first worksheet when one later visible estimate sheet is usable',async()=>{
  const book=new ExcelJS.Workbook();book.addWorksheet('Empty');const estimate=book.addWorksheet('Estimate');estimate.addRow(['Description','Cost']);estimate.addRow(['Wire',100])
  const {report}=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'empty-first.xlsx'))
  expect(report.sheetName).toBe('Estimate')
 })

 it.each([['summary and detail',['Summary','Detail']],['equal candidates',['Estimate','Alternates']]] as const)('blocks ambiguous %s worksheets',async(_name,names)=>{
  const book=new ExcelJS.Workbook();for(const name of names){const sheet=book.addWorksheet(name);sheet.addRow(['Description','Category','Cost','Hours']);sheet.addRow([name,'Materials',name==='Summary'?500:100,0])}
  const {lines,report}=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'ambiguous.xlsx'))
  expect(lines).toEqual([])
  expect(report.issues).toContainEqual(expect.objectContaining({code:'worksheet_ambiguous',severity:'error'}))
 })

 it('never auto-selects a hidden worksheet over a visible candidate',async()=>{
  const book=new ExcelJS.Workbook();const visible=book.addWorksheet('Visible');visible.addRow(['Description','Cost']);visible.addRow(['Wire',100]);const hidden=book.addWorksheet('Hidden');hidden.state='hidden';hidden.addRow(['Description','Category','Cost','Hours']);hidden.addRow(['Hidden total','Materials',900,1])
  const {report}=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'hidden.xlsx'))
  expect(report.sheetName).toBe('Visible')
 })

 it.each([1,2])('blocks a workbook containing %i hidden plausible worksheet(s) and no visible candidate',async count=>{
  const book=new ExcelJS.Workbook()
  for(let index=0;index<count;index+=1){const sheet=book.addWorksheet(`Hidden ${index+1}`);sheet.state='hidden';sheet.addRow(['Description','Category','Cost']);sheet.addRow(['Wire','Materials',100])}
  const {lines,report}=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'hidden-only.xlsx'))
  expect(lines).toEqual([])
  expect(report.sheetName).toBe('')
  expect(report.issues).toContainEqual(expect.objectContaining({code:'worksheet_not_usable',severity:'error'}))
 })

 it('blocks a hidden estimate when the only visible sheet is a cover',async()=>{
  const book=new ExcelJS.Workbook();book.addWorksheet('Cover').addRow(['Acme Electric']);const hidden=book.addWorksheet('Estimate');hidden.state='hidden';hidden.addRow(['Description','Category','Cost']);hidden.addRow(['Wire','Materials',100])
  const {lines,report}=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'hidden-and-cover.xlsx'))
  expect(lines).toEqual([])
  expect(report.issues).toContainEqual(expect.objectContaining({code:'worksheet_not_usable',severity:'error'}))
 })

 it('blocks actuals split across multiple plausible worksheets',async()=>{
  const book=new ExcelJS.Workbook();for(const [name,cost] of [['Labor actuals',400],['Material actuals',600]] as const){const sheet=book.addWorksheet(name);sheet.addRow(['Description','Category','Cost','Hours']);sheet.addRow([name,name.startsWith('Labor')?'Labor':'Materials',cost,1])}
  const {report}=await parseActualFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'split.xlsx'))
  expect(report.issues).toContainEqual(expect.objectContaining({code:'worksheet_ambiguous',severity:'error'}))
 })

 it('uses an explicitly selected visible estimate worksheet and binds provenance to it',async()=>{
  const book=new ExcelJS.Workbook();for(const [name,cost] of [['Summary',999],['Bid Detail',100]] as const){const sheet=book.addWorksheet(name);sheet.addRow(['Description','Category','Cost']);sheet.addRow(['Wire','Materials',cost])}
  const file=new File([new Uint8Array(await book.xlsx.writeBuffer())],'choice.xlsx')
  const result=await parseEstimateFileWithReport(file,{worksheet:'Bid Detail'})
  expect(result.report.sheetName).toBe('Bid Detail')
  expect(result.lines[0]?.estimatedCost).toBe(100)
  expect(result.provenance[0]).toMatchObject({lineId:result.lines[0]?.id,worksheet:'Bid Detail',sourceRow:2,parserVersion:'2026-09-p1-v2',mapping:{cost:'cost'},originalValues:{cost:'100'}})
 })

 it('does not permit explicit hidden-sheet selection',async()=>{
  const book=new ExcelJS.Workbook();const hidden=book.addWorksheet('Hidden Bid');hidden.state='hidden';hidden.addRow(['Description','Cost']);hidden.addRow(['Wire',100])
  const result=await parseEstimateFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'hidden.xlsx'),{worksheet:'Hidden Bid'})
  expect(result.lines).toEqual([])
  expect(result.report.issues).toContainEqual(expect.objectContaining({code:'worksheet_selection_invalid',severity:'error'}))
 })

 it('refuses selecting one sheet when actuals appear split across sheets',async()=>{
  const book=new ExcelJS.Workbook();for(const [name,category] of [['Labor actuals','Labor'],['Material actuals','Materials']] as const){const sheet=book.addWorksheet(name);sheet.addRow(['Description','Category','Cost']);sheet.addRow([name,category,100])}
  const result=await parseActualFileWithReport(new File([new Uint8Array(await book.xlsx.writeBuffer())],'split.xlsx'),{worksheet:'Labor actuals'})
  expect(result.lines).toEqual([])
  expect(result.report.issues).toContainEqual(expect.objectContaining({code:'multi_sheet_actuals_unsupported',severity:'error'}))
 })

 it('preserves actual quantity, unit, normalized unit, and rate without inventing unknown-unit normalization',async()=>{
  const result=await parseActualFileWithReport(csv('Description,Category,Quantity,UOM,Unit Cost,Actual Cost\nConduit,Materials,100,lf,2.5,250\nCustom assembly,Materials,2,spool,50,100'))
  expect(result.lines).toEqual([
   expect.objectContaining({quantity:100,unit:'lf',normalizedUnit:'LF',unitCost:2.5,actualCost:250}),
   expect.objectContaining({quantity:2,unit:'spool',normalizedUnit:undefined,unitCost:50,actualCost:100}),
  ])
 })

 it('accepts UTF-8 BOM but rejects invalid UTF-8 bytes explicitly',async()=>{
  const bom=await parseEstimateFile(new File([new Uint8Array([0xef,0xbb,0xbf]),'Description,Cost\nWire,100'],'bom.csv',{type:'text/csv'}))
  expect(bom[0]?.estimatedCost).toBe(100)
  await expect(parseEstimateFileWithReport(new File([new Uint8Array([0xff,0xfe,0x41,0x00])],'utf16.csv',{type:'text/csv'}))).rejects.toThrow('valid UTF-8')
 })
 it('rejects an explicitly encoded Unicode replacement character in CSV input',async()=>{
  const csv='Description,Category,Cost\nFeeder � cable,Materials,100\n'
  await expect(parseEstimateFileWithReport(new File([csv],'replacement.csv',{type:'text/csv'}))).rejects.toThrow('replacement character')
 })

 it('rejects overlong CSV fields before normalization',async()=>{
  const value='x'.repeat(IMPORT_RESOURCE_LIMITS.cellCharacters+1)
  await expect(parseEstimateFileWithReport(csv(`Description,Cost\n${value},100`))).rejects.toThrow('too long')
 })

 it('documents cached formula reliance and blocks unusable formula results',async()=>{
  const cached=new ExcelJS.Workbook();const sheet=cached.addWorksheet('Costs');sheet.addRow(['Description','Category','Cost','Hours']);sheet.addRow(['Wire','Materials',{formula:'2*50',result:100},0])
  const result=await parseEstimateFileWithReport(new File([new Uint8Array(await cached.xlsx.writeBuffer())],'formula.xlsx'))
  expect(result.lines[0]?.estimatedCost).toBe(100)
  expect(result.report.issues).toContainEqual(expect.objectContaining({code:'formula_cached_value',severity:'warning'}))
  const missing=new ExcelJS.Workbook();const missingSheet=missing.addWorksheet('Costs');missingSheet.addRow(['Description','Cost']);missingSheet.addRow(['Wire',{formula:'2*50'}])
  const blocked=await parseEstimateFileWithReport(new File([new Uint8Array(await missing.xlsx.writeBuffer())],'formula-missing.xlsx'))
  expect(blocked.report.issues).toContainEqual(expect.objectContaining({code:'invalid_numbers',severity:'error'}))
  const nonnumeric=new ExcelJS.Workbook();const nonnumericSheet=nonnumeric.addWorksheet('Costs');nonnumericSheet.addRow(['Description','Cost']);nonnumericSheet.addRow(['Wire',{formula:'"TBD"',result:'TBD'}])
  const nonnumericResult=await parseEstimateFileWithReport(new File([new Uint8Array(await nonnumeric.xlsx.writeBuffer())],'formula-text.xlsx'))
  expect(nonnumericResult.report.issues).toContainEqual(expect.objectContaining({code:'invalid_numbers',severity:'error'}))
 })
})
