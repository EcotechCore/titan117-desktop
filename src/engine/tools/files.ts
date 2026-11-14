/**
 * The first tools: files inside the folders the user allowed. Reading runs
 * without asking; writing waits for the user. Deleting, the shell, the
 * browser and the rest arrive with Titan in phase 3.
 */
import { defineTool } from './lib/define-tool'

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const listFolder = defineTool<{ path: string }>({
  name: 'list_folder',
  description:
    'List the files and folders inside a folder the user allowed. Use "." for the main allowed folder.',
  params: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The folder, absolute or relative.' } },
    required: ['path']
  },
  risk: 'read',
  permissions: { folders: 'read' },
  untrustedOutput: true,
  describe: (input) => `List the folder ${input.path}`,
  async run(input, ctx) {
    const entries = await ctx.files.list(input.path)
    const lines = entries.map((e) =>
      e.kind === 'folder' ? `${e.name}/` : `${e.name}  (${size(e.sizeBytes)})`
    )
    return {
      output: lines.length ? lines.join('\n') : '(empty folder)',
      summary: `Listed ${input.path}: ${entries.length} items`
    }
  }
})

export const readFile = defineTool<{ path: string }>({
  name: 'read_file',
  description: 'Read a text file inside a folder the user allowed.',
  params: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The file, absolute or relative.' } },
    required: ['path']
  },
  risk: 'read',
  permissions: { folders: 'read' },
  untrustedOutput: true,
  describe: (input) => `Read the file ${input.path}`,
  async run(input, ctx) {
    const { text, truncated } = await ctx.files.read(input.path)
    return {
      output: truncated ? `${text}\n[The file is longer; only its start is shown.]` : text,
      summary: `Read ${input.path}`
    }
  }
})

export const writeFile = defineTool<{ path: string; content: string }>({
  name: 'write_file',
  description:
    'Create a text file, or replace its whole content, inside a folder the user allowed. The user is asked first.',
  params: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file, absolute or relative.' },
      content: { type: 'string', description: 'The full new content of the file.' }
    },
    required: ['path', 'content']
  },
  risk: 'write',
  permissions: { folders: 'write' },
  describe: (input) =>
    `Write ${size(Buffer.byteLength(String(input.content ?? '')))} to ${input.path}`,
  async run(input, ctx) {
    const { bytes, created } = await ctx.files.write(input.path, input.content)
    const what = `${created ? 'Created' : 'Replaced'} ${input.path} (${size(bytes)})`
    return { output: what, summary: what }
  }
})
