import { costCategories, type ScopeChange } from './domain/scope'

const headerAliases = {
  reference: ['reference', 'approval reference', 'change order', 'change order reference', 'co', 'co number'],
  description: ['description', 'approved scope', 'scope', 'change description'],
  category: ['category', 'cost category', 'cost type'],
  estimatedCost: ['budget cost', 'budget change', 'estimated cost', 'estimated cost change', 'cost allowance'],
  estimatedHours: ['budget hours', 'hours change', 'estimated hours', 'estimated hours change'],
  actualCost: ['actual cost', 'change actual cost', 'actual cost for change'],
  actualHours: ['actual hours', 'change actual hours', 'actual hours for change'],
} as const

type Field = keyof typeof headerAliases

export class ScopeChangePasteError extends Error {}

function cells(line: string, delimiter: ',' | '\t') {
  if (delimiter === '\t') return line.split('\t').map(value => value.trim())
  const values: string[] = []
  let value = '', quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === ',' && !quoted) { values.push(value.trim()); value = '' }
    else value += character
  }
  if (quoted) throw new ScopeChangePasteError('A pasted CSV row contains an unclosed quote. Keep each scope change on one row.')
  values.push(value.trim())
  return values
}

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[$()#]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}

function indexes(headers: string[]) {
  const result = {} as Record<Field, number>
  for (const [field, aliases] of Object.entries(headerAliases) as Array<[Field, readonly string[]]>) {
    const index = headers.findIndex(header => aliases.includes(normalizedHeader(header)))
    if (index < 0) throw new ScopeChangePasteError(`The pasted header is missing “${aliases[0]}”.`)
    result[field] = index
  }
  return result
}

function moneyOrHours(value: string, label: string, row: number, nonnegative = false) {
  const trimmed = value.trim()
  const parenthesized = /^\(.*\)$/.test(trimmed)
  const normalized = trimmed.replace(/^\(/, '').replace(/\)$/, '').replace(/^\$/, '').replaceAll(',', '').trim()
  if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) throw new ScopeChangePasteError(`Row ${row}: ${label} must be an unambiguous number with at most two decimal places.`)
  const number = Number(normalized) * (parenthesized ? -1 : 1)
  if (!Number.isFinite(number) || Math.abs(number) > 1e12) throw new ScopeChangePasteError(`Row ${row}: ${label} is outside the supported range.`)
  if (nonnegative && number < 0) throw new ScopeChangePasteError(`Row ${row}: ${label} cannot be negative.`)
  return number
}

export function parseScopeChangePaste(text: string): ScopeChange[] {
  if (text.length > 100_000) throw new ScopeChangePasteError('Pasted scope changes are too large.')
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) throw new ScopeChangePasteError('Paste a header row and at least one scope-change row.')
  if (lines.length > 101) throw new ScopeChangePasteError('Paste at most 100 scope-change rows at a time.')
  const delimiter: ',' | '\t' = lines[0].includes('\t') ? '\t' : ','
  const header = cells(lines[0], delimiter)
  const column = indexes(header)
  const changes = lines.slice(1).map((line, index) => {
    const row = index + 2
    const values = cells(line, delimiter)
    if (values.length !== header.length) throw new ScopeChangePasteError(`Row ${row}: expected ${header.length} columns but found ${values.length}.`)
    const reference = values[column.reference]?.trim() ?? ''
    const description = values[column.description]?.trim() ?? ''
    const category = values[column.category]?.trim().toLowerCase() ?? ''
    if (!reference) throw new ScopeChangePasteError(`Row ${row}: approval reference is required.`)
    if (!description) throw new ScopeChangePasteError(`Row ${row}: approved scope is required.`)
    if (reference.length > 200) throw new ScopeChangePasteError(`Row ${row}: approval reference is too long.`)
    if (description.length > 1000) throw new ScopeChangePasteError(`Row ${row}: approved scope is too long.`)
    if (!costCategories.includes(category as (typeof costCategories)[number])) throw new ScopeChangePasteError(`Row ${row}: category must be ${costCategories.join(', ')}.`)
    return {
      reference,
      description,
      category: category as ScopeChange['category'],
      estimatedCost: moneyOrHours(values[column.estimatedCost] ?? '', 'budget cost', row),
      estimatedHours: moneyOrHours(values[column.estimatedHours] ?? '', 'budget hours', row),
      actualCost: moneyOrHours(values[column.actualCost] ?? '', 'actual cost', row, true),
      actualHours: moneyOrHours(values[column.actualHours] ?? '', 'actual hours', row, true),
    }
  })
  const identities = changes.map(change => `${change.reference.toLowerCase()}::${change.category}`)
  if (new Set(identities).size !== identities.length) throw new ScopeChangePasteError('Use one row per approval reference and cost category.')
  return changes
}
