import type { ActualLine, CostCategory, EstimateLine, Job, Variance } from './types'

const categories: CostCategory[] = ['labor', 'materials', 'equipment', 'subcontractor', 'permit', 'other']

export function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

export function sumEstimate(lines: EstimateLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.estimatedCost || 0), 0)
}

export function sumActual(lines: ActualLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.actualCost || 0), 0)
}

export function estimateLaborHours(lines: EstimateLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.estimatedHours || 0), 0)
}

export function actualLaborHours(lines: ActualLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.actualHours || 0), 0)
}

export function calculateVariances(estimate: EstimateLine[], actual: ActualLine[]): Variance[] {
  return categories
    .map((category) => {
      const est = estimate.filter((x) => x.category === category)
      const act = actual.filter((x) => x.category === category)
      const estimatedCost = est.reduce((s, x) => s + x.estimatedCost, 0)
      const actualCost = act.reduce((s, x) => s + x.actualCost, 0)
      const estimatedHours = est.reduce((s, x) => s + (x.estimatedHours || 0), 0)
      const actualHours = act.reduce((s, x) => s + (x.actualHours || 0), 0)
      const costDelta = actualCost - estimatedCost
      const hoursDelta = actualHours - estimatedHours
      return {
        category,
        estimatedCost,
        actualCost,
        estimatedHours,
        actualHours,
        costDelta,
        costDeltaPct: estimatedCost > 0 ? costDelta / estimatedCost : actualCost > 0 ? 1 : null,
        hoursDelta,
        hoursDeltaPct: estimatedHours > 0 ? hoursDelta / estimatedHours : actualHours > 0 ? 1 : null,
      }
    })
    .filter((v) => v.estimatedCost || v.actualCost || v.estimatedHours || v.actualHours)
}

export function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function tokenSet(input: string) {
  return new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2))
}

export function textSimilarity(a: string, b: string) {
  const aa = tokenSet(a)
  const bb = tokenSet(b)
  if (!aa.size || !bb.size) return 0
  let intersection = 0
  for (const token of aa) if (bb.has(token)) intersection += 1
  return intersection / Math.sqrt(aa.size * bb.size)
}

export function scoreJobSimilarity(job: Job, target: { projectType: string; tags: string[]; estimatedTotal: number; text: string }) {
  let score = 0
  if (job.projectType.toLowerCase() === target.projectType.toLowerCase()) score += 0.45
  const tagMatches = job.tags.filter((tag) => target.tags.map((x) => x.toLowerCase()).includes(tag.toLowerCase())).length
  score += Math.min(0.2, tagMatches * 0.08)
  const denominator = Math.max(job.estimatedTotal, target.estimatedTotal, 1)
  score += Math.max(0, 0.2 - (Math.abs(job.estimatedTotal - target.estimatedTotal) / denominator) * 0.2)
  score += Math.min(0.15, textSimilarity(`${job.name} ${job.notes} ${job.tags.join(' ')}`, target.text) * 0.15)
  return score
}

export function categoryVariance(job: Job, category: CostCategory) {
  return job.variances.find((v) => v.category === category)
}
