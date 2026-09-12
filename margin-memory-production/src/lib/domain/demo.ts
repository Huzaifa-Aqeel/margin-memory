import type {Job} from './types'

export const isDemoOrigin=(value:{dataOrigin?:'production'|'demo'|'synthetic_test'})=>value.dataOrigin==='demo'||value.dataOrigin==='synthetic_test'
export function jobHistoryBadges(job:Pick<Job,'dataOrigin'|'sourceEstimateId'>){return{origin:isDemoOrigin(job)?'Demo':null,source:job.sourceEstimateId?'closed loop':'legacy'}}
