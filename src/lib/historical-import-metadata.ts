export const historicalProjectTypes = [
  'Office retrofit',
  'Retail retrofit',
  'Multifamily retrofit',
  'Warehouse lighting',
  'Restaurant fit-out',
  'New construction',
] as const

export const historicalCustomerTypes = ['Commercial', 'Residential', 'Public'] as const
export type HistoricalEstimateBaselineRole = 'original_bid' | 'final_submitted' | 'historical_unknown'

export type HistoricalImportMetadataSuggestion = {
  name?: string
  projectType?: string
  customerType?: string
  completedAt?: string
  estimateBaselineRole: HistoricalEstimateBaselineRole
  tags: string[]
}

export type HistoricalJobMetadata = {
  name: string
  projectType: string
  customerType: string
  location: string
  completedAt: string
  tags: string[]
  notes: string
}

export class HistoricalImportMetadataError extends Error {}

const genericTokens = new Set(['estimate', 'bid', 'actual', 'actuals', 'cost', 'costs', 'job', 'report', 'export', 'final', 'submitted', 'original'])

function withoutExtension(fileName: string) {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.(?:csv|xlsx)$/i, '')
}

function normalizedDate(fileName: string) {
  const match = withoutExtension(fileName).match(/(?:^|[^0-9])(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/)
  if (!match) return undefined
  const value = `${match[1]}-${match[2]}-${match[3]}`
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value ? value : undefined
}

function descriptiveStem(fileName: string) {
  const date = normalizedDate(fileName)
  const text = withoutExtension(fileName)
    .replace(date ? new RegExp(date.replaceAll('-', '[-_]'), 'g') : /$^/, ' ')
    .replace(/\b(?:final\s+submitted|submitted\s+final|original\s+bid|final\s+estimate|estimate\s+final|job\s*cost(?:s)?|actual\s*cost(?:s)?|estimate|actuals?|cost\s+report|export)\b/gi, ' ')
    .replace(/[()[\]{}_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const meaningful = text.split(/\s+/).filter(token => !genericTokens.has(token.toLowerCase()))
  if (!meaningful.length) return undefined
  const result = meaningful.join(' ')
  if (/^[A-Z0-9\s]+$/.test(result)) return result.toLowerCase().replace(/\b\w/g, character => character.toUpperCase())
  return result
}

function sharedName(estimateFileName: string, actualFileName: string) {
  const estimate = descriptiveStem(estimateFileName)
  const actual = descriptiveStem(actualFileName)
  if (!estimate && !actual) return undefined
  if (estimate && actual && estimate.toLowerCase() === actual.toLowerCase()) return estimate
  if (!estimate || !actual) return estimate ?? actual
  const estimateWords = estimate.split(/\s+/), actualWords = actual.split(/\s+/)
  const shared: string[] = []
  for (let index = 0; index < Math.min(estimateWords.length, actualWords.length); index += 1) {
    if (estimateWords[index].toLowerCase() !== actualWords[index].toLowerCase()) break
    shared.push(estimateWords[index])
  }
  return shared.length >= 2 ? shared.join(' ') : estimate
}

function inferredProjectType(text: string) {
  if (/\boffice\b|tenant\s*(?:improvement|fit.?out)|\bti\b/i.test(text)) return 'Office retrofit'
  if (/\bretail\b|storefront|shop\b/i.test(text)) return 'Retail retrofit'
  if (/multifamily|multi-family|apartment|condo/i.test(text)) return 'Multifamily retrofit'
  if (/warehouse|distribution|lighting retrofit/i.test(text)) return 'Warehouse lighting'
  if (/restaurant|kitchen|dining/i.test(text)) return 'Restaurant fit-out'
  if (/new\s*(?:build|construction)|ground.?up/i.test(text)) return 'New construction'
  return undefined
}

function inferredCustomerType(text: string) {
  if (/city hall|municipal|government|public school|school district|courthouse|library/i.test(text)) return 'Public'
  if (/residential|single.family|house|home\b/i.test(text)) return 'Residential'
  if (/office|tenant|retail|warehouse|restaurant|commercial|multifamily|apartment/i.test(text)) return 'Commercial'
  return undefined
}

function inferredBaseline(fileName: string): HistoricalEstimateBaselineRole {
  const text = withoutExtension(fileName)
  if (/\b(?:final\s+submitted|submitted\s+(?:bid|estimate)|final\s+(?:bid|estimate))\b/i.test(text)) return 'final_submitted'
  if (/\boriginal\s+(?:bid|estimate)\b/i.test(text)) return 'original_bid'
  return 'historical_unknown'
}

export function inferHistoricalImportMetadata(input: { estimateFileName: string; actualFileName: string }): HistoricalImportMetadataSuggestion {
  const name = sharedName(input.estimateFileName, input.actualFileName)
  const context = [name, withoutExtension(input.estimateFileName), withoutExtension(input.actualFileName)].filter(Boolean).join(' ')
  const tags = [
    /\boccupied\b/i.test(context) ? 'occupied' : undefined,
    /after[\s_-]?hours/i.test(context) ? 'after-hours' : undefined,
    /\bretrofit\b|renovation/i.test(context) ? 'retrofit' : undefined,
  ].filter((value): value is string => Boolean(value))
  return {
    ...(name ? { name } : {}),
    ...(inferredProjectType(context) ? { projectType: inferredProjectType(context) } : {}),
    ...(inferredCustomerType(context) ? { customerType: inferredCustomerType(context) } : {}),
    ...(normalizedDate(input.actualFileName) ? { completedAt: normalizedDate(input.actualFileName) } : {}),
    estimateBaselineRole: inferredBaseline(input.estimateFileName),
    tags,
  }
}

function requiredText(value: unknown, label: string, maxLength = 200) {
  const text = String(value ?? '').trim()
  if (!text) throw new HistoricalImportMetadataError(`${label} is required.`)
  if (text.length > maxLength) throw new HistoricalImportMetadataError(`${label} is too long.`)
  return text
}

export function parseHistoricalJobMetadata(input: Record<string, unknown>): HistoricalJobMetadata {
  const name = requiredText(input.name, 'Job name')
  const projectType = requiredText(input.projectType, 'Project type', 120)
  const customerType = requiredText(input.customerType, 'Customer type', 120)
  const completedAt = requiredText(input.completedAt, 'Job completion date', 10)
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(completedAt) || new Date(`${completedAt}T12:00:00Z`).toISOString().slice(0, 10) !== completedAt) {
    throw new HistoricalImportMetadataError('Enter a valid job completion date.')
  }
  const tagValues = Array.isArray(input.tags) ? input.tags : String(input.tags ?? '').split(',')
  const tags = [...new Map(tagValues.map(value => String(value).trim()).filter(Boolean).map(value => [value.toLowerCase(), value])).values()].slice(0, 30)
  return {
    name,
    projectType,
    customerType,
    location: String(input.location ?? '').trim().slice(0, 300),
    completedAt,
    tags,
    notes: String(input.notes ?? '').trim().slice(0, 10_000),
  }
}
