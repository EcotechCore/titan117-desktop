// Scanned pages for the OCR tests (7.3): pictures of text, and PDFs made only of them.
import { createCanvas } from '@napi-rs/canvas'

/** A picture of text, as a scanner or a phone camera would make it (JPEG). */
export function scan(lines: string[]): { jpeg: Buffer; width: number; height: number } {
  const width = 1240
  const height = 1754
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111111'
  ctx.font = '44px sans-serif'
  lines.forEach((line, i) => ctx.fillText(line, 120, 200 + i * 80))
  return { jpeg: canvas.toBuffer('image/jpeg', 92), width, height }
}

/** A PDF whose pages are only images (a scan, no text layer), offsets computed. */
export function scannedPdf(pages: { jpeg: Buffer; width: number; height: number }[]): Buffer {
  const parts: Buffer[] = []
  const offsets: number[] = []
  let length = 0
  const push = (b: Buffer | string): void => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b
    parts.push(buf)
    length += buf.length
  }
  const ids = pages.map((_, i) => 3 + i * 3)
  const objects: (Buffer | string)[][] = []
  objects[1] = ['<< /Type /Catalog /Pages 2 0 R >>']
  objects[2] = [
    `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  ]
  pages.forEach((p, i) => {
    const id = ids[i]
    const draw = `q 612 0 0 792 0 0 cm /Im0 Do Q`
    objects[id] = [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`
    ]
    objects[id + 1] = [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]
    objects[id + 2] = [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream'
    ]
  })
  push('%PDF-1.4\n')
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    objects[id].forEach(push)
    push('\nendobj\n')
  }
  const xref = length
  push(`xref\n0 ${objects.length}\n0000000000 65535 f \n`)
  for (let id = 1; id < objects.length; id++)
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(parts)
}
