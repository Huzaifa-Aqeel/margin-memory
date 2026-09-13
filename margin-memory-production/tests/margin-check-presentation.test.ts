import { describe, expect, it } from 'vitest'
import { MIN_WARNING_EFFECTIVENESS_SAMPLE, presentMarginCheck, presentWarningEffectiveness } from '../src/lib/domain/margin-check-presentation'
import type { InvestigationStatus } from '../src/lib/domain/types'

const present = (investigationStatus: InvestigationStatus, findingCount = 0, openFindingCount = findingCount, unansweredQuestionCount = 0) =>
  presentMarginCheck({ investigationStatus, findingCount, openFindingCount, unansweredQuestionCount })

describe('professional Margin Check state presentation', () => {
  it('does not present queued work as a zero-finding success', () => {
    const result = present('queued')
    expect(result.state).toBe('queued')
    expect(result.title).toContain('waiting to run')
    expect(result.title).not.toContain('No material')
  })

  it('presents an active review as running', () => {
    expect(present('investigating')).toMatchObject({ state: 'investigating', title: 'Running Margin Check…' })
  })

  it('presents a persisted question as information required', () => {
    expect(present('needs_input', 0, 0, 1)).toMatchObject({ state: 'needs_input', label: 'Needs information' })
  })

  it('fails closed when the review failed', () => {
    const result = present('failed')
    expect(result.state).toBe('failed')
    expect(result.description).toContain('has not been cleared')
    expect(result.title).not.toContain('No material')
  })

  it('presents completed findings and preserves addressed finding history', () => {
    expect(present('completed', 2, 2)).toMatchObject({ state: 'findings', title: '2 items deserve review.' })
    expect(present('completed', 2, 0)).toMatchObject({ state: 'findings', title: 'All Margin Check findings have been addressed.' })
  })

  it('only presents zero findings after a completed review with no findings', () => {
    expect(present('completed')).toMatchObject({ state: 'no_findings', title: 'No material historical risks found.' })
  })
})

describe('warning effectiveness restraint', () => {
  it('does not show a percentage below the strong evidence sample threshold', () => {
    expect(MIN_WARNING_EFFECTIVENESS_SAMPLE).toBe(10)
    expect(presentWarningEffectiveness({ evaluable: 3, hitRate: 1 })).toMatchObject({ ready: false, value: '3 reviewed' })
  })

  it('shows an observed percentage once ten reviewed outcomes exist', () => {
    expect(presentWarningEffectiveness({ evaluable: 10, hitRate: 0.6 })).toMatchObject({ ready: true, value: '60%' })
  })

  it('does not imply a pattern when reviewed outcomes have no evaluable rate', () => {
    expect(presentWarningEffectiveness({ evaluable: 10, hitRate: null })).toMatchObject({ ready: false, value: '10 reviewed', note: 'No evaluable warning pattern is available yet' })
  })
})
