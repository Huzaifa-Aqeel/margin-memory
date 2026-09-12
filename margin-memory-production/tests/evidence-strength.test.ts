import { expect, it } from 'vitest'
import { classifyEvidence, evidenceDisclaimer } from '../src/lib/domain/evidence-strength'

it.each([
  [{ sampleSize: 0, comparableJobCount: 0 }, 'insufficient'],
  [{ sampleSize: 1, comparableJobCount: 1 }, 'insufficient'],
  [{ sampleSize: 3, comparableJobCount: 3 }, 'limited'],
  [{ sampleSize: 5, comparableJobCount: 5 }, 'moderate'],
  [{ sampleSize: 12, comparableJobCount: 12 }, 'strong'],
  [{ sampleSize: 12, comparableJobCount: 15, missingDataCount: 3 }, 'limited'],
  [{ sampleSize: 12, comparableJobCount: 12, scopeReconciled: false }, 'insufficient'],
] as const)('classifies evidence transparently without implying probability: %j', (input, strength) => {
  const result = classifyEvidence(input)
  expect(result.strength).toBe(strength)
  expect(result.explanation).toContain(`${input.sampleSize} usable comparison`)
  expect(result.explanation).not.toMatch(/confidence|probability|accuracy/i)
})

it('states that evidence strength is a communication label', () => {
  expect(evidenceDisclaimer()).toMatch(/not a calibrated probability/)
})
