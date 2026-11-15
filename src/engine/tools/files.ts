/**
 * The first tools: files inside the folders the user allowed. Reading runs
 * without asking; writing, moving and new folders wait for the user;
 * deleting always asks (feature 4.5).
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
  privateOutput: true,
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
  privateOutput: true,
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

export const searchFiles = defineTool<{ folder?: string; name?: string; text?: string }>({
  name: 'search_files',
  description:
    'Find files inside the allowed folders by name (patterns like *.pdf or invoice*) and, optionally, by text they contain. Returns paths and matching lines.',
  params: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'Where to look. Default: the first allowed folder.' },
      name: {
        type: 'string',
        description: 'A file-name pattern, e.g. *.csv. Default: every file.'
      },
      text: { type: 'string', description: 'Only files containing this text (case-insensitive).' }
    },
    required: []
  },
  risk: 'read',
  permissions: { folders: 'read' },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) =>
    `Search ${input.folder ?? 'the allowed folder'} for ${input.name ?? 'files'}`,
  async run(input, ctx) {
    const hits = await ctx.files.search(input.folder ?? '.', input.name ?? '*', input.text)
    const output = hits.length
      ? hits
          .map((h) => (h.lines.length ? `${h.path}\n  ${h.lines.join('\n  ')}` : h.path))
          .join('\n')
      : 'Nothing found.'
    return { output, summary: `Searched ${input.folder ?? '.'}: ${hits.length} found` }
  }
})

export const moveFile = defineTool<{ from: string; to: string }>({
  name: 'move_file',
  description:
    'Move or rename a file or folder inside the allowed folders. Never replaces an existing file. The user is asked first.',
  params: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'The file or folder now.' },
      to: { type: 'string', description: 'Its new path (or new name in the same folder).' }
    },
    required: ['from', 'to']
  },
  risk: 'write',
  permissions: { folders: 'write' },
  describe: (input) => `Move ${input.from} to ${input.to}`,
  async run(input, ctx) {
    await ctx.files.move(input.from, input.to)
    const what = `Moved ${input.from} to ${input.to}`
    return { output: what, summary: what }
  }
})

export const makeFolder = defineTool<{ path: string }>({
  name: 'make_folder',
  description:
    'Create a folder (and any missing parents) inside the allowed folders. The user is asked first.',
  params: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The new folder.' } },
    required: ['path']
  },
  risk: 'write',
  permissions: { folders: 'write' },
  describe: (input) => `Create the folder ${input.path}`,
  async run(input, ctx) {
    await ctx.files.makeFolder(input.path)
    const what = `Created the folder ${input.path}`
    return { output: what, summary: what }
  }
})

export const deleteFile = defineTool<{ path: string }>({
  name: 'delete_file',
  description:
    'Delete a file or an empty folder inside the allowed folders. Always asks the user, every time.',
  params: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The file or empty folder to delete.' } },
    required: ['path']
  },
  // Deleting always asks (feature 4.5, guardrails §4).
  risk: 'external',
  permissions: { folders: 'write' },
  describe: (input) => `Delete ${input.path} (it can't be undone)`,
  async run(input, ctx) {
    const kind = await ctx.files.remove(input.path)
    const what = `Deleted the ${kind} ${input.path}`
    return { output: what, summary: what }
  }
})

export const fileTools = [
  listFolder,
  readFile,
  writeFile,
  searchFiles,
  moveFile,
  makeFolder,
  deleteFile
]
