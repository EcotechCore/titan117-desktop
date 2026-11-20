/**
 * Reading documents for the folder agent (features 7.2, 7.5; decisions §51):
 * every file becomes a list of pages, each with a label a citation can name
 * ("page 3", "slide 2", "sheet Totals", "section Prices"), so an answer can
 * point at the right file and place. All on the laptop, in Node:
 *
 *   PDF          pdf.js (Apache 2.0), page by page
 *   Word         mammoth (BSD-2), split at headings
 *   Excel        ExcelJS (MIT), one page per sheet, cells as values
 *   PowerPoint   the slides' own XML (fflate, MIT), one page per slide
 *   email        postal-mime (MIT-0)
 *   text         Markdown, CSV and plain text as they are
 *   images       PNG and JPEG photos and scans, through OCR
 *
 * Scanned PDF pages (no text layer) are drawn as images (@napi-rs/canvas,
 * MIT) and read with OCR (7.3, ./ocr.ts). Pages still without text after
 * that are counted.
 */
import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import mammoth from 'mammoth'
import PostalMime from 'postal-mime'
import { pathToFileURL } from 'node:url'

import { recognize } from './ocr'

export interface DocPage {
  /** 1-based position: the PDF page, slide or sheet number. */
  n: number
  /** What a citation says: "page 3", "slide 2", "sheet Totals", "section Prices". */
  label: string
  text: string
}

export interface ParsedDoc {
  title: string
  pages: DocPage[]
  /** Pages with no text at all, even after OCR. */
  emptyPages: number
  /** Pages whose text came from OCR. */
  ocrPages?: number
}

export interface ParseOptions {
  /** Read scanned pages and images with OCR (default true). */
  ocr?: boolean
}

/** At most this many scanned pages are read with OCR per document; the rest are counted. */
export const OCR_PAGE_LIMIT = 100
/** Scanned pages are drawn at this scale (2 is about 144 dots per inch). */
const OCR_SCALE = 2

export const DOC_TYPES = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'eml',
  'md',
  'txt',
  'csv',
  'json',
  'html',
  'htm',
  'png',
  'jpg',
  'jpeg'
] as const

export class DocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentError'
  }
}

export function extensionOf(path: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
}

export function readable(path: string): boolean {
  return (DOC_TYPES as readonly string[]).includes(extensionOf(path))
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** OCR text, tidied, or '' when the image holds none. */
async function ocrText(image: Buffer): Promise<string> {
  return tidy(await recognize(image))
}

async function imagePages(data: Buffer, options: ParseOptions): Promise<ParsedDoc> {
  const text = options.ocr === false ? '' : await ocrText(data)
  return {
    title: '',
    pages: [{ n: 1, label: 'image', text }],
    emptyPages: text ? 0 : 1,
    ocrPages: text ? 1 : 0
  }
}

type NapiCanvas = typeof import('@napi-rs/canvas')

/**
 * pdf.js draws scanned pages on a canvas. It only sets up a Node canvas when
 * it thinks it runs in Node, and Electron's utility process (where the engine
 * runs) doesn't count, so it would reach for a web page's canvas. Here it gets
 * @napi-rs/canvas, and the two drawing helpers it expects (DOMMatrix, Path2D),
 * as it does in Node.
 */
async function nodeCanvas(): Promise<NapiCanvas> {
  const napi = await import('@napi-rs/canvas')
  const g = globalThis as Record<string, unknown>
  g.DOMMatrix ??= napi.DOMMatrix
  g.Path2D ??= napi.Path2D
  return napi
}

/** The same four methods as pdf.js's own Node canvas factory. */
function canvasFactory(napi: NapiCanvas): unknown {
  type Canvas = import('@napi-rs/canvas').Canvas
  type Pair = { canvas: Canvas | null; context: unknown }
  return class {
    create(width: number, height: number): Pair {
      if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
      const canvas = napi.createCanvas(width, height)
      return { canvas, context: canvas.getContext('2d') }
    }
    reset(pair: Pair, width: number, height: number): void {
      if (!pair.canvas) throw new Error('Canvas is not specified')
      if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
      pair.canvas.width = width
      pair.canvas.height = height
    }
    destroy(pair: Pair): void {
      if (!pair.canvas) throw new Error('Canvas is not specified')
      pair.canvas.width = 0
      pair.canvas.height = 0
      pair.canvas = null
      pair.context = null
    }
    getNoAlphaContext(canvas: Canvas): unknown {
      return canvas.getContext('2d', { alpha: false })
    }
  }
}

async function pdfPages(data: Buffer, options: ParseOptions): Promise<ParsedDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const napi = options.ocr === false ? null : await nodeCanvas()
  // Bundled, pdf.js can't find its worker by itself; it runs in this process (Node's "fake worker").
  if (!pdfjs.GlobalWorkerOptions.workerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ).href
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    // No fonts from anywhere: text only.
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    // Drawing scanned pages for OCR, the same in Node and in Electron's utility process.
    ...(napi && {
      CanvasFactory: canvasFactory(napi) as never,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false
    })
  })
  const doc = await task.promise
  const pages: DocPage[] = []
  let emptyPages = 0
  let ocrPages = 0
  let ocrTried = 0
  let title: string
  try {
    const meta = await doc.getMetadata().catch(() => null)
    title = String((meta?.info as { Title?: string } | undefined)?.Title ?? '').trim()
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        text += item.str ?? ''
        text += item.hasEOL ? '\n' : ' '
      }
      text = tidy(text)
      if (!text && napi && ocrTried < OCR_PAGE_LIMIT) {
        // A scan: draw the page and read it.
        ocrTried++
        const viewport = page.getViewport({ scale: OCR_SCALE })
        const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const context = canvas.getContext('2d')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport
        }).promise
        text = await ocrText(canvas.toBuffer('image/png'))
        if (text) ocrPages++
      }
      if (!text) emptyPages++
      pages.push({ n, label: `page ${n}`, text })
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return { title, pages, emptyPages, ocrPages }
}

async function wordPages(data: Buffer): Promise<ParsedDoc> {
  // HTML keeps the headings, which name the sections a citation points at.
  const { value } = await mammoth.convertToHtml({ buffer: data })
  const parts = value.split(/(?=<h[1-3][^>]*>)/).filter((p) => p.replace(/<[^>]+>/g, '').trim())
  const toText = (html: string): string =>
    tidy(
      html
        .replace(/<\/(p|h[1-6]|li|tr)>/g, '\n')
        .replace(/<\/t[dh]>/g, ' | ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    )
  const pages = parts.map((part, i) => {
    const heading = /^<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/.exec(part)?.[1]
    const name = heading ? toText(heading) : ''
    return {
      n: i + 1,
      label: name ? `section "${name.slice(0, 60)}"` : i === 0 ? 'the start' : `part ${i + 1}`,
      text: toText(part)
    }
  })
  return {
    title: '',
    pages: pages.length ? pages : [{ n: 1, label: 'the start', text: '' }],
    emptyPages: 0
  }
}

/** A cell's value as text: results of formulas, dates as dates. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value) return value.richText.map((r) => r.text).join('')
    if ('text' in value) return String(value.text)
    if ('error' in value) return String(value.error)
    return ''
  }
  return String(value)
}

async function excelPages(data: Buffer): Promise<ParsedDoc> {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(data as unknown as ArrayBuffer)
  const pages: DocPage[] = []
  book.worksheets.forEach((sheet, i) => {
    const lines: string[] = []
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (lines.length >= 5000) return
      const cells = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText)
      if (cells.some((c) => c)) lines.push(`${number}: ${cells.join(' | ')}`)
    })
    pages.push({ n: i + 1, label: `sheet "${sheet.name}"`, text: lines.join('\n') })
  })
  return { title: book.title ?? '', pages, emptyPages: 0 }
}

function xmlText(xml: string): string {
  return xml
    .replace(/<\/a:p>/g, '\n')
    .replace(/<a:tab\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function slidesPages(data: Buffer): ParsedDoc {
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => /^ppt\/(slides|notesSlides)\/\w+\.xml$/.test(f.name)
  })
  const slides = Object.keys(files)
    .map((name) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(name))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
  return {
    title: '',
    pages: slides.map((n) => {
      const notes = files[`ppt/notesSlides/notesSlide${n}.xml`]
      return {
        n,
        label: `slide ${n}`,
        text: tidy(
          xmlText(strFromU8(files[`ppt/slides/slide${n}.xml`])) +
            (notes ? `\n\nNotes: ${xmlText(strFromU8(notes))}` : '')
        )
      }
    }),
    emptyPages: 0
  }
}

async function emailPages(data: Buffer): Promise<ParsedDoc> {
  const mail = await PostalMime.parse(data)
  const who = (a?: { name?: string; address?: string }): string =>
    a ? `${a.name ?? ''} <${a.address ?? ''}>`.trim() : ''
  const text =
    mail.text ??
    (mail.html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
  return {
    title: mail.subject ?? '',
    pages: [
      {
        n: 1,
        label: 'the message',
        text: tidy(
          [
            `Subject: ${mail.subject ?? ''}`,
            `From: ${who(mail.from as { name?: string; address?: string } | undefined)}`,
            `Date: ${mail.date ?? ''}`,
            mail.attachments.length
              ? `Attachments: ${mail.attachments.map((a) => a.filename ?? 'file').join(', ')}`
              : '',
            '',
            text
          ]
            .filter((l, i) => l || i === 4)
            .join('\n')
        )
      }
    ],
    emptyPages: 0
  }
}

function textPages(data: Buffer, ext: string): ParsedDoc {
  let text = data.toString('utf8')
  if (ext === 'html' || ext === 'htm')
    text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
  return { title: '', pages: [{ n: 1, label: 'the file', text: tidy(text) }], emptyPages: 0 }
}

/** A document as labelled pages. Throws DocumentError for a type it can't read. */
export async function parseDocument(
  path: string,
  data: Buffer,
  options: ParseOptions = {}
): Promise<ParsedDoc> {
  const ext = extensionOf(path)
  try {
    switch (ext) {
      case 'pdf':
        return await pdfPages(data, options)
      case 'png':
      case 'jpg':
      case 'jpeg':
        return await imagePages(data, options)
      case 'docx':
        return await wordPages(data)
      case 'xlsx':
        return await excelPages(data)
      case 'pptx':
        return slidesPages(data)
      case 'eml':
        return await emailPages(data)
      case 'md':
      case 'txt':
      case 'csv':
      case 'json':
      case 'html':
      case 'htm':
        return textPages(data, ext)
      default:
        throw new DocumentError(`Titan can't read .${ext} files yet.`)
    }
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError(
      `Couldn't read this ${ext.toUpperCase()} file: ${(error as Error).message?.slice(0, 120) ?? 'unknown'}`
    )
  }
}

export interface Chunk {
  page: number
  label: string
  text: string
}

/**
 * Passages small enough to search and cite, never crossing a page, so every
 * passage knows its page. About 1,200 characters with a little overlap.
 */
export function chunkPages(pages: DocPage[], size = 1200, overlap = 150): Chunk[] {
  const out: Chunk[] = []
  for (const page of pages) {
    const text = page.text
    if (!text) continue
    if (text.length <= size) {
      out.push({ page: page.n, label: page.label, text })
      continue
    }
    let start = 0
    while (start < text.length) {
      let end = Math.min(text.length, start + size)
      // Break at a paragraph, a sentence or a space, in that order.
      if (end < text.length) {
        const window = text.slice(start, end)
        const cut = Math.max(
          window.lastIndexOf('\n\n'),
          window.lastIndexOf('. '),
          window.lastIndexOf('\n')
        )
        if (cut > size * 0.5) end = start + cut + 1
        else {
          const space = window.lastIndexOf(' ')
          if (space > size * 0.5) end = start + space
        }
      }
      out.push({ page: page.n, label: page.label, text: text.slice(start, end).trim() })
      if (end >= text.length) break
      start = Math.max(end - overlap, start + 1)
    }
  }
  return out
}
