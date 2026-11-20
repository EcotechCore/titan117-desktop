/**
 * OCR for scanned pages and photos of documents (feature 7.3; decisions §51.8).
 *
 * Tesseract.js (Apache 2.0) runs on the laptop in a worker thread. Its
 * English and Romanian language files ship inside the app (decided by the
 * owner on 20 Nov 2026): the "best_int" LSTM models from @tesseract.js-data
 * (MIT), about 4.6 MB together. They're read from disk and handed to the
 * worker as bytes, so Tesseract.js never downloads anything and keeps no cache
 * of its own.
 *
 * One worker, started on first use and stopped after a minute without work,
 * so an idle app doesn't hold its memory.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createWorker, OEM, type Worker } from 'tesseract.js'

export const OCR_LANGUAGES = ['eng', 'ron'] as const
const IDLE_MS = 60_000

let worker: Promise<Worker> | null = null
let idleTimer: NodeJS.Timeout | null = null
let busy = 0

/** The bundled language file for `code`, as bytes (gzip; Tesseract.js unpacks it). */
async function languageData(code: string): Promise<{ code: string; data: Uint8Array }> {
  const dir = dirname(require.resolve(`@tesseract.js-data/${code}/package.json`))
  const data = await readFile(join(dir, '4.0.0_best_int', `${code}.traineddata.gz`))
  return { code, data: new Uint8Array(data) }
}

function start(): Promise<Worker> {
  worker ??= (async () => {
    const langs = await Promise.all(OCR_LANGUAGES.map(languageData))
    return createWorker(langs, OEM.LSTM_ONLY, { cacheMethod: 'none' })
  })().catch((error: unknown) => {
    worker = null
    throw error
  })
  return worker
}

function scheduleStop(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void stopOcr(), IDLE_MS)
  idleTimer.unref?.()
}

/** The text in an image (PNG or JPEG bytes), or '' when none is found. */
export async function recognize(image: Buffer): Promise<string> {
  busy++
  if (idleTimer) clearTimeout(idleTimer)
  try {
    const w = await start()
    const { data } = await w.recognize(image)
    return data.text ?? ''
  } finally {
    busy--
    if (busy === 0) scheduleStop()
  }
}

/** Stop the worker when idle; `force` stops it even mid-page (the engine is closing). */
export async function stopOcr(force = false): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if ((busy > 0 && !force) || !worker) return
  const current = worker
  worker = null
  await (await current.catch(() => null))?.terminate()
}
