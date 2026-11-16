/**
 * One self-contained HTML page for any artifact (decisions §44): what the
 * panel shows in its sandbox, what PDF and PNG are printed from, and what a
 * share link holds. No outside scripts, fonts or images: everything inline,
 * so it works offline and in a sandbox with no network.
 *
 * Pure: used by the window and the engine alike. Diagrams need Mermaid,
 * which only the window has; the engine gets the Mermaid source instead.
 */
import { marked } from 'marked'

import type { ArtifactKind } from './protocol'

export interface RenderOptions {
  theme?: 'light' | 'dark'
  /** For printing (17.20). */
  pageSize?: 'A4' | 'Letter'
  /** A diagram already drawn by Mermaid in the window. */
  diagramSvg?: string
  /** Brand colours and name (17.11), when the user set a brand kit. */
  brand?: { accent?: string; name?: string }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The content policy every artifact page carries: no network at all (17.18). */
export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'"

const PALETTE = [
  '#ff6347',
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#db2777',
  '#65a30d'
]

function styles(options: RenderOptions): string {
  const dark = options.theme === 'dark'
  const accent = /^#[0-9a-f]{6}$/i.test(options.brand?.accent ?? '')
    ? options.brand!.accent!
    : '#ff6347'
  return `
:root{--bg:${dark ? '#111111' : '#ffffff'};--fg:${dark ? '#f2f2f2' : '#141414'};--muted:${dark ? '#a3a3a3' : '#5f5f5f'};--line:${dark ? '#2a2a2a' : '#e5e5e5'};--soft:${dark ? '#1a1a1a' : '#f6f6f6'};--accent:${accent};color-scheme:${dark ? 'dark' : 'light'}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:32px 40px;max-width:900px;margin:0 auto}
h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em}
h1{font-size:1.9em;margin-top:0}h2{font-size:1.4em;border-bottom:1px solid var(--line);padding-bottom:.25em}h3{font-size:1.15em}
a{color:var(--accent)}
p,ul,ol,table,pre,blockquote{margin:0 0 1em}
table{border-collapse:collapse;width:100%;font-size:.93em}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600}
code{font:.9em ui-monospace,Consolas,monospace;background:var(--soft);padding:1px 4px;border-radius:4px}
pre{background:var(--soft);padding:12px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:14px;color:var(--muted)}
img{max-width:100%}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.meta{color:var(--muted);font-size:.85em;margin-top:2em}
.sheet td.n{text-align:right;font-variant-numeric:tabular-nums}
.chart svg,.diagram svg{max-width:100%;height:auto}
.slide{min-height:60vh;border:1px solid var(--line);border-radius:12px;padding:40px 48px;margin:0 0 24px;display:flex;flex-direction:column;justify-content:center}
.slide h1{font-size:2.2em}.slide h2{border:0;font-size:1.7em}
@page{size:${options.pageSize ?? 'A4'};margin:18mm}
@media print{body{padding:0;max-width:none}.slide{break-after:page;border:0;min-height:auto;padding:0;margin:0}a{color:inherit}}`
}

function page(title: string, body: string, options: RenderOptions, extraHead = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles(options)}</style>${extraHead}
</head><body>
${body}
</body></html>`
}

/** Markdown to HTML. Links open outside (the sandbox can't navigate the app). */
export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true }) as string
  return html.replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=')
}

interface Sheet {
  columns: string[]
  rows: (string | number | boolean | null)[][]
}

function sheetHtml(data: Sheet): string {
  const head = data.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  const rows = data.rows
    .map(
      (row) =>
        `<tr>${data.columns
          .map((_c, i) => {
            const cell = row[i]
            const numeric = typeof cell === 'number'
            return `<td${numeric ? ' class="n"' : ''}>${cell === null || cell === undefined ? '' : escapeHtml(String(cell))}</td>`
          })
          .join('')}</tr>`
    )
    .join('')
  return `<table class="sheet"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

interface Chart {
  type: 'bar' | 'line' | 'area' | 'pie'
  title?: string
  unit?: string
  labels: string[]
  series: { name: string; values: number[] }[]
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power
  return 10 * power
}

function formatNumber(n: number): string {
  return Math.abs(n) >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : String(+n.toFixed(2))
}

/** A chart as SVG: bar, line, area or pie. Live data, not a picture (17.4). */
export function chartSvg(chart: Chart, options: RenderOptions = {}): string {
  const dark = options.theme === 'dark'
  const ink = dark ? '#e5e5e5' : '#262626'
  const grid = dark ? '#333333' : '#e5e5e5'
  const W = 760
  const H = 420
  const legend = chart.series
    .map(
      (s, i) =>
        `<g transform="translate(${60 + i * 150},${H - 14})"><rect width="12" height="12" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="18" y="11" font-size="12" fill="${ink}">${escapeHtml(s.name.slice(0, 18))}</text></g>`
    )
    .join('')
  const head = chart.title
    ? `<text x="${W / 2}" y="22" text-anchor="middle" font-size="16" font-weight="600" fill="${ink}">${escapeHtml(chart.title)}</text>`
    : ''

  if (chart.type === 'pie') {
    const values = chart.series[0]?.values ?? []
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    let angle = -Math.PI / 2
    const cx = W / 2
    const cy = 205
    const r = 150
    const slices = values
      .map((v, i) => {
        const share = Math.max(0, v) / total
        const end = angle + share * Math.PI * 2
        const large = share > 0.5 ? 1 : 0
        const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
        const [x2, y2] = [cx + r * Math.cos(end), cy + r * Math.sin(end)]
        const mid = (angle + end) / 2
        const label = `${escapeHtml((chart.labels[i] ?? '').slice(0, 24))} ${Math.round(share * 100)}%`
        const path =
          share >= 0.9999
            ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % PALETTE.length]}"/>`
            : `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="${dark ? '#111' : '#fff'}" stroke-width="2"/>`
        const lx = cx + (r + 24) * Math.cos(mid)
        const ly = cy + (r + 24) * Math.sin(mid)
        angle = end
        return `${path}<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="12" fill="${ink}" text-anchor="${Math.cos(mid) >= 0 ? 'start' : 'end'}">${label}</text>`
      })
      .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(chart.title ?? 'Chart')}" font-family="system-ui,sans-serif">${head}${slices}</svg>`
  }

  const left = 64
  const right = 20
  const top = chart.title ? 44 : 20
  const bottom = 72
  const plotW = W - left - right
  const plotH = H - top - bottom
  const all = chart.series.flatMap((s) => s.values)
  const max = niceMax(Math.max(0, ...all))
  const min = Math.min(0, ...all)
  const span = max - min || 1
  const y = (v: number): number => top + plotH - ((v - min) / span) * plotH
  const n = Math.max(1, chart.labels.length)
  const band = plotW / n
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
  const axis = ticks
    .map(
      (t) =>
        `<line x1="${left}" x2="${W - right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${grid}"/><text x="${left - 8}" y="${(y(t) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${ink}">${formatNumber(t)}${chart.unit ? escapeHtml(chart.unit) : ''}</text>`
    )
    .join('')
  const labels = chart.labels
    .map(
      (l, i) =>
        `<text x="${(left + band * i + band / 2).toFixed(1)}" y="${top + plotH + 18}" font-size="11" text-anchor="middle" fill="${ink}">${escapeHtml(l.slice(0, 14))}</text>`
    )
    .join('')
  let marks = ''
  if (chart.type === 'bar') {
    const groups = chart.series.length
    const barW = (band * 0.75) / groups
    chart.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = left + band * i + band * 0.125 + barW * si
        const y0 = y(Math.max(0, v))
        const h = Math.abs(y(v) - y(0))
        marks += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${PALETTE[si % PALETTE.length]}"><title>${escapeHtml(`${s.name}, ${chart.labels[i] ?? ''}: ${formatNumber(v)}`)}</title></rect>`
      })
    })
  } else {
    chart.series.forEach((s, si) => {
      const points = s.values.map(
        (v, i) => `${(left + band * i + band / 2).toFixed(1)},${y(v).toFixed(1)}`
      )
      const colour = PALETTE[si % PALETTE.length]
      if (chart.type === 'area' && points.length)
        marks += `<polygon points="${left + band / 2},${y(0)} ${points.join(' ')} ${(left + band * (s.values.length - 1) + band / 2).toFixed(1)},${y(0)}" fill="${colour}" fill-opacity=".18"/>`
      marks += `<polyline points="${points.join(' ')}" fill="none" stroke="${colour}" stroke-width="2.5"/>`
      marks += points
        .map(
          (p, i) =>
            `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" fill="${colour}"><title>${escapeHtml(`${s.name}, ${chart.labels[i] ?? ''}: ${formatNumber(s.values[i])}`)}</title></circle>`
        )
        .join('')
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(chart.title ?? 'Chart')}" font-family="system-ui,sans-serif">${head}${axis}${labels}${marks}${legend}</svg>`
}

/** Slides: Markdown split at `---` lines or at each top-level heading. */
export function splitSlides(markdown: string): string[] {
  const byRule = markdown
    .split(/^\s*---\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
  if (byRule.length > 1) return byRule
  const parts = markdown
    .split(/^(?=#{1,2} )/m)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts : [markdown]
}

function safeJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/** The whole artifact as one self-contained page. */
export function artifactHtml(
  artifact: { kind: ArtifactKind; title: string },
  content: string,
  options: RenderOptions = {}
): string {
  const title = artifact.title
  switch (artifact.kind) {
    case 'page': {
      // The agent's own page, with our no-network policy placed first so it applies whatever the page says.
      const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`
      if (/<head[^>]*>/i.test(content)) return content.replace(/<head[^>]*>/i, (m) => `${m}${meta}`)
      if (/<html[^>]*>/i.test(content))
        return content.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`)
      return `<!doctype html><html><head><meta charset="utf-8">${meta}<title>${escapeHtml(title)}</title></head><body>${content}</body></html>`
    }
    case 'spreadsheet': {
      const data = safeJson<Sheet>(content)
      return page(
        title,
        `<h1>${escapeHtml(title)}</h1>${data ? sheetHtml(data) : '<p>This spreadsheet can’t be read.</p>'}`,
        options
      )
    }
    case 'chart': {
      const data = safeJson<Chart>(content)
      return page(
        title,
        `<div class="chart">${data ? chartSvg(data, options) : '<p>This chart can’t be read.</p>'}</div>`,
        options
      )
    }
    case 'diagram':
      return page(
        title,
        `<h1>${escapeHtml(title)}</h1><div class="diagram">${options.diagramSvg ?? `<pre><code>${escapeHtml(content)}</code></pre>`}</div>`,
        options
      )
    case 'slides':
      return page(
        title,
        splitSlides(content)
          .map((s) => `<section class="slide">${markdownToHtml(s)}</section>`)
          .join('\n'),
        options
      )
    case 'document':
    default:
      return page(title, markdownToHtml(content), options)
  }
}
