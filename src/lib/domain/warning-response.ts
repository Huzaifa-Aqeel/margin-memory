import { z } from 'zod'
import type { FindingOutcomeVerdict } from './types'

export const responseKinds = ['mitigation_planned', 'mitigation_completed', 'verified', 'accepted_risk', 'dismissed'] as const
export const responseLabels: Record<typeof responseKinds[number], string> = {
  mitigation_planned: 'Mitigation planned', mitigation_completed: 'Mitigation completed',
  verified: 'Condition verified', accepted_risk: 'Risk accepted', dismissed: 'Warning dismissed',
}
export const warningResponseSchema = z.strictObject({
  kind: z.enum(responseKinds), note: z.string().trim().min(1).max(4000),
  revisionReference: z.string().trim().max(500),
})
export const responseRequestSchema = z.strictObject({
  responseId: z.string().uuid(), response: warningResponseSchema,
  status: z.enum(['resolved', 'dismissed']).optional(),
}).refine(value => !value.status || (value.status === 'dismissed' ? value.response.kind === 'dismissed' : value.response.kind !== 'dismissed'), 'Response must match the finding decision.')
export const findingDecisionSchema = z.union([
  z.strictObject({status:z.literal('open')}),
  responseRequestSchema.refine(value=>!!value.status,'A finding decision is required.'),
])
export type WarningResponseInput = z.infer<typeof warningResponseSchema>
export type WarningResponse = WarningResponseInput & { id: string; findingId: string; recordedAt: string; recordedStage: string; recordedBy: string }

export const conditionLabels = { occurred: 'Occurred', partially_observed: 'Partly observed', not_observed: 'Not observed', unknown: 'Cannot determine' } as const
export const mitigationLabels = { helped: 'Helped, based on my review', not_helped: 'Did not help', unknown: 'Effect is uncertain', not_attempted: 'No mitigation was carried out' } as const
export const outcomeAssessmentSchema = z.strictObject({
  condition: z.enum(['occurred', 'partially_observed', 'not_observed', 'unknown']),
  mitigation: z.enum(['helped', 'not_helped', 'unknown', 'not_attempted']),
  responseId: z.string().uuid().nullable(),
  note: z.string().trim().min(1).max(4000),
}).superRefine((value, context) => {
  if (['helped', 'not_helped'].includes(value.mitigation) && !value.responseId) context.addIssue({ code: 'custom', message: 'Select the completed mitigation response.', path: ['responseId'] })
  if (value.mitigation === 'not_attempted' && value.responseId) context.addIssue({ code: 'custom', message: 'An unattempted mitigation cannot reference a completed response.', path: ['responseId'] })
  if (value.mitigation === 'helped' && value.condition === 'unknown') context.addIssue({ code: 'custom', message: 'Explain whether the condition occurred or was prevented before judging mitigation helpful.', path: ['condition'] })
})
export type OutcomeAssessment = z.infer<typeof outcomeAssessmentSchema>

/** Human review categories, not a model probability or a claim of causal savings. */
export function assessmentVerdict(input: OutcomeAssessment): FindingOutcomeVerdict {
  const assessment = outcomeAssessmentSchema.parse(input)
  if (assessment.mitigation === 'helped') return 'mitigated'
  if (assessment.mitigation === 'unknown' || assessment.condition === 'unknown') return 'not_evaluable'
  return { occurred: 'validated', partially_observed: 'partially_validated', not_observed: 'not_observed' }[assessment.condition] as FindingOutcomeVerdict
}

export function validateAssessment(input: unknown, responses: WarningResponse[]) {
  const assessment = outcomeAssessmentSchema.parse(input)
  const completed = responses.filter(response => response.kind === 'mitigation_completed')
  if (assessment.responseId && !completed.some(response => response.id === assessment.responseId)) throw new Error('Select a completed mitigation for this warning.')
  if (completed.length && assessment.mitigation === 'not_attempted') throw new Error('A completed mitigation was recorded. Review its effect, or choose uncertain.')
  return assessment
}
