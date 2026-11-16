/**
 * The folder agent's tools (features 5.4, 7.4-7.6; decisions §51): search the
 * document folders, read a page, and calculate on a spreadsheet. Everything
 * found is private and outside text: it's marked as data, never instructions,
 * and every answer names the file and page it came from.
 */
import { defineTool } from './lib/define-tool'

export const docsSearch = defineTool<{ query: string; limit?: number }>({
  name: 'docs_search',
  description:
    "Search the user's document folders (PDF, Word, Excel, PowerPoint, email, text) by words and by meaning, in Romanian or English. Returns passages with their file and page. Cite every fact as (file, page). Read more of a page with docs_read.",
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for, in plain words' },
      limit: { type: 'number', description: 'How many passages, 1 to 20 (default 8)' }
    },
    required: ['query']
  },
  risk: 'read',
  permissions: { documents: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Search the documents for "${String(input.query).slice(0, 80)}"`,
  async run(input, ctx) {
    const hits = await ctx.documents.search(input.query, input.limit)
    if (!hits.length)
      return {
        output:
          'Nothing found in the document folders. If the user expects it there, the folder may not be turned on in Documents, or the file is a scan without text.',
        summary: `Searched the documents for "${input.query.slice(0, 60)}": nothing found`
      }
    return {
      output: hits.map((h, i) => `[${i + 1}] ${h.file}, ${h.label}\n${h.text}`).join('\n\n'),
      summary: `Searched the documents for "${input.query.slice(0, 60)}": ${hits.length} passages`
    }
  }
})

export const docsRead = defineTool<{ file: string; page: number }>({
  name: 'docs_read',
  description:
    'Read one page of a document from the document folders (a PDF page, a slide, a sheet or a Word section), as found by docs_search. Give the file as docs_search named it.',
  params: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'The file, as docs_search named it' },
      page: { type: 'number', description: 'The page number (1 for the first)' }
    },
    required: ['file', 'page']
  },
  risk: 'read',
  permissions: { documents: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Read ${input.file}, page ${input.page}`,
  async run(input, ctx) {
    const page = await ctx.documents.page(input.file, Math.max(1, Math.round(input.page)))
    return {
      output: `${input.file}, ${page.label} (of ${page.pages}):\n\n${page.text}`,
      summary: `Read ${input.file}, ${page.label}`
    }
  }
})

export const sheetQuery = defineTool<{
  file: string
  op: 'sum' | 'average' | 'count' | 'min' | 'max' | 'list'
  column?: string
  sheet?: string
  where_column?: string
  where_equals?: string
  group_by?: string
}>({
  name: 'sheet_query',
  description:
    'Calculate on an Excel spreadsheet in an allowed folder: sum, average, count, min, max or list a column, optionally only rows where another column equals a value, optionally one result per group. Use it instead of adding numbers yourself: the result is computed from the cells.',
  params: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'The .xlsx file, as a path in an allowed folder' },
      op: {
        type: 'string',
        description: 'What to calculate',
        enum: ['sum', 'average', 'count', 'min', 'max', 'list']
      },
      column: { type: 'string', description: 'The header of the column to calculate on' },
      sheet: { type: 'string', description: 'The sheet (default: the first)' },
      where_column: { type: 'string', description: 'Only rows where this column…' },
      where_equals: { type: 'string', description: '…equals this value' },
      group_by: { type: 'string', description: 'One result per value of this column' }
    },
    required: ['file', 'op']
  },
  risk: 'read',
  permissions: { folders: 'read', documents: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Calculate ${input.op} of ${input.column ?? 'rows'} in ${input.file}`,
  async run(input, ctx) {
    const result = await ctx.documents.sheet(input.file, {
      op: input.op,
      column: input.column,
      sheet: input.sheet,
      groupBy: input.group_by,
      where:
        input.where_column && input.where_equals !== undefined
          ? { column: input.where_column, equals: input.where_equals }
          : undefined
    })
    const lines = Object.entries(result.result).map(
      ([k, v]) =>
        `${k === 'all' ? input.op : `${input.group_by} = ${k}`}: ${Array.isArray(v) ? v.join(', ') : v}`
    )
    return {
      output: `${input.file}, sheet "${result.sheet}", ${result.rows} rows${input.where_column ? ` where ${input.where_column} = ${input.where_equals}` : ''}:\n${lines.join('\n')}`,
      summary: `Calculated ${input.op} in ${input.file} (sheet "${result.sheet}")`
    }
  }
})

export const documentTools = [docsSearch, docsRead, sheetQuery]
