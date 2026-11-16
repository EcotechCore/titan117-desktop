/**
 * Real calculations on spreadsheets (feature 7.6, decisions §51): the numbers
 * are computed from the cells, never guessed by the model. One sheet, one
 * column, an optional filter and grouping; sum, average, count, min, max.
 */
import ExcelJS from 'exceljs'

export class SheetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetError'
  }
}

export type SheetOp = 'sum' | 'average' | 'count' | 'min' | 'max' | 'list'

export interface SheetQuery {
  sheet?: string
  /** The header of the column to calculate on (not needed for count). */
  column?: string
  op: SheetOp
  /** Only rows where this column equals this value (case and spaces ignored). */
  where?: { column: string; equals: string }
  /** One result per value of this column. */
  groupBy?: string
}

function value(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('result' in v) return value(v.result as ExcelJS.CellValue)
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    if ('text' in v) return String(v.text)
    return null
  }
  const n = Number(
    String(v)
      .replace(/[\s\u00a0]/g, '')
      .replace(/,(?=\d{3}\b)/g, '')
  )
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(n) ? n : String(v)
}

const norm = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .toLowerCase()

export async function querySheet(
  data: Buffer,
  q: SheetQuery
): Promise<{ sheet: string; rows: number; result: Record<string, number | string[]> }> {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(data as unknown as ArrayBuffer)
  const sheet = q.sheet
    ? book.worksheets.find((s) => norm(s.name) === norm(q.sheet))
    : book.worksheets[0]
  if (!sheet)
    throw new SheetError(
      `No sheet "${q.sheet}". The sheets are: ${book.worksheets.map((s) => s.name).join(', ')}.`
    )
  // The first row with text is the header.
  let headerRow = 1
  let headers: string[] = []
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const cells = (sheet.getRow(r).values as ExcelJS.CellValue[])
      .slice(1)
      .map((v) => String(value(v) ?? ''))
    if (cells.filter((c) => c && Number.isNaN(Number(c))).length >= 1) {
      headerRow = r
      headers = cells
      break
    }
  }
  const col = (name: string | undefined, what: string): number => {
    const i = headers.findIndex((h) => norm(h) === norm(name))
    if (i < 0)
      throw new SheetError(
        `No column "${name}" (${what}). The columns are: ${headers.filter(Boolean).join(', ')}.`
      )
    return i
  }
  const target = q.op === 'count' && !q.column ? -1 : col(q.column, 'to calculate')
  const whereCol = q.where ? col(q.where.column, 'to filter by') : -1
  const groupCol = q.groupBy ? col(q.groupBy, 'to group by') : -1

  const groups = new Map<string, (string | number | null)[]>()
  let rows = 0
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const cells = (sheet.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(value)
    if (cells.every((c) => c === null || c === '')) continue
    if (q.where && norm(cells[whereCol]) !== norm(q.where.equals)) continue
    rows++
    const key = groupCol >= 0 ? String(cells[groupCol] ?? '(empty)') : 'all'
    const list = groups.get(key) ?? []
    list.push(target >= 0 ? cells[target] : 1)
    groups.set(key, list)
  }
  const result: Record<string, number | string[]> = {}
  for (const [key, list] of groups) {
    const numbers = list.filter((v): v is number => typeof v === 'number')
    const sum = numbers.reduce((a, b) => a + b, 0)
    result[key] =
      q.op === 'sum'
        ? Math.round(sum * 100) / 100
        : q.op === 'average'
          ? numbers.length
            ? Math.round((sum / numbers.length) * 100) / 100
            : 0
          : q.op === 'count'
            ? list.filter((v) => v !== null && v !== '').length
            : q.op === 'min'
              ? Math.min(...numbers)
              : q.op === 'max'
                ? Math.max(...numbers)
                : list.slice(0, 200).map((v) => String(v ?? ''))
  }
  return { sheet: sheet.name, rows, result }
}
