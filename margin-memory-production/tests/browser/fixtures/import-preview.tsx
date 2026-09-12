import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ImportPreviewSummary, type PreviewResult } from '../../../src/components/import-preview'

const report = {
  kind: 'estimate' as const, fileName: 'contractor-estimate.csv', sheetName: 'CSV', headerRow: 3,
  worksheets:[{name:'CSV',hidden:false,plausible:true,selected:true,headerRow:3,score:4}],worksheetSelectionRationale:'The file contains one worksheet.',
  headers: ['cost type','item description','budget amount'], mappedColumns: { category: 'cost type', description: 'item description', cost: 'budget amount' },
  mappingCandidates:{category:['cost type (column 1)'],description:['item description (column 2)'],cost:['budget amount (column 3)']},
  sourceRows: 4, importedRows: 3, skippedSummaryRows: 1, skippedEmptyRows: 0, invalidNumericCells: 0,
  excludedRows:[{sourceRow:7,reason:'summary' as const,description:'Grand Total'}],malformedCells:[],
  categoryCounts: { labor: 1, materials: 1, equipment: 0, subcontractor: 0, permit: 0, other: 1 },
  categoryTotals:{labor:{cost:1000,hours:0},materials:{cost:400,hours:0},equipment:{cost:0,hours:0},subcontractor:{cost:0,hours:0},permit:{cost:0,hours:0},other:{cost:100,hours:0}},
  totalCost: 1500, totalHours: 0,sourceReportedTotal:1500,normalizedDetailTotal:1500,totalReconciliation:{state:'matched' as const,sourceReportedTotal:1500,normalizedDetailTotal:1500,absoluteDifference:0,percentageDifference:0,absoluteTolerance:1,percentageTolerance:.0001,absoluteToleranceCap:10,roundingTolerance:1,reviewTolerance:1.5},laborHourCoverage:'absent' as const,structuredDimensions:{costCodes:[],phases:[],divisions:[]},issues: [],
}
const review={id:'11111111-1111-4111-8111-111111111111',reportHash:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}
const warning: PreviewResult = { reports: [report], issues: [{severity:'warning',code:'hours_missing',message:'No estimated labor-hours column was detected. Labor productivity cannot be evaluated.'}], requiresReview: true, canImport: true,review }
const blocked: PreviewResult = { reports: [{...report,invalidNumericCells:1}], issues: [{severity:'error',code:'invalid_numbers',message:'1 mapped numeric cell could not be interpreted.'}], requiresReview: true, canImport: false }
const completeActual: PreviewResult = {reports:[report,{...report,kind:'actual' as const,fileName:'contractor-actual.csv'}],issues:[{severity:'warning',code:'actual_completeness_confirmation',resolution:'actual_completeness',message:'Confirm this is the final and complete actual-cost export, including all cost categories and posted transactions.'}],completeness:{state:'complete',missingActualCategories:[],confirmedZeroCategories:[],missingActualCostCodes:[],missingActualPhases:[],missingActualDivisions:[],costCodeCoverage:'not_applicable',phaseCoverage:'not_applicable',divisionCoverage:'not_applicable',requiresExplicitConfirmation:true},requiresReview:true,requiresActualCompletenessConfirmation:true,canImport:true,review}
const incompleteActual: PreviewResult = {...completeActual,requiresActualCompletenessConfirmation:false,issues:[{severity:'warning',code:'incomplete_actual_structure',resolution:'incomplete_actuals',message:'Actual structural coverage is incomplete.'}],completeness:{...completeActual.completeness!,state:'incomplete',missingActualCostCodes:['260200'],missingActualPhases:['TRIM'],costCodeCoverage:'incomplete',phaseCoverage:'incomplete'}}
function Fixture(){const[ready,setReady]=useState(false);const[mode,setMode]=useState<'warning'|'blocked'|'completeActual'|'incompleteActual'>('warning');const preview=mode==='warning'?warning:mode==='blocked'?blocked:mode==='completeActual'?completeActual:incompleteActual;return <><button onClick={()=>setMode('warning')}>Usable preview</button><button onClick={()=>setMode('blocked')}>Blocked preview</button><button onClick={()=>setMode('completeActual')}>Complete actual preview</button><button onClick={()=>setMode('incompleteActual')}>Incomplete actual preview</button><ImportPreviewSummary preview={preview} onReady={setReady}/><output aria-label="Import readiness">{ready?'ready':'not ready'}</output></>}
createRoot(document.getElementById('root')!).render(<Fixture/>)
