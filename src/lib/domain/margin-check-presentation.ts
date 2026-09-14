import type { InvestigationStatus } from './types'

export type MarginCheckPresentationState =
  | 'queued'
  | 'investigating'
  | 'needs_input'
  | 'failed'
  | 'findings'
  | 'no_findings'

export type MarginCheckPresentation = {
  state: MarginCheckPresentationState
  label: string
  title: string
  description: string
  tone: 'neutral' | 'pending' | 'medium' | 'high' | 'confirmed'
}

export function presentMarginCheck(input: {
  investigationStatus: InvestigationStatus
  findingCount: number
  openFindingCount?: number
  unansweredQuestionCount?: number
}): MarginCheckPresentation {
  const findingCount = Math.max(0, input.findingCount)
  const openFindingCount = Math.max(0, input.openFindingCount ?? findingCount)
  const unansweredQuestionCount = Math.max(0, input.unansweredQuestionCount ?? 0)

  if (input.investigationStatus === 'failed') {
    return {
      state: 'failed',
      label: 'Could not complete',
      title: 'Margin Check could not complete.',
      description: 'Your estimate has not been cleared. Retry the review before marking it complete.',
      tone: 'high',
    }
  }
  if (input.investigationStatus === 'needs_input' || unansweredQuestionCount > 0) {
    return {
      state: 'needs_input',
      label: 'Needs information',
      title: 'One or more details need your review.',
      description: 'Answer the open questions so Margin Check can finish reviewing this estimate.',
      tone: 'medium',
    }
  }
  if (input.investigationStatus === 'investigating') {
    return {
      state: 'investigating',
      label: 'Review running',
      title: 'Running Margin Check…',
      description: 'Checking the estimate against verified company history and recorded calculations.',
      tone: 'pending',
    }
  }
  if (input.investigationStatus === 'queued') {
    return {
      state: 'queued',
      label: 'Waiting to run',
      title: 'Margin Check is waiting to run.',
      description: 'The estimate has not been cleared. The review will begin when processing is available.',
      tone: 'neutral',
    }
  }
  if (findingCount > 0) {
    return openFindingCount > 0 ? {
      state: 'findings',
      label: `${openFindingCount} open`,
      title: `${openFindingCount} ${openFindingCount === 1 ? 'item deserves' : 'items deserve'} review.`,
      description: 'Review the evidence and record your decision before marking the estimate reviewed.',
      tone: 'medium',
    } : {
      state: 'findings',
      label: 'Findings addressed',
      title: 'All Margin Check findings have been addressed.',
      description: `${findingCount} ${findingCount === 1 ? 'finding remains' : 'findings remain'} in the review history below.`,
      tone: 'confirmed',
    }
  }
  return {
    state: 'no_findings',
    label: 'Review complete',
    title: 'No material historical risks found.',
    description: 'Margin Check completed without finding a company-history issue that deserves escalation.',
    tone: 'confirmed',
  }
}

export const MIN_WARNING_EFFECTIVENESS_SAMPLE = 10

export function presentWarningEffectiveness(input: { evaluable: number; hitRate: number | null }) {
  if (input.evaluable < MIN_WARNING_EFFECTIVENESS_SAMPLE) {
    return { ready: false, value: `${input.evaluable} reviewed`, note: `Not enough reviewed outcomes to show a pattern · ${MIN_WARNING_EFFECTIVENESS_SAMPLE} required` }
  }
  if (input.hitRate === null) {
    return { ready: false, value: `${input.evaluable} reviewed`, note: 'No evaluable warning pattern is available yet' }
  }
  return { ready: true, value: `${Math.round(input.hitRate * 100)}%`, note: `${input.evaluable} reviewed outcomes · observed result, not calibrated accuracy` }
}
