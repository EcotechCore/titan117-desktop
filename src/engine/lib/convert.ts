/**
 * Downloads converted on the laptop (features 17.8, 17.19, 17.23; decisions
 * §44): real, editable files. Word with docx (MIT): real headings, lists,
 * tables and links. Excel with ExcelJS (MIT): real cells and numbers.
 * PowerPoint with PptxGenJS (MIT): editable text boxes. PDF and PNG are
 * printed by the app's own Chromium in the shell (src/main/export.ts).
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import ExcelJS from 'exceljs'
import { marked, type Token, type Tokens } from 'marked'
import PptxGenJS from 'pptxgenjs'
import { zipSync } from 'fflate'

import { artifactHtml, splitSlides } from '../../shared/artifact-html'
import type { ArtifactKind } from '../../shared/protocol'
import { parseChart, parseSheet, type SheetData } from '../artifacts'

export type ExportFormat = 'md' | 'html' | 'txt' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'mmd' | 'json'

/** Which formats fit which artifact (the table under 17.8). PDF and PNG come from the shell. */
export const FORMATS: Record<ArtifactKind, ExportFormat[]> = {
  // A document's Excel file holds its tables and its sources, one sheet each (the phase 4 check).
  document: ['docx', 'xlsx', 'md', 'html', 'txt'],
  page: ['html', 'txt'],
  spreadsheet: ['xlsx', 'csv', 'html'],
  chart: ['xlsx', 'csv', 'html', 'json'],
  diagram: ['mmd', 'html'],
  slides: ['pptx', 'md', 'html']
}

const MIME: Record<ExportFormat, string> = {
  md: 'text/markdown',
  html: 'text/html',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mmd: 'text/plain',
  json: 'application/json'
}

export class ConvertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConvertError'
  }
}

/** A file name from the title (17.20): letters, digits, spaces and dashes. */
export function fileName(title: string, format: string): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Artifact'
  return `${base}.${format}`
}

// ----------------------------------------------------------------- Markdown

/** Inline Markdown as Word runs: bold, italic, code and links kept. */
function runs(
  tokens: Token[] | undefined,
  style: { bold?: boolean; italics?: boolean } = {}
): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...runs((t as Tokens.Strong).tokens, { ...style, bold: true }))
        break
      case 'em':
        out.push(...runs((t as Tokens.Em).tokens, { ...style, italics: true }))
        break
      case 'codespan':
        out.push(
          new TextRun({ text: unescape((t as Tokens.Codespan).text), font: 'Consolas', ...style })
        )
        break
      case 'link': {
        const link = t as Tokens.Link
        if (/^https?:\/\//.test(link.href))
          out.push(
            new ExternalHyperlink({
              link: link.href,
              children: [new TextRun({ text: link.text, style: 'Hyperlink', ...style })]
            })
          )
        else out.push(new TextRun({ text: link.text, ...style }))
        break
      }
      case 'br':
        out.push(new TextRun({ text: '', break: 1 }))
        break
      case 'text': {
        const text = t as Tokens.Text
        if (text.tokens?.length) out.push(...runs(text.tokens, style))
        else out.push(new TextRun({ text: unescape(text.text), ...style }))
        break
      }
      default:
        if ('text' in t && typeof t.text === 'string')
          out.push(new TextRun({ text: unescape(t.text), ...style }))
    }
  }
  return out
}

function unescape(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
]

function blocks(tokens: Token[], depth = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        out.push(new Paragraph({ heading: HEADINGS[h.depth - 1], children: runs(h.tokens) }))
        break
      }
      case 'paragraph':
        out.push(new Paragraph({ children: runs((t as Tokens.Paragraph).tokens) }))
        break
      case 'list': {
        const list = t as Tokens.List
        for (const item of list.items) {
          const [first, ...rest] = item.tokens
          const inline = first && (first.type === 'text' || first.type === 'paragraph')
          out.push(
            new Paragraph({
              ...(list.ordered
                ? { numbering: { reference: 'numbers', level: Math.min(depth, 8) } }
                : { bullet: { level: Math.min(depth, 8) } }),
              children: inline ? runs((first as Tokens.Text).tokens ?? [first]) : []
            })
          )
          out.push(...blocks(inline ? rest : item.tokens, depth + 1))
        }
        break
      }
      case 'table': {
        const table = t as Tokens.Table
        const cell = (c: Tokens.TableCell, header: boolean): TableCell =>
          new TableCell({
            children: [new Paragraph({ children: runs(c.tokens, header ? { bold: true } : {}) })],
            ...(header
              ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } }
              : {})
          })
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ tableHeader: true, children: table.header.map((c) => cell(c, true)) }),
              ...table.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))
            ]
          })
        )
        out.push(new Paragraph({ children: [] }))
        break
      }
      case 'code':
        for (const line of (t as Tokens.Code).text.split('\n'))
          out.push(
            new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 19 })] })
          )
        break
      case 'blockquote':
        for (const p of blocks((t as Tokens.Blockquote).tokens, depth))
          out.push(p instanceof Paragraph ? p : p)
        break
      case 'hr':
        out.push(new Paragraph({ thematicBreak: true, children: [] }))
        break
      case 'html':
        // Raw HTML in a document is shown as its text.
        out.push(
          new Paragraph({
            children: [new TextRun((t as Tokens.HTML).text.replace(/<[^>]+>/g, ''))]
          })
        )
        break
      default:
        break
    }
  }
  return out
}

export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const doc = new Document({
    title,
    creator: 'Titan117',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: []
    },
    numbering: {
      config: [
        {
          reference: 'numbers',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } }
          }))
        }
      ]
    },
    sections: [{ children: blocks(marked.lexer(markdown)) }]
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

/** Plain text: Markdown with its marks removed. */
export function markdownToText(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string
  return unescape(
    html
      .replace(/<\/(p|h[1-6]|li|tr|blockquote|pre)>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<\/t[dh]>/g, '\t')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ----------------------------------------------------------------- tables

function chartAsSheet(content: string): SheetData {
  const chart = parseChart(content)
  return {
    columns: ['', ...chart.series.map((s) => s.name)],
    rows: chart.labels.map((label, i) => [label, ...chart.series.map((s) => s.values[i] ?? null)])
  }
}

function sheetName(title: string, taken: Set<string>): string {
  const base =
    title
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 28) || 'Sheet'
  let name = base
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`
  taken.add(name.toLowerCase())
  return name
}

function addSheet(book: ExcelJS.Workbook, data: SheetData, name: string): void {
  const sheet = book.addWorksheet(name)
  sheet.addRow(data.columns)
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  for (const row of data.rows) {
    // A cell that starts with "=" is a formula (17.19); everything else is a value.
    sheet.addRow(
      row.map((cell) =>
        typeof cell === 'string' && /^=[A-Z(]/.test(cell) ? { formula: cell.slice(1) } : cell
      )
    )
  }
  sheet.columns.forEach((column, i) => {
    const width = Math.max(
      String(data.columns[i] ?? '').length,
      ...data.rows.slice(0, 200).map((r) => String(r[i] ?? '').length)
    )
    column.width = Math.min(60, Math.max(8, width + 2))
  })
}

export async function sheetToXlsx(data: SheetData, title: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  book.creator = 'Titan117'
  addSheet(book, data, sheetName(title, new Set()))
  return Buffer.from(await book.xlsx.writeBuffer())
}

function cellValue(text: string): string | number {
  const plain = unescape(text)
    .replace(/\*\*|__|`/g, '')
    .trim()
  const number = plain.replace(/[\s,]/g, '')
  return /^-?\d+(\.\d+)?$/.test(number) && number.length < 16 ? Number(number) : plain
}

/** A document's tables, one sheet each, and every link it cites on a "Sources" sheet. */
export async function documentToXlsx(markdown: string, title: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  book.creator = 'Titan117'
  const taken = new Set<string>()
  const tokens = marked.lexer(markdown)
  let lastHeading = title
  let tables = 0
  const sources: SheetData = { columns: ['#', 'Title', 'Address'], rows: [] }
  const seen = new Set<string>()
  const walk = (list: Token[]): void => {
    for (const t of list) {
      if (t.type === 'heading') lastHeading = (t as Tokens.Heading).text
      if (t.type === 'table') {
        const table = t as Tokens.Table
        tables++
        addSheet(
          book,
          {
            columns: table.header.map((c) => unescape(c.text)),
            rows: table.rows.map((r) => r.map((c) => cellValue(c.text)))
          },
          sheetName(lastHeading, taken)
        )
      }
      if (t.type === 'link') {
        const link = t as Tokens.Link
        if (/^https?:\/\//.test(link.href) && !seen.has(link.href)) {
          seen.add(link.href)
          sources.rows.push([sources.rows.length + 1, unescape(link.text), link.href])
        }
      }
      const children = (t as { tokens?: Token[] }).tokens
      if (children) walk(children)
      if (t.type === 'list') for (const item of (t as Tokens.List).items) walk(item.tokens)
      if (t.type === 'table') {
        const table = t as Tokens.Table
        for (const c of [...table.header, ...table.rows.flat()]) walk(c.tokens)
      }
    }
  }
  walk(tokens)
  if (sources.rows.length) addSheet(book, sources, sheetName('Sources', taken))
  if (!tables && !sources.rows.length)
    addSheet(
      book,
      {
        columns: ['Text'],
        rows: markdownToText(markdown)
          .split('\n')
          .filter(Boolean)
          .map((l) => [l])
      },
      sheetName(title, taken)
    )
  return Buffer.from(await book.xlsx.writeBuffer())
}

export function sheetToCsv(data: SheetData): string {
  const cell = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value)
    // Quoted when needed; a leading =, +, - or @ is defused so a spreadsheet won't run it.
    const safe = /^[=+\-@]/.test(text) && typeof value === 'string' ? `'${text}` : text
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return [data.columns, ...data.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

// ----------------------------------------------------------------- slides

export async function slidesToPptx(markdown: string, title: string): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = title
  pptx.author = 'Titan117'
  for (const source of splitSlides(markdown)) {
    const slide = pptx.addSlide()
    const tokens = marked.lexer(source)
    const heading = tokens.find((t) => t.type === 'heading') as Tokens.Heading | undefined
    if (heading)
      slide.addText(heading.text, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 1,
        fontSize: 30,
        bold: true,
        color: '141414'
      })
    const body: PptxGenJS.TextProps[] = []
    for (const t of tokens) {
      if (t === heading || t.type === 'space') continue
      if (t.type === 'list')
        for (const item of (t as Tokens.List).items)
          body.push({ text: item.text, options: { bullet: true, breakLine: true } })
      else if (t.type === 'paragraph' || t.type === 'heading' || t.type === 'code')
        body.push({
          text: markdownToText((t as Tokens.Paragraph).raw),
          options: { breakLine: true }
        })
      else if (t.type === 'table') {
        const table = t as Tokens.Table
        slide.addTable(
          [
            table.header.map((c) => ({
              text: c.text,
              options: { bold: true, fill: { color: 'F2F2F2' } }
            })),
            ...table.rows.map((r) => r.map((c) => ({ text: c.text })))
          ],
          {
            x: 0.6,
            y: 1.6,
            w: 12.1,
            fontSize: 14,
            border: { type: 'solid', color: 'DDDDDD', pt: 1 }
          }
        )
      }
    }
    if (body.length)
      slide.addText(body, {
        x: 0.6,
        y: heading ? 1.5 : 0.6,
        w: 12.1,
        h: 5.4,
        fontSize: 18,
        valign: 'top',
        color: '262626'
      })
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}

// ----------------------------------------------------------------- one entry

export async function convert(
  artifact: { kind: ArtifactKind; title: string },
  content: string,
  format: ExportFormat
): Promise<{ name: string; mime: string; data: Buffer }> {
  if (!FORMATS[artifact.kind].includes(format))
    throw new ConvertError(`A ${artifact.kind} can't be downloaded as .${format}.`)
  const done = (data: Buffer | string): { name: string; mime: string; data: Buffer } => ({
    name: fileName(artifact.title, format),
    mime: MIME[format],
    data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  })
  switch (format) {
    case 'html':
      return done(artifactHtml(artifact, content))
    case 'md':
    case 'mmd':
    case 'json':
      return done(content)
    case 'txt':
      return done(
        artifact.kind === 'page'
          ? content
              .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+\n/g, '\n')
          : markdownToText(content)
      )
    case 'docx':
      return done(await markdownToDocx(content, artifact.title))
    case 'pptx':
      return done(await slidesToPptx(content, artifact.title))
    case 'xlsx':
      if (artifact.kind === 'document') return done(await documentToXlsx(content, artifact.title))
      return done(
        await sheetToXlsx(
          artifact.kind === 'chart' ? chartAsSheet(content) : parseSheet(content),
          artifact.title
        )
      )
    case 'csv':
      return done(
        sheetToCsv(artifact.kind === 'chart' ? chartAsSheet(content) : parseSheet(content))
      )
  }
}

/** The first format in each kind's list: what "best format" means in a ZIP. */
export const BEST: Record<ArtifactKind, ExportFormat> = {
  document: 'docx',
  page: 'html',
  spreadsheet: 'xlsx',
  chart: 'xlsx',
  diagram: 'mmd',
  slides: 'pptx'
}

/**
 * Several artifacts, or one in several formats, as one ZIP (features 17.21,
 * 17.22): `every` puts each in every format that fits; otherwise its best one.
 * Each artifact gets its own folder; an older version says so in its name.
 */
export async function zipArtifacts(
  items: { artifact: { kind: ArtifactKind; title: string }; content: string; version?: number }[],
  every: boolean
): Promise<Buffer> {
  const files: Record<string, Uint8Array> = {}
  const folders = new Set<string>()
  for (const item of items) {
    let folder = fileName(item.artifact.title, '').replace(/\.$/, '')
    for (let n = 2; folders.has(folder.toLowerCase()); n++)
      folder = `${fileName(item.artifact.title, '').replace(/\.$/, '')} ${n}`
    folders.add(folder.toLowerCase())
    const formats = every ? FORMATS[item.artifact.kind] : [BEST[item.artifact.kind]]
    for (const format of formats) {
      const file = await convert(item.artifact, item.content, format)
      const name = item.version
        ? file.name.replace(/(\.[a-z]+)$/, ` v${item.version}$1`)
        : file.name
      files[`${folder}/${name}`] = new Uint8Array(file.data)
    }
  }
  return Buffer.from(zipSync(files, { level: 6 }))
}
