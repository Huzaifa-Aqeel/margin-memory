export type EvidenceStrength = 'insufficient' | 'limited' | 'moderate' | 'strong'

export type EvidenceBasis = {
  strength: EvidenceStrength
  label: string
  sampleSize: number
  comparableJobCount: number
  missingDataCount: number
  explanation: string
}

/**
 * This is a communication label, not a probability of correctness.
 * The thresholds are deliberately conservative until pilot data can support
 * calibrated accuracy estimates.
 */
export function classifyEvidence(input: {
  sampleSize: number
  comparableJobCount: number
  missingDataCount?: number
  scopeReconciled?: boolean
}): EvidenceBasis {
  const sampleSize = Math.max(0, Math.floor(input.sampleSize))
  const comparableJobCount = Math.max(0, Math.floor(input.comparableJobCount))
  const missingDataCount = Math.max(0, Math.floor(input.missingDataCount ?? Math.max(0, comparableJobCount - sampleSize)))
  const scopeReconciled = input.scopeReconciled !== false
  let strength: EvidenceStrength
  if (!scopeReconciled || sampleSize < 2) strength = 'insufficient'
  else if (sampleSize < 5 || missingDataCount > 0) strength = 'limited'
  else if (sampleSize < 10) strength = 'moderate'
  else strength = 'strong'
  const label = strength[0].toUpperCase() + strength.slice(1)
  const scopeText = scopeReconciled ? 'scope reconciled' : 'scope not reconciled'
  const dataText = missingDataCount ? `${missingDataCount} comparable job${missingDataCount === 1 ? '' : 's'} lacked usable category data` : 'all comparable jobs had usable category data'
  return { strength, label, sampleSize, comparableJobCount, missingDataCount, explanation: `${sampleSize} usable comparison${sampleSize === 1 ? '' : 's'} from ${comparableJobCount} comparable job${comparableJobCount === 1 ? '' : 's'}; ${scopeText}; ${dataText}.` }
}

export function evidenceDisclaimer(): string {
  return 'Evidence strength is a transparency label, not a calibrated probability or proof of cause.'
}
