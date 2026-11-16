/**
 * Artifacts (§17, decisions §44): what an agent makes for the user to look
 * at, use or share opens beside the chat instead of a wall of text. Making and
 * changing one doesn't ask: it is the agent's answer, every version is kept
 * and the user can restore any of them. Saving one as a file in a folder
 * (17.24) writes to the laptop, so it asks like any file write.
 */
import { ARTIFACT_KINDS } from '../../shared/protocol'
import { defineTool } from './lib/define-tool'

const KIND_HELP =
  'document: Markdown (headings, lists, tables, links); page: a full HTML page or small tool with inline CSS and JavaScript, no outside files; spreadsheet: JSON {"columns": [...], "rows": [[...]]}; chart: JSON {"type": "bar"|"line"|"area"|"pie", "title", "unit", "labels": [...], "series": [{"name", "values": [numbers]}]}; diagram: Mermaid source; slides: Markdown, one slide per "---" or per heading.'

export const artifactCreate = defineTool<{ kind: string; title: string; content: string }>({
  name: 'artifact_create',
  description: `Make an artifact that opens beside the chat: a report, offer, table, chart, diagram, slides or a small tool the user can look at, edit, download (PDF, Word, Excel, PowerPoint) and share. Use it for anything longer than a few paragraphs or meant to be kept. ${KIND_HELP}`,
  params: {
    type: 'object',
    properties: {
      kind: { type: 'string', description: 'What it is', enum: [...ARTIFACT_KINDS] },
      title: { type: 'string', description: 'A short title; also the file name' },
      content: { type: 'string', description: 'The whole content, in the format for its kind' }
    },
    required: ['kind', 'title', 'content']
  },
  risk: 'read',
  permissions: { artifacts: 'write' },
  describe: (input) => `Make the ${input.kind} "${String(input.title).slice(0, 60)}"`,
  async run(input, ctx) {
    const artifact = ctx.artifacts.create(input)
    return {
      output: `Made the ${artifact.kind} "${artifact.title}" (id ${artifact.id}, version 1). It is open beside the chat.`,
      summary: `Made the ${artifact.kind} "${artifact.title}"`
    }
  }
})

export const artifactUpdate = defineTool<{
  id: string
  content?: string
  title?: string
  note?: string
}>({
  name: 'artifact_update',
  description:
    'Change an artifact: give its whole new content (and/or a new title). Every change is a new version the user can compare and restore. Read it first with artifact_read if the user may have edited it.',
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The artifact id' },
      content: { type: 'string', description: 'The whole new content' },
      title: { type: 'string', description: 'A new title' },
      note: { type: 'string', description: 'What changed, in a few words' }
    },
    required: ['id']
  },
  risk: 'read',
  permissions: { artifacts: 'write' },
  describe: (input) => `Change the artifact ${input.id}`,
  async run(input, ctx) {
    const artifact = ctx.artifacts.update(input.id, input)
    return {
      output: `Saved "${artifact.title}" as version ${artifact.version}.`,
      summary: `Changed "${artifact.title}" (version ${artifact.version})`
    }
  }
})

export const artifactRead = defineTool<{ id: string; version?: number }>({
  name: 'artifact_read',
  description:
    "Read an artifact's current content (or an older version), including the user's own edits.",
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The artifact id' },
      version: { type: 'number', description: 'An older version number' }
    },
    required: ['id']
  },
  risk: 'read',
  permissions: { artifacts: 'read' },
  // Artifacts can hold the user's data and text from web pages.
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Read the artifact ${input.id}`,
  async run(input, ctx) {
    const { artifact, content, version } = ctx.artifacts.read(input.id, input.version)
    return {
      output: `${artifact.kind} "${artifact.title}", version ${version} of ${artifact.version}:\n\n${content}`,
      summary: `Read "${artifact.title}"`
    }
  }
})

export const artifactList = defineTool<{ query?: string }>({
  name: 'artifact_list',
  description:
    'List the artifacts made so far (newest first), optionally those whose title has some words.',
  params: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Words in the title' } },
    required: []
  },
  risk: 'read',
  permissions: { artifacts: 'read' },
  describe: () => 'List artifacts',
  async run(input, ctx) {
    const list = ctx.artifacts.list(input.query)
    return {
      output: list.length
        ? list
            .slice(0, 50)
            .map(
              (a) =>
                `${a.id}  ${a.kind}  "${a.title}"  v${a.version}  ${new Date(a.updatedAt).toISOString().slice(0, 10)}`
            )
            .join('\n')
        : 'No artifacts yet.',
      summary: `Listed ${list.length} artifacts`
    }
  }
})

export const SAVE_FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'md',
  'html',
  'txt',
  'csv',
  'mmd',
  'json'
] as const

export const artifactSave = defineTool<{ id: string; format: string; path: string }>({
  name: 'artifact_save',
  description:
    'Save an artifact as a file in an allowed folder (Word, Excel, PowerPoint, Markdown, HTML, text, CSV), e.g. "save the offer as Word in the Client X folder". PDF is saved by the user from the artifact\'s Download button.',
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The artifact id' },
      format: { type: 'string', description: 'The file format', enum: [...SAVE_FORMATS] },
      path: {
        type: 'string',
        description: 'Where, including the file name, e.g. "Clients/X/Offer.docx"'
      }
    },
    required: ['id', 'format', 'path']
  },
  risk: 'write',
  permissions: { artifacts: 'read', folders: 'write' },
  describe: (input) => `Save the artifact ${input.id} as ${input.path}`,
  async run(input, ctx) {
    const { name, data } = await ctx.artifacts.export(input.id, input.format)
    const path = /\.[A-Za-z0-9]{2,5}$/.test(input.path)
      ? input.path
      : `${input.path.replace(/[\\/]+$/, '')}/${name}`
    await ctx.files.writeBytes(path, data)
    return { output: `Saved ${path}.`, summary: `Saved ${path}` }
  }
})

export const artifactTools = [
  artifactCreate,
  artifactUpdate,
  artifactRead,
  artifactList,
  artifactSave
]
