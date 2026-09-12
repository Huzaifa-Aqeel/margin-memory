import { z } from 'zod'

export const EXCEL_SOURCE_ADAPTER_VERSION = 'office-js-excel-live-v1'
export const EXCEL_SNAPSHOT_MIME_TYPE = 'application/octet-stream'

const cellValueSchema = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export const excelSnapshotCellSchema = z.strictObject({
  value: cellValueSchema,
  text: z.string().max(100_000),
  formula: z.string().max(100_000).nullable(),
})

export const excelLiveSnapshotSchema = z.strictObject({
  sourceType: z.literal('excel_live_snapshot'),
  adapterVersion: z.literal(EXCEL_SOURCE_ADAPTER_VERSION),
  workbook: z.strictObject({
    name: z.string().trim().min(1).max(240),
    documentUrlHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  worksheet: z.strictObject({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(240),
    visibility: z.literal('visible'),
  }),
  selection: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('used_range'), address: z.string().min(1).max(1_000) }),
    z.strictObject({ kind: z.literal('selection'), address: z.string().min(1).max(1_000) }),
    z.strictObject({ kind: z.literal('table'), address: z.string().min(1).max(1_000), tableId: z.string().min(1).max(512), tableName: z.string().min(1).max(240) }),
  ]),
  rowCount: z.number().int().positive().max(50_000),
  columnCount: z.number().int().positive().max(256),
  cells: z.array(z.array(excelSnapshotCellSchema)).max(50_000),
  capturedAt: z.string().datetime({ offset: true }),
}).superRefine((snapshot, context) => {
  if (snapshot.cells.length !== snapshot.rowCount) context.addIssue({ code: 'custom', path: ['cells'], message: 'Snapshot row count does not match its cell matrix.' })
  if (snapshot.rowCount * snapshot.columnCount > 2_000_000) context.addIssue({ code: 'custom', path: ['cells'], message: 'Snapshot exceeds the 2,000,000 cell limit.' })
  snapshot.cells.forEach((row, index) => {
    if (row.length !== snapshot.columnCount) context.addIssue({ code: 'custom', path: ['cells', index], message: 'Snapshot rows must have a consistent column count.' })
  })
})

export type ExcelLiveSnapshot = z.infer<typeof excelLiveSnapshotSchema>
export type ExcelSnapshotCell = z.infer<typeof excelSnapshotCellSchema>
export type ExcelSourceSelection = ExcelLiveSnapshot['selection']
export type SpreadsheetSourceType = 'xlsx_upload' | 'csv_upload' | 'excel_live_snapshot'

export function parseExcelLiveSnapshot(input: unknown): ExcelLiveSnapshot {
  return excelLiveSnapshotSchema.parse(input)
}

/** Removes URL query/fragment values that Office hosts may refresh without a
 * workbook change. The canonical value is hashed in the task pane and never
 * sent to the server in plaintext. */
export function canonicalWorkbookLocation(input: string): string {
  const value=input.trim()
  if(!value)return''
  try{const url=new URL(value);url.search='';url.hash='';url.hostname=url.hostname.toLowerCase();return url.toString()}
  catch{return value.replaceAll('\\','/').replace(/\/+$/,'')}
}

/**
 * Logical identity includes every field used by server-side spreadsheet
 * interpretation. Capture time and display-only text are retained in the staged
 * artifact but excluded, so a recapture of unchanged source values is stable.
 */
export function canonicalExcelSnapshot(snapshotInput: unknown): string {
  const snapshot = parseExcelLiveSnapshot(snapshotInput)
  return JSON.stringify({
    sourceType: snapshot.sourceType,
    adapterVersion: snapshot.adapterVersion,
    workbookDocumentUrlHash: snapshot.workbook.documentUrlHash,
    worksheet: { id: snapshot.worksheet.id, name: snapshot.worksheet.name },
    selection: snapshot.selection,
    rowCount: snapshot.rowCount,
    columnCount: snapshot.columnCount,
    cells: snapshot.cells.map(row => row.map(cell => ({
      value: typeof cell.value === 'number' && Object.is(cell.value, -0) ? 0 : cell.value,
      formula: cell.formula,
    }))),
  })
}

/** The workbook/range lineage excludes changing cell contents. */
export function canonicalExcelSourceIdentity(snapshotInput: unknown): string {
  const snapshot = parseExcelLiveSnapshot(snapshotInput)
  return JSON.stringify({
    sourceType: snapshot.sourceType,
    adapterVersion: snapshot.adapterVersion,
    workbookDocumentUrlHash: snapshot.workbook.documentUrlHash,
    worksheetId: snapshot.worksheet.id,
    selection: snapshot.selection.kind === 'table'
      ? { kind: snapshot.selection.kind, tableId: snapshot.selection.tableId }
      : snapshot.selection.kind === 'selection'
        ? { kind: snapshot.selection.kind, address: snapshot.selection.address }
        : { kind: snapshot.selection.kind },
  })
}

export function serializeExcelSnapshotArtifact(snapshotInput: unknown): string {
  return JSON.stringify(parseExcelLiveSnapshot(snapshotInput))
}
