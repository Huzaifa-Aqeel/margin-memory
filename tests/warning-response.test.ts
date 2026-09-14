import { expect, it } from 'vitest'
import { assessmentVerdict, findingDecisionSchema, outcomeAssessmentSchema, responseRequestSchema, validateAssessment, warningResponseSchema, type OutcomeAssessment, type WarningResponse } from '../src/lib/domain/warning-response'
import { evaluateFindingOutcomes } from '../src/lib/closeout'
import type { Estimate } from '../src/lib/domain/types'
import { seedStore } from '../src/lib/seed'
import { calculateVariances } from '../src/lib/domain/analytics'

const response:WarningResponse={id:crypto.randomUUID(),findingId:'finding',kind:'mitigation_completed',note:'Booked the shutdown and crew before work.',revisionReference:'Workbook R2',recordedAt:'2026-01-01T12:00:00Z',recordedStage:'won',recordedBy:crypto.randomUUID()}
const input={kind:response.kind,note:response.note,revisionReference:response.revisionReference}
const assessment:OutcomeAssessment={condition:'not_observed',mitigation:'helped',responseId:response.id,note:'Shutdown confirmation avoided occupied-hours work; checked the field log.'}
it('normalizes a human response without allowing client attribution or arithmetic fields',()=>{
 expect(warningResponseSchema.parse({...input,note:'  Checked access  '})).toEqual({...input,note:'Checked access'})
 for(const extra of [{recordedAt:response.recordedAt},{recordedBy:response.recordedBy},{savedCost:1000}])expect(()=>warningResponseSchema.parse({...input,...extra})).toThrow()
})
it.each([{note:' '},{note:'x'.repeat(4001)},{revisionReference:'x'.repeat(501)},{kind:'resolved'},{note:10}])('rejects malformed response %j',change=>expect(()=>warningResponseSchema.parse({...input,...change})).toThrow())
it('requires an attributable decision for resolved/dismissed but preserves reopen',()=>{
 expect(findingDecisionSchema.parse({status:'open'})).toEqual({status:'open'})
 expect(()=>findingDecisionSchema.parse({status:'resolved'})).toThrow()
 expect(()=>findingDecisionSchema.parse({responseId:response.id,response:input})).toThrow()
 expect(responseRequestSchema.parse({responseId:response.id,response:input,status:'resolved'}).status).toBe('resolved')
 expect(()=>responseRequestSchema.parse({responseId:response.id,response:input,status:'dismissed'})).toThrow()
 expect(()=>responseRequestSchema.parse({responseId:response.id,response:{...input,kind:'dismissed'},status:'resolved'})).toThrow()
})
it.each([
 ['occurred','not_attempted','validated'],['partially_observed','not_attempted','partially_validated'],['not_observed','not_attempted','not_observed'],['unknown','not_attempted','not_evaluable'],
 ['occurred','helped','mitigated'],['not_observed','helped','mitigated'],['partially_observed','helped','mitigated'],
 ['occurred','not_helped','validated'],['not_observed','not_helped','not_observed'],['unknown','not_helped','not_evaluable'],
 ['occurred','unknown','not_evaluable'],['not_observed','unknown','not_evaluable'],
] as const)('maps human condition %s and response %s to %s',(condition,mitigation,verdict)=>{
 const a=outcomeAssessmentSchema.parse({...assessment,condition,mitigation,responseId:mitigation==='not_attempted'?null:response.id})
 expect(assessmentVerdict(a)).toBe(verdict)
})
it('requires matching completed evidence before claiming a mitigation helped',()=>{
 expect(validateAssessment(assessment,[response])).toEqual(assessment)
 for(const responses of [[],[{...response,id:crypto.randomUUID()}],[{...response,kind:'mitigation_planned' as const}]])expect(()=>validateAssessment(assessment,responses)).toThrow('completed')
 expect(()=>validateAssessment({...assessment,responseId:null},[response])).toThrow('completed')
 expect(()=>validateAssessment({...assessment,mitigation:'not_attempted',responseId:null},[response])).toThrow('recorded')
 expect(()=>validateAssessment({...assessment,condition:'unknown'},[response])).toThrow('condition')
 expect(()=>validateAssessment({...assessment,note:' '},[response])).toThrow()
 expect(()=>validateAssessment({...assessment,verdict:'validated'},[response])).toThrow()
})
it.each([100,140])('keeps numerical variance visible but automatic mitigation attribution inconclusive at actual cost %i',actualCost=>{
 const estimateLines=[{id:'e',category:'labor' as const,description:'Labor',estimatedCost:100,estimatedHours:10}]
 const actualLines=[{id:'a',category:'labor' as const,description:'Labor',actualCost,actualHours:actualCost/10}]
 const job={...seedStore.jobs[0],notes:'',estimateLines,actualLines,variances:calculateVariances(estimateLines,actualLines),scopeReview:{status:'no_changes' as const,changes:[],actualCompleteness:'confirmed_complete' as const}}
 const finding={...seedStore.estimates[0].findings[0],id:response.findingId,category:'labor' as const,responses:[response]}
 const estimate:Estimate={...seedStore.estimates[0],findings:[finding],submittedFindingIds:[finding.id]}
 const before=structuredClone(estimate)
 expect(evaluateFindingOutcomes(estimate,job)[0]).toMatchObject({systemVerdict:'not_evaluable',confidence:0,evidenceSummary:`Cost variance +${actualCost-100}%; labor-hour variance +${actualCost-100}%.`})
 expect(estimate).toEqual(before)
 finding.responses=[{...response,kind:'mitigation_planned'}]
 expect(evaluateFindingOutcomes(estimate,job)[0].systemVerdict).toBe(actualCost===100?'not_observed':'validated')
 delete estimate.findings[0].responses
 expect(evaluateFindingOutcomes(estimate,job)[0].systemVerdict).toBe(actualCost===100?'not_observed':'validated')
})
