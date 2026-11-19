// The folder agent (features 7.1-7.8, 5.4; decisions §51): documents read
// page by page, the index, search by words and by meaning, citations with
// file and page, spreadsheet sums, read-only and local-models-only folders.
// The phase 6 check's test set: questions whose right file and page are known.
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Document, HeadingLevel, Packer, Paragraph } from 'docx'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'

import type { Engine } from '../src/engine/lib/engine'
import type { Embedder } from '../src/engine/lib/doc-index'
import { chunkPages, parseDocument } from '../src/engine/lib/documents'
import { querySheet } from '../src/engine/lib/sheets'
import { LOCAL_ONLY_NOTE } from '../src/engine/runtime'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

/** A small, valid PDF with one text line per page (Helvetica), offsets computed. */
export function makePdf(pages: string[][]): Buffer {
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 4 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pages.forEach((lines, i) => {
    const id = pageIds[i]
    const text = lines
      .map((l, j) => `BT /F1 12 Tf 72 ${720 - j * 18} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`)
      .join('\n')
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
    objects[id + 1] = `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out)
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++)
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** A small company's folder: a lease, an offer, sales figures, a deck and an email. */
async function companyFolder(): Promise<string> {
  const dir = tempFolder('titan117-docs-')
  mkdirSync(join(dir, 'Contracts'))
  writeFileSync(
    join(dir, 'Contracts', 'Lease Brasov warehouse.pdf'),
    makePdf([
      [
        'Lease agreement between Ionescu SRL and Atlas Logistic SRL',
        'for the warehouse in Brasov.'
      ],
      [
        'Rent: 4,200 EUR per month, paid by the 5th of each month.',
        'The rent rises with inflation every January.'
      ],
      [
        'Notice period: either party may end the lease with 90 days written notice.',
        'Deposit: two months of rent.'
      ]
    ])
  )
  const offer = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Offer for Miere Buna SRL', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('We propose a new website and a monthly newsletter.'),
          new Paragraph({ text: 'Prices', heading: HeadingLevel.HEADING_2 }),
          new Paragraph('The website costs 3,500 EUR; the newsletter 250 EUR a month.'),
          new Paragraph({ text: 'Delivery', heading: HeadingLevel.HEADING_2 }),
          new Paragraph('The website is delivered in six weeks after the order.')
        ]
      }
    ]
  })
  writeFileSync(join(dir, 'Offer Miere Buna.docx'), await Packer.toBuffer(offer))
  const book = new ExcelJS.Workbook()
  const sales = book.addWorksheet('Sales 2026')
  sales.addRow(['Month', 'Region', 'Amount'])
  for (const [m, r, a] of [
    ['January', 'North', 1200],
    ['January', 'South', 800],
    ['February', 'North', 1500],
    ['February', 'South', 950.5],
    ['March', 'North', 1100]
  ])
    sales.addRow([m, r, a])
  book.addWorksheet('Notes').addRow(['Figures without VAT'])
  writeFileSync(join(dir, 'Sales.xlsx'), Buffer.from(await book.xlsx.writeBuffer()))
  const deck = new PptxGenJS()
  deck.addSlide().addText('Company plan 2027', { x: 1, y: 1, w: 8, h: 1 })
  deck
    .addSlide()
    .addText('Hiring: two developers in spring, one designer in autumn', { x: 1, y: 1, w: 8, h: 1 })
  writeFileSync(
    join(dir, 'Plan 2027.pptx'),
    (await deck.write({ outputType: 'nodebuffer' })) as Buffer
  )
  writeFileSync(
    join(dir, 'Supplier delay.eml'),
    [
      'From: Ana Pop <ana@supplier.example>',
      'To: office@company.example',
      'Subject: Delivery delayed',
      'Date: Mon, 9 Nov 2026 10:00:00 +0200',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'The pallets of honey jars will arrive on 20 November instead of 12 November.'
    ].join('\r\n')
  )
  return dir
}

/** Words to vectors without a model: enough to test the meaning half of the search. */
function fakeEmbedder(): Embedder {
  const vocab = new Map<string, number>()
  return {
    async embed(texts) {
      return texts.map((t) => {
        const v = new Float32Array(64)
        for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
          if (!vocab.has(w)) vocab.set(w, vocab.size % 64)
          v[vocab.get(w)!] += 1
        }
        const n = Math.hypot(...v) || 1
        return v.map((x) => x / n)
      })
    }
  }
}

async function indexed(dir: string, extra: Record<string, unknown> = {}): Promise<Engine> {
  const e = await testEngine({ folder: dir, embedder: fakeEmbedder(), ...extra })
  await call(e, 'PUT', '/v1/documents', { path: dir, indexed: true })
  await until(async () => {
    const [f] = (await call(e, 'GET', '/v1/documents')).body.folders
    return f && !f.progress && f.ok >= 5
  }, 20_000)
  return e
}

describe('reading documents page by page (7.2)', () => {
  it('PDF pages, Word sections, sheets, slides and emails, each with a label to cite', async () => {
    const dir = await companyFolder()
    const pdf = await parseDocument(
      'a.pdf',
      readFileSync(join(dir, 'Contracts', 'Lease Brasov warehouse.pdf'))
    )
    expect(pdf.pages.map((p) => p.label)).toEqual(['page 1', 'page 2', 'page 3'])
    expect(pdf.pages[1].text).toContain('4,200 EUR per month')
    const word = await parseDocument('a.docx', readFileSync(join(dir, 'Offer Miere Buna.docx')))
    expect(word.pages.map((p) => p.label)).toEqual([
      'section "Offer for Miere Buna SRL"',
      'section "Prices"',
      'section "Delivery"'
    ])
    const sheet = await parseDocument('a.xlsx', readFileSync(join(dir, 'Sales.xlsx')))
    expect(sheet.pages.map((p) => p.label)).toEqual(['sheet "Sales 2026"', 'sheet "Notes"'])
    expect(sheet.pages[0].text).toContain('February | South | 950.5')
    const slides = await parseDocument('a.pptx', readFileSync(join(dir, 'Plan 2027.pptx')))
    expect(slides.pages[1]).toMatchObject({ label: 'slide 2' })
    expect(slides.pages[1].text).toContain('two developers')
    const mail = await parseDocument('a.eml', readFileSync(join(dir, 'Supplier delay.eml')))
    expect(mail.title).toBe('Delivery delayed')
    expect(mail.pages[0].text).toContain('20 November')
    await expect(parseDocument('a.xyz', Buffer.from('x'))).rejects.toThrow(/can't read \.xyz/)
  })

  it('passages never cross a page', () => {
    const chunks = chunkPages(
      [
        { n: 1, label: 'page 1', text: 'a '.repeat(2000) },
        { n: 2, label: 'page 2', text: 'short' }
      ],
      500,
      50
    )
    expect(chunks.filter((c) => c.page === 1).length).toBeGreaterThan(3)
    expect(chunks.at(-1)).toEqual({ page: 2, label: 'page 2', text: 'short' })
  })
})

describe('the test set: the right file and page (phase 6 check)', () => {
  const QUESTIONS: [string, string, string][] = [
    [
      'How much is the monthly rent for the Brasov warehouse?',
      'Contracts/Lease Brasov warehouse.pdf',
      'page 2'
    ],
    [
      'What is the notice period to end the lease?',
      'Contracts/Lease Brasov warehouse.pdf',
      'page 3'
    ],
    ['How much does the website cost in the offer?', 'Offer Miere Buna.docx', 'section "Prices"'],
    ['When is the website delivered?', 'Offer Miere Buna.docx', 'section "Delivery"'],
    ['Who do we plan to hire next year?', 'Plan 2027.pptx', 'slide 2'],
    ['When will the honey jars arrive?', 'Supplier delay.eml', 'the message'],
    ['What were sales in the South region?', 'Sales.xlsx', 'sheet "Sales 2026"']
  ]

  it('each question finds its file and page among the first three passages', async () => {
    const dir = await companyFolder()
    engine = await indexed(dir)
    const misses: string[] = []
    for (const [question, file, label] of QUESTIONS) {
      const { hits } = (await call(engine, 'POST', '/v1/documents/search', { query: question }))
        .body
      const rank = hits.findIndex(
        (h: { file: string; label: string }) => h.file === file && h.label === label
      )
      if (rank < 0 || rank > 2)
        misses.push(
          `${question} → ${hits
            .slice(0, 3)
            .map((h: { file: string; label: string }) => `${h.file} ${h.label}`)
            .join(' | ')}`
        )
    }
    expect(misses).toEqual([])
  })
})

describe('the folder agent at work', () => {
  it('a task searches, cites the file and page, and the index follows new files', async () => {
    const dir = await companyFolder()
    const or = scripted([
      { toolCalls: [{ name: 'docs_search', input: { query: 'monthly rent warehouse' } }] },
      {
        toolCalls: [
          { name: 'docs_read', input: { file: 'Contracts/Lease Brasov warehouse.pdf', page: 2 } }
        ]
      },
      { text: 'The rent is 4,200 EUR a month (Lease Brasov warehouse.pdf, page 2).' }
    ])
    engine = await indexed(dir, { fetch: or.fetch })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'What rent do we pay?',
      model: MODEL
    })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 20_000)
    const detail = (await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body
    const tools = detail.messages
      .map((m: { message: { role: string; output?: string } }) => m.message)
      .filter((m: { role: string }) => m.role === 'tool')
    expect(tools[0].output).toContain('Contracts/Lease Brasov warehouse.pdf, page 2')
    expect(tools[1].output).toContain('4,200 EUR per month')
    // Documents are private: the task's next new site would ask first.
    expect(engine.parts.permissions.isLocalOnly(body.task.id)).toBe(false)

    // A new file is picked up by itself (7.1).
    writeFileSync(
      join(dir, 'Insurance.txt'),
      'The warehouse insurance renews on 1 March with Omniasig.'
    )
    await until(async () => {
      const { hits } = (
        await call(engine!, 'POST', '/v1/documents/search', { query: 'insurance renews' })
      ).body
      return hits[0]?.file === 'Insurance.txt'
    }, 15_000)
  })

  it('spreadsheet totals are computed, not guessed (7.6)', async () => {
    const dir = await companyFolder()
    const data = readFileSync(join(dir, 'Sales.xlsx'))
    expect((await querySheet(data, { op: 'sum', column: 'Amount' })).result).toEqual({
      all: 5550.5
    })
    expect(
      (await querySheet(data, { op: 'sum', column: 'amount', groupBy: 'Region' })).result
    ).toEqual({
      North: 3800,
      South: 1750.5
    })
    expect(
      (
        await querySheet(data, {
          op: 'average',
          column: 'Amount',
          where: { column: 'Month', equals: 'january' }
        })
      ).result
    ).toEqual({ all: 1000 })
    await expect(querySheet(data, { op: 'sum', column: 'Profit' })).rejects.toThrow(
      /columns are: Month, Region, Amount/
    )
  })

  it('a document folder is read-only for agents by default (7.8)', async () => {
    const dir = await companyFolder()
    engine = await indexed(dir)
    const taskId = engine.parts.store.createTask({ title: 't', agent: 'Titan', model: MODEL }).id
    const running = engine.parts.permissions.execute(
      { id: 'w1', name: 'write_file', input: { path: 'new.txt', content: 'x' } },
      { taskId, agent: 'Titan', model: MODEL, signal: new AbortController().signal }
    )
    // It asks first (a write); approved, the folder rule still refuses.
    const pending = await until(
      () => engine!.parts.store.listApprovals({ taskId, status: 'pending' })[0]
    )
    engine.parts.permissions.answer(pending.id, 'approve', 'window')
    const outcome = await running
    expect(outcome.status).toBe('refused')
    expect(outcome.output).toMatch(/read-only for agents/)
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    // Turned off by the user: writing works again (with approval).
    await call(engine, 'PUT', '/v1/documents', { path: dir, readOnly: false })
    expect((await call(engine, 'GET', '/v1/documents')).body.folders[0].readOnly).toBe(false)
  })

  it('what comes from a local-models-only folder never reaches a cloud model (7.7)', async () => {
    const dir = await companyFolder()
    const or = scripted([
      { toolCalls: [{ name: 'docs_search', input: { query: 'rent' } }] },
      { text: 'This must never be asked.' }
    ])
    engine = await indexed(dir, { fetch: or.fetch })
    await call(engine, 'PUT', '/v1/documents', { path: dir, localOnly: true })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'What rent do we pay?',
      model: MODEL
    })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 20_000)
    const task = (await call(engine, 'GET', `/v1/tasks/${body.task.id}`)).body.task
    expect(task).toMatchObject({ status: 'stopped', note: LOCAL_ONLY_NOTE })
    // One model call (the one that asked to search); the passages never went to a second.
    expect(or.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(1)
    // It stays so after the run, and after the user writes again.
    await call(engine, 'POST', `/v1/tasks/${body.task.id}/messages`, { text: 'And the deposit?' })
    await until(() => !engine!.parts.runtime.isRunning(body.task.id), 20_000)
    expect(or.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(1)
  })

  it('only allowed folders can be document folders; turning one off empties its index', async () => {
    const dir = await companyFolder()
    engine = await indexed(dir)
    expect(
      (await call(engine, 'PUT', '/v1/documents', { path: tempFolder(), indexed: true })).status
    ).toBe(400)
    await call(engine, 'PUT', '/v1/documents', { path: dir, indexed: false })
    expect(
      (await call(engine, 'POST', '/v1/documents/search', { query: 'rent' })).body.hits
    ).toEqual([])
  })
})
