import ExcelJS from 'exceljs'
import type { ActualLine, CostCategory, EstimateLine } from '@/lib/domain/types'
import { id } from '@/lib/domain/ids'
import { parseExcelLiveSnapshot, type ExcelLiveSnapshot } from '@/lib/integrations/excel-snapshot'

export type ImportIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  resolution?: 'actual_completeness' | 'incomplete_actuals'
}
export type ExcludedImportRow = {
  sourceRow: number
  reason: 'blank' | 'summary' | 'section_header' | 'repeated_header' | 'malformed_numeric' | 'unmapped' | 'ambiguous'
  description: string
}
export type MalformedImportCell = { sourceRow: number; column: string; value: string; reason: string }
export type WorksheetCandidate = { name: string; hidden: boolean; plausible: boolean; selected: boolean; headerRow: number | null; score: number }
export type ResolvedImportMapping = {
  description?: string
  category?: string
  costCode?: string
  phase?: string
  division?: string
  cost?: string
  hours?: string
  quantity?: string
  unitCost?: string
  unit?: string
}
export type ImportMappingField = keyof ResolvedImportMapping
export type ImportMappingSelection = Partial<Record<ImportMappingField, number>>
export type ImportMappingOption = { header: string; column: number }
export type TotalReconciliation = {
  state: 'matched' | 'within_tolerance' | 'needs_review' | 'failed' | 'not_available'
  sourceReportedTotal: number | null
  normalizedDetailTotal: number
  absoluteDifference: number | null
  percentageDifference: number | null
  absoluteTolerance: number
  percentageTolerance: number
  absoluteToleranceCap: number
  roundingTolerance: number
  reviewTolerance: number
}
export type StructuredDimensionValues = { costCodes: string[]; phases: string[]; divisions: string[] }
export const IMPORT_PARSER_VERSION = '2026-09-p1-v2'
export const IMPORT_RESOURCE_LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  expandedWorkbookBytes: 128 * 1024 * 1024,
  zipEntries: 5_000,
  zipCompressionRatio: 100,
  worksheets: 50,
  rows: 50_000,
  columns: 256,
  cells: 2_000_000,
  cellCharacters: 100_000,
} as const
export type ImportParseOptions = { worksheet?: string; mapping?: ImportMappingSelection }
export type NormalizedLineProvenance = {
  lineId: string
  worksheet: string
  sourceRow: number
  mapping: ResolvedImportMapping
  originalValues: Partial<Record<keyof ResolvedImportMapping, string>>
  normalizationDecisions: string[]
  parserVersion: string
}
export type SpreadsheetImportReport = {
  kind: 'estimate' | 'actual'
  fileName: string
  sheetName: string
  worksheets: WorksheetCandidate[]
  worksheetSelectionRationale: string
  headerRow: number
  headers: string[]
  mappedColumns: ResolvedImportMapping
  mappedColumnIndexes?: ImportMappingSelection
  mappingCandidates: Partial<Record<keyof ResolvedImportMapping, string[]>>
  mappingOptions?: Partial<Record<ImportMappingField, ImportMappingOption[]>>
  sourceRows: number
  importedRows: number
  skippedSummaryRows: number
  skippedEmptyRows: number
  excludedRows: ExcludedImportRow[]
  malformedCells: MalformedImportCell[]
  invalidNumericCells: number
  categoryCounts: Record<CostCategory, number>
  categoryTotals: Record<CostCategory, { cost: number; hours: number }>
  totalCost: number
  totalHours: number
  sourceReportedTotal: number | null
  normalizedDetailTotal: number
  totalReconciliation: TotalReconciliation
  laborHourCoverage: 'present' | 'absent'
  structuredDimensions: StructuredDimensionValues
  issues: ImportIssue[]
}
export type ImportPairReport = {
  issues: ImportIssue[]
  requiresReview: boolean
  completeness: {
    state: 'complete' | 'incomplete'
    missingActualCategories: CostCategory[]
    confirmedZeroCategories: CostCategory[]
    missingActualCostCodes: string[]
    missingActualPhases: string[]
    missingActualDivisions: string[]
    costCodeCoverage: 'not_applicable' | 'complete' | 'incomplete' | 'unavailable'
    phaseCoverage: 'not_applicable' | 'complete' | 'incomplete' | 'unavailable'
    divisionCoverage: 'not_applicable' | 'complete' | 'incomplete' | 'unavailable'
    requiresExplicitConfirmation: true
  }
}
export class SpreadsheetInputError extends Error {}

const importMappingFields = new Set<ImportMappingField>(['description', 'category', 'costCode', 'phase', 'division', 'cost', 'hours', 'quantity', 'unitCost', 'unit'])
export function parseImportMappingSelection(input: unknown): ImportMappingSelection | undefined {
  if (input === undefined || input === null || input === '') return undefined
  let value: unknown = input
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { throw new SpreadsheetInputError('Column selections are malformed. Preview the files again.') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SpreadsheetInputError('Column selections are malformed. Preview the files again.')
  const selection: ImportMappingSelection = {}
  for (const [field, column] of Object.entries(value)) {
    if (!importMappingFields.has(field as ImportMappingField) || !Number.isInteger(column) || Number(column) < 1 || Number(column) > IMPORT_RESOURCE_LIMITS.columns) {
      throw new SpreadsheetInputError('Column selections contain an unsupported field or column. Preview the files again.')
    }
    selection[field as ImportMappingField] = Number(column)
  }
  return selection
}

/** Totals match at one cent. Rounding differences may pass up to the larger of
 * $1 or 0.01%, capped at $10. Differences up to 0.1%, capped at $100, require
 * review. Anything larger is a hard blocker and cannot be waived. */
export const SOURCE_TOTAL_TOLERANCE = { absolute: 1, percentage: 0.0001, absoluteCap: 10, reviewPercentage: 0.001, reviewAbsoluteCap: 100 } as const

const patterns = {
  description: [/description/, /^item(?: name)?$/, /^scope(?: of work)?$/, /^work(?: description)?$/, /^activity$/, /^name$/],
  category: [/^category$/, /cost type/, /^type$/, /^class$/],
  costCode: [/cost code/], phase: [/^phase$/], division: [/^division(?: code)?$/],
  estimateHours: [/estimated hours/, /budget(?:ed)? hours/, /estimated (?:mh|hrs)/, /budget(?:ed)? (?:mh|hrs)/, /labor (?:hours|hrs)/, /^hours$/, /man (?:hours|hrs)/],
  actualHours: [/actual (?:hours|hrs)/, /worked (?:hours|hrs)/, /(?:hours|hrs) worked/, /actual mh/, /labor (?:hours|hrs)/, /^hours$/, /man (?:hours|hrs)/],
  quantity: [/^quantity$/, /^qty$/],
  unitCost: [/^unit cost$/, /^unit price$/, /^unit rate$/, /^rate$/, /^labor rate$/],
  estimateCost: [/^estimated cost$/, /^budget(?:ed)? cost$/, /^budget amount$/, /^budget$/, /^cost$/, /^total cost$/, /^amount$/, /^total$/, /^extension$/, /^extended cost$/, /^mat ext$/],
  actualCost: [/^actual cost$/, /^actual amount$/, /^job cost$/, /^incurred$/, /^cost$/, /^total cost$/, /^amount$/, /^total$/, /^extension$/, /^extended cost$/, /^mat ext$/],
  unit: [/^unit$/, /^uom$/, /^mat unit$/],
} as const

type RawRow = { rowNumber: number; values: unknown[] }
type RawSheet = { name: string; hidden: boolean; rows: RawRow[]; csvIssues: ImportIssue[] }
type ColumnRef = { index: number; header: string }
type InternalMapping = Record<keyof ResolvedImportMapping, ColumnRef | undefined>

function scalarInfo(value: unknown): { value: unknown; formula: boolean; missingFormulaResult: boolean } {
  if (value === null || value === undefined) return { value: '', formula: false, missingFormulaResult: false }
  if (typeof value !== 'object') return { value, formula: false, missingFormulaResult: false }
  const candidate = value as Record<string, unknown>
  if ('formula' in candidate || 'sharedFormula' in candidate) {
    if (!('result' in candidate) || candidate.result === undefined) return { value: candidate, formula: true, missingFormulaResult: true }
    const result = scalarInfo(candidate.result)
    return { value: result.value, formula: true, missingFormulaResult: result.missingFormulaResult }
  }
  if ('result' in candidate && candidate.result !== undefined) return scalarInfo(candidate.result)
  if ('text' in candidate && candidate.text !== undefined) return scalarInfo(candidate.text)
  if (Array.isArray(candidate.richText)) return { value: candidate.richText.map(part => scalarInfo((part as Record<string, unknown>).text).value).join(''), formula: false, missingFormulaResult: false }
  return { value, formula: false, missingFormulaResult: false }
}

function normalizeHeader(value: unknown) { return String(scalarInfo(value).value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function asText(value: unknown) { const resolved = scalarInfo(value).value; return resolved && typeof resolved === 'object' ? '' : String(resolved ?? '').trim() }

type ParsedNumber = { kind: 'missing' } | { kind: 'valid'; value: number; formulaCached: boolean } | { kind: 'invalid'; reason: string; display: string }
function parseNumber(value: unknown): ParsedNumber {
  const resolved = scalarInfo(value)
  if (resolved.missingFormulaResult) return { kind: 'invalid', reason: 'Formula has no cached numeric result.', display: '[formula without cached result]' }
  if (resolved.value === '' || resolved.value === null || resolved.value === undefined) return { kind: 'missing' }
  if (typeof resolved.value === 'number') return Number.isFinite(resolved.value) ? { kind: 'valid', value: resolved.value, formulaCached: resolved.formula } : { kind: 'invalid', reason: 'Number is not finite.', display: String(resolved.value) }
  if (typeof resolved.value === 'object') return { kind: 'invalid', reason: 'Cell is not a usable numeric value.', display: JSON.stringify(resolved.value) }
  let valueText = String(resolved.value).trim(); const display = valueText
  if (!valueText) return { kind: 'missing' }
  let negative = false
  if (/^\(.*\)$/.test(valueText)) { negative = true; valueText = valueText.slice(1, -1).trim() }
  if (valueText.startsWith('-')) { if (negative) return { kind: 'invalid', reason: 'Conflicting negative notation.', display }; negative = true; valueText = valueText.slice(1).trim() }
  else if (valueText.startsWith('+')) valueText = valueText.slice(1).trim()
  if (valueText.startsWith('$')) valueText = valueText.slice(1).trim()
  if (valueText.startsWith('-')) { if (negative) return { kind: 'invalid', reason: 'Conflicting negative notation.', display }; negative = true; valueText = valueText.slice(1).trim() }
  const unambiguousUsNumber = /^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?$|^\.\d+$/
  if (!unambiguousUsNumber.test(valueText)) return { kind: 'invalid', reason: 'Unsupported or ambiguous numeric format.', display }
  const parsed = Number(valueText.replaceAll(',', '')) * (negative ? -1 : 1)
  return Number.isFinite(parsed) ? { kind: 'valid', value: parsed, formulaCached: resolved.formula } : { kind: 'invalid', reason: 'Number is not finite.', display }
}

function categoryFrom(input: string): CostCategory {
  const value = input.toLowerCase().trim()
  if (/^(l|lab|lbr)$/.test(value)) return 'labor'
  if (/^(m|mat|mtl)$/.test(value)) return 'materials'
  if (/^(e|eq|equip)$/.test(value)) return 'equipment'
  if (/^(s|sub)$/.test(value)) return 'subcontractor'
  if (/labor|labour|hours|man hour|journeyman|electrician/.test(value)) return 'labor'
  if (/material|wire|conduit|fixture|device|panel|feeder|fitting/.test(value)) return 'materials'
  if (/equipment|lift|scissor|boom|rental|tool/.test(value)) return 'equipment'
  if (/subcontract|sub contractor|subcontractor/.test(value)) return 'subcontractor'
  if (/permit|inspection|fee/.test(value)) return 'permit'
  return 'other'
}

function delimiterFor(text: string) {
  const counts = new Map([[',', 0], ['\t', 0], [';', 0]]); let quoted = false; let records = 0
  for (let index = 0; index < text.length && records < 5; index += 1) {
    const char = text[index]
    if (char === '"') { if (quoted && text[index + 1] === '"') index += 1; else quoted = !quoted }
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1)
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[index + 1] === '\n') index += 1; records += 1 }
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0][0]
}

function parseCsv(text: string): { rows: RawRow[]; issues: ImportIssue[] } {
  const delimiter = delimiterFor(text); const rows: RawRow[] = []
  let row: string[] = []; let field = ''; let quoted = false; let physicalLine = 1; let rowStart = 1
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index += 1 } else quoted = !quoted }
    else if (char === delimiter && !quoted) {
      if (field.length > IMPORT_RESOURCE_LIMITS.cellCharacters) throw new SpreadsheetInputError('A CSV field is too long to analyze safely.')
      row.push(field); field = ''
      if (row.length > IMPORT_RESOURCE_LIMITS.columns) throw new SpreadsheetInputError(`CSV files may contain at most ${IMPORT_RESOURCE_LIMITS.columns} columns.`)
    }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      if (field.length > IMPORT_RESOURCE_LIMITS.cellCharacters) throw new SpreadsheetInputError('A CSV field is too long to analyze safely.')
      row.push(field); rows.push({ rowNumber: rowStart, values: row }); field = ''; row = []; physicalLine += 1; rowStart = physicalLine
      if (rows.length > IMPORT_RESOURCE_LIMITS.rows) throw new SpreadsheetInputError(`CSV files may contain at most ${IMPORT_RESOURCE_LIMITS.rows.toLocaleString()} rows.`)
    } else { field += char; if (field.length > IMPORT_RESOURCE_LIMITS.cellCharacters) throw new SpreadsheetInputError('A CSV field is too long to analyze safely.'); if (char === '\n') physicalLine += 1 }
  }
  if (field || row.length || !rows.length) { row.push(field); rows.push({ rowNumber: rowStart, values: row }) }
  if(rows.length>IMPORT_RESOURCE_LIMITS.rows)throw new SpreadsheetInputError(`CSV files may contain at most ${IMPORT_RESOURCE_LIMITS.rows.toLocaleString()} rows.`)
  if(rows.some(value=>value.values.length>IMPORT_RESOURCE_LIMITS.columns))throw new SpreadsheetInputError(`CSV files may contain at most ${IMPORT_RESOURCE_LIMITS.columns} columns.`)
  if(rows.reduce((total,value)=>total+value.values.length,0)>IMPORT_RESOURCE_LIMITS.cells)throw new SpreadsheetInputError(`This CSV exceeds the ${IMPORT_RESOURCE_LIMITS.cells.toLocaleString()} cell limit.`)
  return { rows, issues: quoted ? [{ severity: 'error', code: 'malformed_csv', message: 'CSV contains an unclosed quoted field.' }] : [] }
}

function validateXlsxArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new SpreadsheetInputError('The XLSX file is not a valid ZIP workbook.')
  const entries = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entries > IMPORT_RESOURCE_LIMITS.zipEntries) throw new SpreadsheetInputError('This workbook contains too many ZIP entries to analyze safely.')
  let offset = centralOffset; let expanded = 0; let compressed = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new SpreadsheetInputError('The XLSX ZIP directory is malformed.')
    const flags = view.getUint16(offset + 8, true)
    const packed = view.getUint32(offset + 20, true); const unpacked = view.getUint32(offset + 24, true)
    if ((flags & 1) !== 0) throw new SpreadsheetInputError('Encrypted XLSX workbooks are not supported.')
    if (packed === 0xffffffff || unpacked === 0xffffffff) throw new SpreadsheetInputError('ZIP64 XLSX workbooks are not supported.')
    compressed += packed; expanded += unpacked
    if (expanded > IMPORT_RESOURCE_LIMITS.expandedWorkbookBytes || (compressed > 0 && expanded / compressed > IMPORT_RESOURCE_LIMITS.zipCompressionRatio)) throw new SpreadsheetInputError('This workbook expands beyond the safe analysis limit. Reduce it to the required worksheets and try again.')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
}

function headerScore(row: unknown[]) {
  const headers = row.map(normalizeHeader)
  return [/description|item|scope|work|activity|^name$/, /category|division|type|cost code|phase|class/, /cost|amount|total|extension|price|budget|incurred/, /hours|hrs|man hours|labor hours|\bmh\b/, /quantity|qty|unit|uom/]
    .filter(signal => headers.some(header => signal.test(header))).length
}
function bestTable(rows: RawRow[]) {
  const nonempty = rows.filter(row => row.values.some(value => asText(value) !== ''))
  if (!nonempty.length) return { header: undefined, score: 0 }
  const best = nonempty.slice(0, Math.min(12, nonempty.length)).map(row => ({ row, score: headerScore(row.values) })).sort((a, b) => b.score - a.score || a.row.rowNumber - b.row.rowNumber)[0]
  return { header: best.row, score: best.score }
}

async function rawSheetsFromFile(file: File): Promise<RawSheet[]> {
  if (file.size > IMPORT_RESOURCE_LIMITS.fileBytes) throw new SpreadsheetInputError('This file is larger than the 25 MB import limit.')
  const extension = file.name.toLowerCase().split('.').pop()
  const rawBuffer=await file.arrayBuffer();const bytes = new Uint8Array(rawBuffer)
  if (extension === 'csv') {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new SpreadsheetInputError('The file contents are XLSX data but the filename says CSV.')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new SpreadsheetInputError('CSV imports must use valid UTF-8 encoding. Save the file as UTF-8 and try again.') }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    if(text.includes('\uFFFD'))throw new SpreadsheetInputError('CSV input contains the Unicode replacement character. Re-export the source as valid UTF-8 so damaged text cannot enter imported evidence.')
    const parsed = parseCsv(text); return [{ name: 'CSV', hidden: false, rows: parsed.rows, csvIssues: parsed.issues }]
  }
  if (extension !== 'xlsx') throw new SpreadsheetInputError('Use .xlsx or .csv for estimate and actual-cost files.')
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new SpreadsheetInputError('The file contents are not a valid XLSX workbook.')
  validateXlsxArchive(bytes)
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(rawBuffer)
  if (!workbook.worksheets.length) throw new Error('The spreadsheet does not contain a worksheet.')
  if (workbook.worksheets.length > IMPORT_RESOURCE_LIMITS.worksheets) throw new SpreadsheetInputError(`Workbooks may contain at most ${IMPORT_RESOURCE_LIMITS.worksheets} worksheets.`)
  let cells = 0
  return workbook.worksheets.map(sheet => {
    if (sheet.rowCount > IMPORT_RESOURCE_LIMITS.rows) throw new SpreadsheetInputError(`Worksheet “${sheet.name}” exceeds the ${IMPORT_RESOURCE_LIMITS.rows.toLocaleString()} row limit.`)
    if (sheet.columnCount > IMPORT_RESOURCE_LIMITS.columns) throw new SpreadsheetInputError(`Worksheet “${sheet.name}” exceeds the ${IMPORT_RESOURCE_LIMITS.columns} column limit.`)
    cells += sheet.rowCount * sheet.columnCount
    if (cells > IMPORT_RESOURCE_LIMITS.cells) throw new SpreadsheetInputError(`This workbook exceeds the ${IMPORT_RESOURCE_LIMITS.cells.toLocaleString()} cell limit.`)
    const rows: RawRow[] = []
    sheet.eachRow({ includeEmpty: true }, row => {
      const values=(row.values as unknown[]).slice(1)
      if(values.some(value=>asText(value).length>IMPORT_RESOURCE_LIMITS.cellCharacters))throw new SpreadsheetInputError(`Worksheet “${sheet.name}” contains a cell longer than ${IMPORT_RESOURCE_LIMITS.cellCharacters.toLocaleString()} characters.`)
      rows.push({ rowNumber: row.number, values })
    })
    return { name: sheet.name, hidden: sheet.state !== 'visible', rows, csvIssues: [] }
  })
}

function worksheetAnalysis(sheets: RawSheet[], requested?: string) {
  const analyzed = sheets.map(sheet => {
    const best = bestTable(sheet.rows)
    const hasData = best.header ? sheet.rows.some(row => row.rowNumber > best.header!.rowNumber && row.values.some(value => asText(value) !== '')) : false
    return { sheet, header: best.header, score: best.score, plausible: best.score >= 2 && hasData }
  })
  const visiblePlausible = analyzed.filter(candidate => !candidate.sheet.hidden && candidate.plausible)
  let selected = visiblePlausible.length === 1 ? visiblePlausible[0] : undefined
  let reason = selected ? sheets.length === 1 ? 'The file contains one visible worksheet with a usable import table.' : 'Exactly one visible worksheet has a usable import table.' : visiblePlausible.length > 1 ? 'Multiple visible worksheets contain materially plausible import tables.' : 'No visible worksheet contains a safely identifiable import table.'
  if (requested) {
    const candidate=analyzed.find(value=>value.sheet.name===requested)
    if(candidate?.sheet.hidden)reason=`Worksheet “${requested}” is hidden and cannot be selected for import.`
    else if(!candidate?.plausible)reason=`Worksheet “${requested}” does not contain a safely identifiable import table.`
    else {selected=candidate;reason=`Worksheet “${requested}” was explicitly selected for this import review.`}
  }
  return { analyzed, selected, reason }
}

function resolveColumn(headers: ColumnRef[], candidates: readonly RegExp[]) {
  const all = headers.filter(column => candidates.some(pattern => pattern.test(column.header))); let selected: ColumnRef | undefined
  for (const pattern of candidates) { selected = headers.find(column => pattern.test(column.header)); if (selected) break }
  return { selected, all }
}
function resolveMapping(headers: ColumnRef[], kind: 'estimate' | 'actual', selections: ImportMappingSelection = {}) {
  const definitions: Record<keyof ResolvedImportMapping, readonly RegExp[]> = { description: patterns.description, category: patterns.category, costCode: patterns.costCode, phase: patterns.phase, division: patterns.division, cost: kind === 'estimate' ? patterns.estimateCost : patterns.actualCost, hours: kind === 'estimate' ? patterns.estimateHours : patterns.actualHours, quantity: patterns.quantity, unitCost: patterns.unitCost, unit: patterns.unit }
  const mapping = {} as InternalMapping; const mappingCandidates: Partial<Record<keyof ResolvedImportMapping, string[]>> = {}; const mappingOptions: Partial<Record<ImportMappingField, ImportMappingOption[]>> = {}; const ambiguous: Array<{ field: keyof ResolvedImportMapping; columns: ColumnRef[] }> = []; const invalidSelections: ImportMappingField[] = []
  for (const field of Object.keys(definitions) as Array<keyof ResolvedImportMapping>) {
    const resolved = resolveColumn(headers, definitions[field]); const requested = selections[field]
    const explicitlySelected = requested === undefined ? undefined : resolved.all.find(column => column.index + 1 === requested)
    if (requested !== undefined && !explicitlySelected) invalidSelections.push(field)
    mapping[field] = requested === undefined ? resolved.selected : explicitlySelected
    if (resolved.all.length) mappingCandidates[field] = resolved.all.map(column => `${column.header} (column ${column.index + 1})`)
    if (resolved.all.length) mappingOptions[field] = resolved.all.map(column => ({ header: column.header, column: column.index + 1 }))
    if (resolved.all.length > 1 && requested === undefined) ambiguous.push({ field, columns: resolved.all })
  }
  const mappedColumns = Object.fromEntries(Object.entries(mapping).filter((entry): entry is [string, ColumnRef] => Boolean(entry[1])).map(([field, column]) => [field, column.header])) as ResolvedImportMapping
  const mappedColumnIndexes = Object.fromEntries(Object.entries(mapping).filter((entry): entry is [string, ColumnRef] => Boolean(entry[1])).map(([field, column]) => [field, column.index + 1])) as ImportMappingSelection
  return { mapping, mappedColumns, mappedColumnIndexes, mappingCandidates, mappingOptions, ambiguous, invalidSelections }
}

function cell(row: RawRow, column: ColumnRef | undefined) { return column ? row.values[column.index] : undefined }
function rowDescription(row: RawRow, mapping: InternalMapping) { return asText(cell(row, mapping.description)) || asText(cell(row, mapping.category)) || asText(cell(row, mapping.costCode)) || asText(cell(row, mapping.phase)) || asText(cell(row, mapping.division)) }
type SummaryClassification = { kind: 'detail' | 'summary' | 'ambiguous'; overall: boolean }
function classifySummary(description: string, category: string): SummaryClassification {
  const normalize = (text: string) => text.trim().toLowerCase().replace(/[&_:/\s-]+/g, ' ').trim()
  const labels = [description, category].map(normalize).filter(Boolean)
  if (!labels.length) return { kind: 'summary', overall: false }
  const overall = /^(?:total|grand total|job total|project total|estimate total|bid total|total cost|total estimated cost|estimated cost total|total project cost|project cost total|total direct cost|direct cost total|total job cost|direct job cost total)$/
  const subtotal = /^(?:subtotal|(?:labor|labour|material|materials|equipment|subcontractor|permit|category|section) (?:total|subtotal)|(?:labor material|material labor) total)$/
  const numbered = /^(?:division|phase|section|category)\s+[a-z0-9.]+\s+(?:total|subtotal)$/
  if (labels.some(label => overall.test(label))) return { kind: 'summary', overall: true }
  if (labels.some(label => subtotal.test(label) || numbered.test(label))) return { kind: 'summary', overall: false }
  if (labels.some(label => /\b(?:total|subtotal)$/.test(label))) return { kind: 'ambiguous', overall: false }
  return { kind: 'detail', overall: false }
}
export function summaryRow(description: string, rawCategory: string) { return classifySummary(description, rawCategory).kind === 'summary' }

function emptyCategoryCounts(): Record<CostCategory, number> { return { labor: 0, materials: 0, equipment: 0, subcontractor: 0, permit: 0, other: 0 } }
function emptyCategoryTotals(): Record<CostCategory, { cost: number; hours: number }> { return { labor: { cost: 0, hours: 0 }, materials: { cost: 0, hours: 0 }, equipment: { cost: 0, hours: 0 }, subcontractor: { cost: 0, hours: 0 }, permit: { cost: 0, hours: 0 }, other: { cost: 0, hours: 0 } } }
function reconciliationBase(normalizedDetailTotal: number) { return { normalizedDetailTotal, absoluteTolerance: SOURCE_TOTAL_TOLERANCE.absolute, percentageTolerance: SOURCE_TOTAL_TOLERANCE.percentage, absoluteToleranceCap: SOURCE_TOTAL_TOLERANCE.absoluteCap, roundingTolerance: SOURCE_TOTAL_TOLERANCE.absolute, reviewTolerance: SOURCE_TOTAL_TOLERANCE.absolute } }
function reconcileTotals(sourceTotals: number[], normalizedDetailTotal: number): { reconciliation: TotalReconciliation; conflict: boolean } {
  const distinct = [...new Set(sourceTotals.map(value => Math.round(value * 100) / 100))]; const sourceReportedTotal = distinct.length === 1 ? distinct[0] : null
  if (sourceReportedTotal === null) return { reconciliation: { state: 'not_available', sourceReportedTotal: null, absoluteDifference: null, percentageDifference: null, ...reconciliationBase(normalizedDetailTotal) }, conflict: distinct.length > 1 }
  const absoluteDifference = Math.round(Math.abs(normalizedDetailTotal - sourceReportedTotal) * 100) / 100; const percentageDifference = sourceReportedTotal === 0 ? (absoluteDifference === 0 ? 0 : null) : absoluteDifference / Math.abs(sourceReportedTotal)
  const roundingAllowed = Math.max(SOURCE_TOTAL_TOLERANCE.absolute, Math.min(Math.abs(sourceReportedTotal) * SOURCE_TOTAL_TOLERANCE.percentage, SOURCE_TOTAL_TOLERANCE.absoluteCap))
  const reviewAllowed = Math.max(roundingAllowed, Math.min(Math.abs(sourceReportedTotal) * SOURCE_TOTAL_TOLERANCE.reviewPercentage, SOURCE_TOTAL_TOLERANCE.reviewAbsoluteCap))
  const state = absoluteDifference <= 0.01 ? 'matched' : absoluteDifference <= roundingAllowed ? 'within_tolerance' : absoluteDifference <= reviewAllowed ? 'needs_review' : 'failed'
  return { reconciliation: { state, sourceReportedTotal, absoluteDifference, percentageDifference, ...reconciliationBase(normalizedDetailTotal), roundingTolerance: roundingAllowed, reviewTolerance: reviewAllowed }, conflict: false }
}

function normalizeUnit(value:string){const key=value.trim().toUpperCase().replaceAll('.','');const aliases:Record<string,string>={EACH:'EA',EA:'EA',LF:'LF','LIN FT':'LF','LINEAR FEET':'LF',FT:'FT',FEET:'FT',SF:'SF','SQ FT':'SF',CY:'CY','CU YD':'CY',HR:'HR',HRS:'HR',HOUR:'HR',HOURS:'HR',DAY:'DAY',DAYS:'DAY',LOT:'LOT',LS:'LS','LUMP SUM':'LS'};return aliases[key]}
function originalValues(row:RawRow,mapping:InternalMapping){return Object.fromEntries((Object.keys(mapping) as Array<keyof ResolvedImportMapping>).flatMap(field=>mapping[field]?[ [field,asText(cell(row,mapping[field]))] ]:[])) as Partial<Record<keyof ResolvedImportMapping,string>>}

function rawSheetFromExcelSnapshot(snapshotInput: unknown): { snapshot: ExcelLiveSnapshot; fileName: string; sheets: RawSheet[] } {
  const snapshot = parseExcelLiveSnapshot(snapshotInput)
  const rows: RawRow[] = snapshot.cells.map((values, index) => ({
    rowNumber: index + 1,
    values: values.map(cell => cell.formula
      ? cell.value === null
        ? { formula: cell.formula }
        : { formula: cell.formula, result: cell.value }
      : cell.value),
  }))
  return {
    snapshot,
    fileName: `${snapshot.workbook.name} · live Excel snapshot`,
    sheets: [{ name: snapshot.worksheet.name, hidden: false, rows, csvIssues: [] }],
  }
}

async function analyzeSheets(sheets: RawSheet[], fileName: string, kind: 'estimate' | 'actual', options:ImportParseOptions={}): Promise<{ lines: EstimateLine[] | ActualLine[]; report: SpreadsheetImportReport; provenance:NormalizedLineProvenance[] }> {
  const worksheet = worksheetAnalysis(sheets,options.worksheet)
  const worksheets = worksheet.analyzed.map(candidate => ({ name: candidate.sheet.name, hidden: candidate.sheet.hidden, plausible: candidate.plausible, selected: candidate === worksheet.selected, headerRow: candidate.header?.rowNumber ?? null, score: candidate.score }))
  const issues: ImportIssue[] = worksheet.analyzed.flatMap(candidate => candidate.sheet.csvIssues)
  if (!worksheet.selected) issues.push({ severity: 'error', code: options.worksheet ? 'worksheet_selection_invalid' : worksheet.analyzed.some(candidate => candidate.plausible && !candidate.sheet.hidden) ? 'worksheet_ambiguous' : 'worksheet_not_usable', message: worksheet.reason })
  if(kind==='actual'&&options.worksheet&&worksheet.analyzed.filter(candidate=>candidate.plausible&&!candidate.sheet.hidden).length>1&&worksheet.analyzed.filter(candidate=>candidate.plausible&&!candidate.sheet.hidden&&/actual|job.?cost|labor|material|equipment|phase|division/i.test(candidate.sheet.name)).length>1){worksheet.selected=undefined;issues.push({severity:'error',code:'multi_sheet_actuals_unsupported',message:'Actual costs appear split across multiple worksheets. Export one consolidated actual-cost worksheet before importing.'})}
  const selected = worksheet.selected; const rawHeader = selected?.header; const headerRow = rawHeader?.rowNumber ?? 0
  const headers = (rawHeader?.values ?? []).map((value, index) => ({ index, header: normalizeHeader(value) })).filter(column => column.header)
  const resolved = resolveMapping(headers, kind, options.mapping)
  for (const ambiguity of resolved.ambiguous) issues.push({ severity: 'error', code: 'ambiguous_mapping', message: `Multiple columns could supply ${ambiguity.field}: ${ambiguity.columns.map(column => `${column.header} (column ${column.index + 1})`).join(', ')}. Keep one authoritative source column.` })
  for (const field of resolved.invalidSelections) issues.push({ severity: 'error', code: 'mapping_selection_invalid', message: `The selected source column for ${field} is not a recognized ${field} candidate in this worksheet.` })
  const explicitlySelectedHeaders = new Set((Object.keys(options.mapping ?? {}) as ImportMappingField[]).flatMap(field => resolved.mapping[field]?.header ? [resolved.mapping[field]!.header] : []))
  const duplicateHeaders = headers.filter((column, index) => headers.findIndex(other => other.header === column.header) !== index && Object.values(resolved.mapping).some(mapped => mapped?.header === column.header) && !explicitlySelectedHeaders.has(column.header))
  if (duplicateHeaders.length) issues.push({ severity: 'error', code: 'duplicate_headers', message: `Duplicate mapped headers are ambiguous: ${[...new Set(duplicateHeaders.map(column => column.header))].join(', ')}.` })
  if ((selected?.score ?? 0) < 2) issues.push({ severity: 'error', code: 'header_not_recognized', message: 'Could not confidently identify a header row. Include description/category plus cost or hours.' })
  if (!resolved.mapping.description && !resolved.mapping.category && !resolved.mapping.costCode && !resolved.mapping.phase && !resolved.mapping.division) issues.push({ severity: 'error', code: 'description_missing', message: 'No description, category, cost-code, division, class, or phase column was detected.' })
  if (!resolved.mapping.cost && !(resolved.mapping.quantity && resolved.mapping.unitCost) && !(resolved.mapping.hours && resolved.mapping.unitCost)) issues.push({ severity: 'error', code: 'cost_missing', message: 'No cost/amount/extension column or usable quantity/rate combination was detected.' })

  const dataRows = selected && rawHeader ? selected.sheet.rows.filter(row => row.rowNumber > rawHeader.rowNumber) : []
  const excludedRows: ExcludedImportRow[] = []; const malformedCells: MalformedImportCell[] = []; const sourceTotals: number[] = []; const lines: Array<EstimateLine | ActualLine> = []; const provenance:NormalizedLineProvenance[]=[]; let cachedFormulaCells = 0
  const numericFields = ['cost', 'hours', 'quantity', 'unitCost'] as const
  for (const row of dataRows) {
    if (!row.values.some(value => asText(value) !== '')) { excludedRows.push({ sourceRow: row.rowNumber, reason: 'blank', description: '' }); continue }
    const headerMatches = headers.filter(column => normalizeHeader(row.values[column.index]) === column.header).length
    if (headerMatches >= 2) { excludedRows.push({ sourceRow: row.rowNumber, reason: 'repeated_header', description: rowDescription(row, resolved.mapping) }); continue }
    const description = asText(cell(row, resolved.mapping.description)); const costCode = asText(cell(row, resolved.mapping.costCode)) || undefined; const phase = asText(cell(row, resolved.mapping.phase)) || undefined; const division = asText(cell(row, resolved.mapping.division)) || undefined
    const rawCategory = asText(cell(row, resolved.mapping.category)) || division || costCode || phase || ''
    const parsed = Object.fromEntries(numericFields.map(field => [field, parseNumber(cell(row, resolved.mapping[field]))])) as Record<typeof numericFields[number], ParsedNumber>
    const invalid = numericFields.flatMap(field => parsed[field].kind === 'invalid' && resolved.mapping[field] ? [{ sourceRow: row.rowNumber, column: resolved.mapping[field]!.header, value: parsed[field].display, reason: parsed[field].reason }] : [])
    if (invalid.length) { malformedCells.push(...invalid); excludedRows.push({ sourceRow: row.rowNumber, reason: 'malformed_numeric', description: description || rawCategory }); continue }
    cachedFormulaCells += numericFields.filter(field => parsed[field].kind === 'valid' && parsed[field].formulaCached).length
    const classification = classifySummary(description, rawCategory)
    if (classification.kind === 'summary') { if (classification.overall && parsed.cost.kind === 'valid') sourceTotals.push(parsed.cost.value); excludedRows.push({ sourceRow: row.rowNumber, reason: 'summary', description: description || rawCategory }); continue }
    if (classification.kind === 'ambiguous') { excludedRows.push({ sourceRow: row.rowNumber, reason: 'ambiguous', description: description || rawCategory }); issues.push({ severity: 'error', code: 'ambiguous_summary_row', message: `Row ${row.rowNumber} looks like a rollup but cannot be classified safely: ${description || rawCategory}.` }); continue }
    if (!numericFields.some(field => parsed[field].kind === 'valid')) { excludedRows.push({ sourceRow: row.rowNumber, reason: description || rawCategory ? 'section_header' : 'unmapped', description: description || rawCategory }); continue }
    const hours = parsed.hours.kind === 'valid' ? parsed.hours.value : undefined; const quantity = parsed.quantity.kind === 'valid' ? parsed.quantity.value : undefined; const unitCost = parsed.unitCost.kind === 'valid' ? parsed.unitCost.value : undefined
    let cost = parsed.cost.kind === 'valid' ? parsed.cost.value : undefined
    if (cost === undefined && unitCost !== undefined && quantity !== undefined) cost = unitCost * quantity
    if (cost === undefined && unitCost !== undefined && hours !== undefined) cost = unitCost * hours
    if (cost === undefined) cost = 0
    const category = categoryFrom(rawCategory || description)
    const lineId=id();const unit=asText(cell(row,resolved.mapping.unit))||undefined;const normalizedUnit=unit?normalizeUnit(unit):undefined
    const decisions=[...(parsed.cost.kind!=='valid'&&unitCost!==undefined&&quantity!==undefined?['cost_from_quantity_times_unit_cost']:[]),...(parsed.cost.kind!=='valid'&&unitCost!==undefined&&quantity===undefined&&hours!==undefined?['cost_from_hours_times_unit_cost']:[]),...numericFields.filter(field=>parsed[field].kind==='valid'&&parsed[field].formulaCached).map(field=>`${field}_from_cached_formula`),...(unit&&normalizedUnit?[`unit_normalized_to_${normalizedUnit}`]:unit?['unit_preserved_unrecognized']:[])]
    if (kind === 'estimate') lines.push({ id: lineId, category, description: description || rawCategory || 'Imported line', estimatedHours: hours, estimatedCost: cost, quantity, unit, normalizedUnit,unitCost,costCode, phase, division })
    else lines.push({ id: lineId, category, description: description || rawCategory || 'Imported actual', actualHours: hours, actualCost: cost,quantity,unit,normalizedUnit,unitCost,costCode, phase, division })
    provenance.push({lineId,worksheet:selected?.sheet.name??'',sourceRow:row.rowNumber,mapping:resolved.mappedColumns,originalValues:originalValues(row,resolved.mapping),normalizationDecisions:decisions,parserVersion:IMPORT_PARSER_VERSION})
  }
  if (!lines.length) issues.push({ severity: 'error', code: 'no_lines', message: 'No usable detail rows were found after classifying blank, summary, section, repeated-header, and malformed rows.' })
  if (malformedCells.length) issues.push({ severity: 'error', code: 'invalid_numbers', message: `${malformedCells.length} mapped numeric cell${malformedCells.length === 1 ? '' : 's'} could not be interpreted. Correct them before import.` })
  const categoryCounts = emptyCategoryCounts(); const categoryTotals = emptyCategoryTotals()
  for (const line of lines) { categoryCounts[line.category] += 1; categoryTotals[line.category].cost += 'estimatedCost' in line ? line.estimatedCost : line.actualCost; categoryTotals[line.category].hours += 'estimatedCost' in line ? line.estimatedHours ?? 0 : line.actualHours ?? 0 }
  const totalCost = lines.reduce((sum, line) => sum + ('estimatedCost' in line ? line.estimatedCost : line.actualCost), 0); const totalHours = lines.reduce((sum, line) => sum + ('estimatedCost' in line ? line.estimatedHours ?? 0 : line.actualHours ?? 0), 0); const totals = reconcileTotals(sourceTotals, totalCost)
  if (totals.conflict) issues.push({ severity: 'error', code: 'conflicting_source_totals', message: 'The worksheet contains conflicting source-reported overall totals.' })
  if (totals.reconciliation.state === 'needs_review') issues.push({ severity: 'warning', code: 'source_total_needs_review', message: `Source-reported total ${totals.reconciliation.sourceReportedTotal} differs from normalized detail total ${totalCost} by ${totals.reconciliation.absoluteDifference}. Confirm the source rounding or correct the export.` })
  if (totals.reconciliation.state === 'failed') issues.push({ severity: 'error', code: 'source_total_mismatch', message: `Source-reported total ${totals.reconciliation.sourceReportedTotal} does not reconcile to normalized detail total ${totalCost}.` })
  if (cachedFormulaCells) issues.push({ severity: 'warning', code: 'formula_cached_value', message: `${cachedFormulaCells} mapped numeric formula cell${cachedFormulaCells === 1 ? '' : 's'} use cached workbook values. Margin Memory does not recalculate Excel formulas; confirm the workbook was recalculated and saved.` })
  if (lines.length && categoryCounts.other / lines.length > 0.5) issues.push({ severity: 'warning', code: 'category_coverage', message: `${categoryCounts.other} of ${lines.length} imported lines map to Other. Add recognizable cost categories before using category comparisons.` })
  if (!resolved.mapping.hours) issues.push({ severity: 'warning', code: 'hours_missing', message: `No ${kind === 'estimate' ? 'estimated' : 'actual'} labor-hours column was detected. Labor-cost comparisons remain available, but labor productivity cannot be evaluated.` })
  if (categoryCounts.labor > 0 && !resolved.mapping.hours) issues.push({ severity: 'warning', code: 'labor_cost_basis', message: 'Labor is represented by cost without hours. Confirm estimate and actual exports use the same loaded or base labor-cost basis.' })
  const commercialRows = dataRows.filter(row => /\b(overhead|markup|profit|tax|bond|contingency|change order)\b/i.test(rowDescription(row, resolved.mapping))).length
  if (commercialRows) issues.push({ severity: 'warning', code: 'commercial_rows', message: `${commercialRows} row${commercialRows === 1 ? '' : 's'} mention commercial or change-order amounts. Confirm whether these costs belong in the comparison.` })
  const negativeLines = lines.filter(line => ('estimatedCost' in line ? line.estimatedCost : line.actualCost) < 0).length
  if (negativeLines) issues.push({ severity: 'warning', code: 'negative_costs', message: `${negativeLines} negative-cost line${negativeLines === 1 ? '' : 's'} will be retained as credits. Confirm the source export uses that convention.` })
  if (selected?.sheet.name === 'CSV' && rawHeader) { const width = rawHeader.values.length; const inconsistent = dataRows.filter(row => row.values.some(value => asText(value) !== '') && row.values.length !== width); if (inconsistent.length) issues.push({ severity: 'error', code: 'inconsistent_columns', message: `CSV rows ${inconsistent.map(row => row.rowNumber).join(', ')} do not have the same column count as the header.` }) }
  const dimensionValues = (field: 'costCode' | 'phase' | 'division') => [...new Set(lines.map(line => line[field]).filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()))]
  const structuredDimensions: StructuredDimensionValues = { costCodes: dimensionValues('costCode'), phases: dimensionValues('phase'), divisions: dimensionValues('division') }
  const report: SpreadsheetImportReport = { kind, fileName, sheetName: selected?.sheet.name ?? '', worksheets, worksheetSelectionRationale: worksheet.reason, headerRow, headers: headers.map(column => column.header), mappedColumns: resolved.mappedColumns, mappedColumnIndexes: resolved.mappedColumnIndexes, mappingCandidates: resolved.mappingCandidates, mappingOptions: resolved.mappingOptions, sourceRows: dataRows.length, importedRows: lines.length, skippedSummaryRows: excludedRows.filter(row => row.reason === 'summary').length, skippedEmptyRows: excludedRows.filter(row => row.reason === 'blank').length, excludedRows, malformedCells, invalidNumericCells: malformedCells.length, categoryCounts, categoryTotals, totalCost, totalHours, sourceReportedTotal: totals.reconciliation.sourceReportedTotal, normalizedDetailTotal: totalCost, totalReconciliation: totals.reconciliation, laborHourCoverage: resolved.mapping.hours ? 'present' : 'absent', structuredDimensions, issues }
  return { lines: (selected ? lines : []) as EstimateLine[] | ActualLine[], report,provenance:selected?provenance:[] }
}

async function analyzeFile(file: File, kind: 'estimate' | 'actual', options:ImportParseOptions={}) {
  return analyzeSheets(await rawSheetsFromFile(file), file.name, kind, options)
}

function throwHardBlockers(issues: ImportIssue[]) { const blockers = issues.filter(issue => issue.severity === 'error'); if (blockers.length) throw new SpreadsheetInputError(blockers.map(issue => issue.message).join(' ')) }
export async function parseEstimateFile(file: File,options:ImportParseOptions={}): Promise<EstimateLine[]> { const parsed = await parseEstimateFileWithReport(file,options); throwHardBlockers(parsed.report.issues); return parsed.lines }
export async function parseActualFile(file: File,options:ImportParseOptions={}): Promise<ActualLine[]> { const parsed = await parseActualFileWithReport(file,options); throwHardBlockers(parsed.report.issues); return parsed.lines }
export async function parseEstimateFileWithReport(file: File,options:ImportParseOptions={}) { const parsed = await analyzeFile(file, 'estimate',options); return { lines: parsed.lines as EstimateLine[], report: parsed.report,provenance:parsed.provenance } }
export async function parseActualFileWithReport(file: File,options:ImportParseOptions={}) { const parsed = await analyzeFile(file, 'actual',options); return { lines: parsed.lines as ActualLine[], report: parsed.report,provenance:parsed.provenance } }
export async function parseEstimateExcelSnapshotWithReport(snapshotInput: unknown) {
  const source = rawSheetFromExcelSnapshot(snapshotInput)
  const parsed = await analyzeSheets(source.sheets, source.fileName, 'estimate', { worksheet: source.snapshot.worksheet.name })
  return { lines: parsed.lines as EstimateLine[], report: parsed.report, provenance: parsed.provenance }
}

export function assessImportPair(estimate: SpreadsheetImportReport, actual: SpreadsheetImportReport): ImportPairReport {
  const issues: ImportIssue[] = [...estimate.issues, ...actual.issues]; const categories = Object.keys(estimate.categoryCounts) as CostCategory[]
  const expected = categories.filter(category => estimate.categoryCounts[category] > 0); const missingActualCategories = expected.filter(category => actual.categoryCounts[category] === 0); const confirmedZeroCategories = expected.filter(category => actual.categoryCounts[category] > 0 && actual.categoryTotals[category].cost === 0 && actual.categoryTotals[category].hours === 0)
  if (missingActualCategories.length) issues.push({ severity: 'warning', code: 'missing_actual_categories', resolution: 'incomplete_actuals', message: `Actuals are missing expected categories: ${missingActualCategories.join(', ')}. Add explicit zero rows, provide the complete final export, or archive the job as unreconciled.` })
  const missingEstimateCategories = categories.filter(category => actual.categoryCounts[category] > 0 && estimate.categoryCounts[category] === 0)
  if (missingEstimateCategories.length) issues.push({ severity: 'warning', code: 'actual_only_categories', message: `Actuals contain categories absent from the estimate: ${missingEstimateCategories.join(', ')}. Confirm these are real omissions rather than mapping differences.` })
  const coverage = (estimateValues: string[], actualValues: string[]) => {
    if (!estimateValues.length) return { state: 'not_applicable' as const, missing: [] as string[] }
    if (!actualValues.length) return { state: 'unavailable' as const, missing: [] as string[] }
    const actualKeys = new Set(actualValues.map(value => value.trim().toLowerCase()))
    const missing = estimateValues.filter(value => !actualKeys.has(value.trim().toLowerCase()))
    return { state: missing.length ? 'incomplete' as const : 'complete' as const, missing }
  }
  const costCodes = coverage(estimate.structuredDimensions.costCodes, actual.structuredDimensions.costCodes)
  const phases = coverage(estimate.structuredDimensions.phases, actual.structuredDimensions.phases)
  const divisions = coverage(estimate.structuredDimensions.divisions, actual.structuredDimensions.divisions)
  const structuredGaps = [costCodes, phases, divisions].some(result => result.state === 'incomplete' || result.state === 'unavailable')
  if (structuredGaps) {
    const details = [
      costCodes.state === 'unavailable' ? 'actual export has no cost-code structure' : costCodes.missing.length ? `missing cost codes: ${costCodes.missing.join(', ')}` : '',
      phases.state === 'unavailable' ? 'actual export has no phase structure' : phases.missing.length ? `missing phases: ${phases.missing.join(', ')}` : '',
      divisions.state === 'unavailable' ? 'actual export has no division structure' : divisions.missing.length ? `missing divisions: ${divisions.missing.join(', ')}` : '',
    ].filter(Boolean)
    issues.push({ severity: 'warning', code: 'incomplete_actual_structure', resolution: 'incomplete_actuals', message: `Actual structural coverage is incomplete (${details.join('; ')}). Provide a complete matching export or archive the job as unreconciled.` })
  }
  if ((estimate.totalHours > 0) !== (actual.totalHours > 0)) issues.push({ severity: 'warning', code: 'hours_not_comparable', message: 'Only one file contains labor hours. Cost variance can be compared, but labor-hour variance cannot.' })
  if (estimate.totalCost > 0 && actual.totalCost > 0) { const ratio = actual.totalCost / estimate.totalCost; if (ratio > 5 || ratio < 0.2) issues.push({ severity: 'warning', code: 'total_scale_mismatch', message: 'Estimate and actual totals differ by more than 5×. Check units, loaded costs, and whether both exports cover the same job scope.' }) }
  issues.push({ severity: 'warning', code: 'actual_completeness_confirmation', resolution: 'actual_completeness', message: 'Confirm this is the final and complete actual-cost export, including all cost categories and posted transactions.' })
  return { issues, requiresReview: issues.some(issue => issue.severity !== 'info'), completeness: { state: missingActualCategories.length || structuredGaps ? 'incomplete' : 'complete', missingActualCategories, confirmedZeroCategories, missingActualCostCodes: costCodes.missing, missingActualPhases: phases.missing, missingActualDivisions: divisions.missing, costCodeCoverage: costCodes.state, phaseCoverage: phases.state, divisionCoverage: divisions.state, requiresExplicitConfirmation: true } }
}

export function assessActualAgainstEstimate(estimateLines: EstimateLine[], actual: SpreadsheetImportReport): ImportPairReport {
  const categoryCounts = emptyCategoryCounts(); const categoryTotals = emptyCategoryTotals(); for (const line of estimateLines) { categoryCounts[line.category] += 1; categoryTotals[line.category].cost += line.estimatedCost; categoryTotals[line.category].hours += line.estimatedHours ?? 0 }
  const total = estimateLines.reduce((sum, line) => sum + line.estimatedCost, 0)
  const values = (field: 'costCode' | 'phase' | 'division') => [...new Set(estimateLines.map(line => line[field]).filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()))]
  const estimate: SpreadsheetImportReport = { kind: 'estimate', fileName: 'Saved estimate', sheetName: 'Saved estimate', worksheets: [], worksheetSelectionRationale: 'Uses the immutable saved estimate.', headerRow: 0, headers: [], mappedColumns: {}, mappingCandidates: {}, sourceRows: estimateLines.length, importedRows: estimateLines.length, skippedSummaryRows: 0, skippedEmptyRows: 0, excludedRows: [], malformedCells: [], invalidNumericCells: 0, categoryCounts, categoryTotals, totalCost: total, totalHours: estimateLines.reduce((sum, line) => sum + (line.estimatedHours ?? 0), 0), sourceReportedTotal: null, normalizedDetailTotal: total, totalReconciliation: { state: 'not_available', sourceReportedTotal: null, absoluteDifference: null, percentageDifference: null, ...reconciliationBase(total) }, laborHourCoverage: estimateLines.some(line => line.estimatedHours !== undefined) ? 'present' : 'absent', structuredDimensions: { costCodes: values('costCode'), phases: values('phase'), divisions: values('division') }, issues: [] }
  return assessImportPair(estimate, actual)
}

export function requireImportApproval(issues: ImportIssue[], reviewed: boolean, resolution: { actualCompletenessConfirmed?: boolean; allowIncompleteActuals?: boolean } = {}) {
  const blockers = issues.filter(issue => issue.severity === 'error'); if (blockers.length) throw new SpreadsheetInputError(blockers.map(issue => issue.message).join(' '))
  const incomplete = issues.filter(issue => issue.resolution === 'incomplete_actuals')
  if (incomplete.length && !resolution.allowIncompleteActuals) throw new SpreadsheetInputError(incomplete.map(issue => issue.message).join(' '))
  if (!resolution.allowIncompleteActuals && issues.some(issue => issue.resolution === 'actual_completeness') && !resolution.actualCompletenessConfirmed) throw new SpreadsheetInputError('Confirm that the actual-cost export is final and complete before importing it.')
  if (issues.some(issue => issue.severity === 'warning' && issue.resolution !== 'actual_completeness') && !reviewed) throw new SpreadsheetInputError('Preview the spreadsheet and confirm the detected limitations before importing.')
}
