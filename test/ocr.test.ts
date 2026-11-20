// OCR for scanned pages and photos (feature 7.3; decisions §51.8): the
// language files ship with the app, nothing is downloaded, and a scanned
// contract is found by its words and cited with the right page.
import { afterAll, describe, expect, it } from 'vitest'
import { statSync } from 'fs'
import { dirname, join } from 'path'

import { parseDocument } from '../src/engine/lib/documents'
import { OCR_LANGUAGES, stopOcr } from '../src/engine/lib/ocr'
import { scan, scannedPdf } from './scans'

afterAll(() => stopOcr(true))

describe('OCR', () => {
  it('reads a scanned PDF page by page, in English and Romanian', async () => {
    const pdf = scannedPdf([
      scan(['LEASE AGREEMENT', 'Warehouse in Brasov', 'Monthly rent: 4200 EUR']),
      scan(['Contract de furnizare', 'Termen de plata: 30 de zile'])
    ])
    const doc = await parseDocument('Lease scan.pdf', pdf)
    expect(doc.pages).toHaveLength(2)
    expect(doc.ocrPages).toBe(2)
    expect(doc.emptyPages).toBe(0)
    expect(doc.pages[0].text).toMatch(/LEASE AGREEMENT/)
    expect(doc.pages[0].text).toMatch(/4200/)
    expect(doc.pages[0].label).toBe('page 1')
    expect(doc.pages[1].text).toMatch(/furnizare/i)
    expect(doc.pages[1].text).toMatch(/30 de zile/)
  }, 120_000)

  it('reads a photo of a document', async () => {
    const doc = await parseDocument(
      'Receipt.jpg',
      scan(['INVOICE 2027-118', 'Total due: 990 RON']).jpeg
    )
    expect(doc.pages[0].label).toBe('image')
    expect(doc.pages[0].text).toMatch(/INVOICE/)
    expect(doc.pages[0].text).toMatch(/990/)
  }, 60_000)

  it('counts a blank scan as a page without text, and skips OCR when asked', async () => {
    const blank = scannedPdf([scan([])])
    const doc = await parseDocument('Blank.pdf', blank)
    expect(doc.emptyPages).toBe(1)
    expect(doc.ocrPages).toBe(0)
    const skipped = await parseDocument('Lease scan.pdf', scannedPdf([scan(['LEASE'])]), {
      ocr: false
    })
    expect(skipped.emptyPages).toBe(1)
  }, 60_000)

  it('uses the language files shipped with the app', () => {
    // They're read from disk and handed to Tesseract.js as bytes (ocr.ts), so it
    // has no address to download from; these are the files the installer carries.
    for (const code of OCR_LANGUAGES) {
      const dir = dirname(require.resolve(`@tesseract.js-data/${code}/package.json`))
      const file = join(dir, '4.0.0_best_int', `${code}.traineddata.gz`)
      expect(statSync(file).size).toBeGreaterThan(1_000_000)
    }
  })
})
