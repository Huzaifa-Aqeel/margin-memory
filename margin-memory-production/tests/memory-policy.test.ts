import {expect,it} from 'vitest'
import {assessProfessionalComparability,canonicalJobMemoryContent,isJobEligibleForTrustedMemory,isLessonEligibleForTrustedMemory,jobMemoryExclusionReasons,memoryContentHash} from '../src/lib/domain/memory-policy'
import {seedStore} from '../src/lib/seed'

const trusted=()=>structuredClone(seedStore.jobs[0])
it('fails closed for every non-authoritative job class',()=>{
 const job=trusted();expect(isJobEligibleForTrustedMemory(job)).toBe(true)
 for(const change of [
  {estimateBaselineRole:'historical_unknown' as const},
  {estimateBaselineRole:undefined},
  {dataOrigin:'demo' as const},
  {dataOrigin:'synthetic_test' as const},
  {memoryStatus:'quarantined' as const},
  {scopeReview:{status:'unreconciled' as const,changes:[],actualCompleteness:'unknown' as const}},
 ])expect(isJobEligibleForTrustedMemory({...job,...change})).toBe(false)
 expect(jobMemoryExclusionReasons({...job,estimateBaselineRole:'historical_unknown',dataOrigin:'demo'})).toEqual(['authoritative_baseline_unknown','non_production_origin'])
})
it('trusts only confirmed lessons whose source job is eligible',()=>{
 const lesson=seedStore.lessons[0],job=trusted()
 expect(isLessonEligibleForTrustedMemory(lesson,job)).toBe(true)
 expect(isLessonEligibleForTrustedMemory({...lesson,status:'pending'},job)).toBe(false)
 expect(isLessonEligibleForTrustedMemory(lesson,{...job,dataOrigin:'demo'})).toBe(false)
})
it('creates versioned, stable, privacy-minimized job content',()=>{
 const job=trusted();job.name='Jane Smith personal project';job.location='12 Private Street';job.notes='Contact jane@example.com. Occupied access required after hours.'
 const text=canonicalJobMemoryContent(job)
 expect(text).toContain('Version: job-memory-v2');expect(text).toContain('Occupied access required')
 expect(text).not.toContain(job.name);expect(text).not.toContain(job.location);expect(text).not.toContain('jane@example.com')
 expect(memoryContentHash(text)).toMatch(/^[0-9a-f]{64}$/)
})
it('rejects high text similarity when professional structure is wrong',()=>{
 const estimate=structuredClone(seedStore.estimates[0]),good=trusted(),warehouse=structuredClone(seedStore.jobs.find(job=>job.projectType.includes('Warehouse'))!)
 expect(assessProfessionalComparability(good,estimate).eligible).toBe(true)
 expect(assessProfessionalComparability(warehouse,estimate)).toMatchObject({eligible:false,rejected:expect.arrayContaining(['project_class_mismatch'])})
 expect(assessProfessionalComparability({...good,estimateBaselineRole:'historical_unknown'},estimate).eligible).toBe(false)
})
