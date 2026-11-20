// pdf.js treats Electron's utility process (where the engine runs) as a web
// page, not Node; scanned PDFs must still be drawn and read there (7.3).
// This file makes Node look like that process before pdf.js loads.
import { afterAll, expect, it } from 'vitest'

import { stopOcr } from '../src/engine/lib/ocr'
import { scan, scannedPdf } from './scans'

afterAll(() => stopOcr(true))

it('reads a scanned PDF in an Electron utility process', async () => {
  Object.defineProperty(process.versions, 'electron', { value: '44.10.2', configurable: true })
  Object.defineProperty(process, 'type', { value: 'utility', configurable: true })
  try {
    const { parseDocument } = await import('../src/engine/lib/documents')
    const doc = await parseDocument(
      'Lease scan.pdf',
      scannedPdf([scan(['LEASE AGREEMENT', 'Rent 4200 EUR'])])
    )
    expect(doc.ocrPages).toBe(1)
    expect(doc.pages[0].text).toMatch(/LEASE AGREEMENT/)
  } finally {
    delete (process as { type?: string }).type
    delete (process.versions as { electron?: string }).electron
  }
}, 120_000)
