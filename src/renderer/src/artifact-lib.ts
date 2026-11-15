/**
 * Artifacts in the window (§17, decisions §44): labels, downloads per kind,
 * templates, drawing a page for the sandbox, and comparing versions.
 */
import { artifactHtml, type RenderOptions } from '../../shared/artifact-html'
import type { Artifact, ArtifactKind } from '../../shared/protocol'

export const KIND_LABEL: Record<ArtifactKind, string> = {
  document: 'Document',
  page: 'Page',
  spreadsheet: 'Spreadsheet',
  chart: 'Chart',
  diagram: 'Diagram',
  slides: 'Slides'
}

/** What each kind downloads as (the table under 17.8). pdf, png and svg come from the shell. */
export const DOWNLOADS: Record<ArtifactKind, { format: string; label: string }[]> = {
  document: [
    { format: 'pdf', label: 'PDF' },
    { format: 'docx', label: 'Word (.docx)' },
    { format: 'xlsx', label: 'Excel: its tables and sources' },
    { format: 'md', label: 'Markdown' },
    { format: 'html', label: 'HTML, works offline' },
    { format: 'txt', label: 'Plain text' }
  ],
  page: [
    { format: 'html', label: 'HTML, works offline' },
    { format: 'pdf', label: 'PDF snapshot' },
    { format: 'png', label: 'PNG image' },
    { format: 'txt', label: 'Plain text' }
  ],
  spreadsheet: [
    { format: 'xlsx', label: 'Excel (.xlsx)' },
    { format: 'csv', label: 'CSV' },
    { format: 'pdf', label: 'PDF' },
    { format: 'html', label: 'HTML' }
  ],
  chart: [
    { format: 'png', label: 'PNG image' },
    { format: 'svg', label: 'SVG' },
    { format: 'pdf', label: 'PDF' },
    { format: 'xlsx', label: 'The data as Excel' },
    { format: 'csv', label: 'The data as CSV' }
  ],
  diagram: [
    { format: 'svg', label: 'SVG' },
    { format: 'png', label: 'PNG image' },
    { format: 'pdf', label: 'PDF' },
    { format: 'mmd', label: 'Mermaid source' }
  ],
  slides: [
    { format: 'pptx', label: 'PowerPoint (.pptx)' },
    { format: 'pdf', label: 'PDF' },
    { format: 'md', label: 'Markdown' },
    { format: 'html', label: 'HTML' }
  ]
}

/** Starter artifacts (17.12): the user fills them in, or asks Titan to. */
export const TEMPLATES: { kind: ArtifactKind; title: string; content: string }[] = [
  {
    kind: 'document',
    title: 'Offer',
    content:
      '# Offer for [client]\n\n**Date:** [date]  \n**Valid until:** [date]\n\n## What we propose\n\n[A short description of the work or products.]\n\n## Price\n\n| Item | Quantity | Unit price | Total |\n|---|---|---|---|\n| [Item] | 1 | 0.00 | 0.00 |\n| **Total** | | | **0.00** |\n\n## Terms\n\n- Payment within 14 days of the invoice.\n- Prices without VAT.\n\n[Your name], [company]'
  },
  {
    kind: 'spreadsheet',
    title: 'Invoice items',
    content: JSON.stringify(
      {
        columns: ['Item', 'Quantity', 'Unit price', 'Total'],
        rows: [
          ['Consulting (hours)', 10, 50, '=B2*C2'],
          ['Travel', 1, 120, '=B3*C3']
        ]
      },
      null,
      2
    )
  },
  {
    kind: 'document',
    title: 'Monthly report',
    content:
      '# Monthly report: [month]\n\n## Summary\n\n[Three sentences on how the month went.]\n\n## Numbers\n\n| | This month | Last month | Change |\n|---|---|---|---|\n| Sales | | | |\n| Costs | | | |\n\n## What went well\n\n- \n\n## What to fix next month\n\n- '
  },
  {
    kind: 'document',
    title: 'Meeting notes',
    content:
      '# Meeting: [topic]\n\n**Date:** [date] · **People:** [names]\n\n## Decisions\n\n- \n\n## Actions\n\n| What | Who | By when |\n|---|---|---|\n| | | |\n\n## Notes\n\n'
  },
  {
    kind: 'slides',
    title: 'Project plan',
    content:
      '# [Project name]\n\nProject plan · [date]\n\n---\n\n## Goal\n\n- [What done looks like]\n\n---\n\n## Steps\n\n1. [Step] · [owner] · [date]\n2. [Step] · [owner] · [date]\n\n---\n\n## Risks\n\n- [Risk] and what we do about it'
  }
]

/** Mermaid draws diagrams here in the window, strictly (no scripts in labels), then they go into the sandbox. */
async function drawDiagram(source: string, theme: 'light' | 'dark'): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    htmlLabels: false
  })
  const { svg } = await mermaid.render(`d${Math.random().toString(36).slice(2)}`, source)
  return svg
}

/** The whole artifact as one page, diagrams drawn first. */
export async function renderPage(
  artifact: Pick<Artifact, 'kind' | 'title'>,
  content: string,
  options: RenderOptions = {}
): Promise<string> {
  let diagramSvg: string | undefined
  if (artifact.kind === 'diagram') {
    try {
      diagramSvg = await drawDiagram(content, options.theme ?? 'light')
    } catch {
      // Shown as its source instead, with Mermaid's complaint left to the user's eye.
    }
  }
  return artifactHtml(artifact, content, { ...options, diagramSvg })
}

export function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** Lines added and removed between two versions (17.10). */
export function lineDiff(
  before: string,
  after: string
): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length * b.length > 4_000_000)
    return [
      ...a.map((t) => ({ kind: 'del' as const, text: t })),
      ...b.map((t) => ({ kind: 'add' as const, text: t }))
    ]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] })
    else out.push({ kind: 'add', text: b[j++] })
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++] })
  while (j < b.length) out.push({ kind: 'add', text: b[j++] })
  return out
}

export function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}
