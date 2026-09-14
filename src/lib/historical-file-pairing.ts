export type HistoricalFileDescriptor = { name: string }
export type HistoricalFilePairProposal = {
  estimateIndex: number
  actualIndex?: number
  score: number
  confidence: 'confident' | 'unmatched'
}

const ignored = new Set(['estimate', 'estimated', 'bid', 'budget', 'actual', 'actuals', 'final', 'submitted', 'original', 'job', 'cost', 'costs', 'report', 'export', 'detail', 'summary', 'xlsx', 'csv'])

function tokens(name: string) {
  return [...new Set(name
    .replace(/^.*[\\/]/, '')
    .replace(/\.(?:xlsx|csv)$/i, '')
    .replace(/20\d{2}[-_.](?:0?[1-9]|1[0-2])[-_.](?:0?[1-9]|[12]\d|3[01])/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2 && !ignored.has(token) && !/^20\d{2}$/.test(token)))]
}

export function historicalFilePairScore(estimateName: string, actualName: string) {
  const estimate = tokens(estimateName), actual = tokens(actualName)
  if (!estimate.length || !actual.length) return 0
  const actualSet = new Set(actual)
  const shared = estimate.filter(token => actualSet.has(token)).length
  const union = new Set([...estimate, ...actual]).size
  return Math.round((shared / union) * 1000) / 1000
}

/** Suggest only mutual, clearly separated matches. Every proposal remains visible and editable before analysis. */
export function proposeHistoricalFilePairs(estimates: HistoricalFileDescriptor[], actuals: HistoricalFileDescriptor[]): HistoricalFilePairProposal[] {
  const scores = estimates.map(estimate => actuals.map(actual => historicalFilePairScore(estimate.name, actual.name)))
  const bestActual = scores.map(row => row.reduce((best, score, index) => score > best.score ? { index, score } : best, { index: -1, score: 0 }))
  const bestEstimate = actuals.map((_, actualIndex) => scores.reduce((best, row, estimateIndex) => row[actualIndex] > best.score ? { index: estimateIndex, score: row[actualIndex] } : best, { index: -1, score: 0 }))
  return estimates.map((_, estimateIndex) => {
    const best = bestActual[estimateIndex]
    const runnerUp = [...scores[estimateIndex]].sort((left, right) => right - left)[1] ?? 0
    const mutual = best.index >= 0 && bestEstimate[best.index]?.index === estimateIndex
    const confident = mutual && best.score >= 0.6 && best.score - runnerUp >= 0.2
    return confident
      ? { estimateIndex, actualIndex: best.index, score: best.score, confidence: 'confident' }
      : { estimateIndex, score: best.score, confidence: 'unmatched' }
  })
}
