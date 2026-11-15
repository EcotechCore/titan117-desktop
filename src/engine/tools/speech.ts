/**
 * Speech tools (feature 3.14): read text aloud into a file, and transcribe a
 * recording. Both run on the laptop (lib/speech.ts).
 */
import { defineTool } from './lib/define-tool'

export const speak = defineTool<{ text: string; path: string }>({
  name: 'speak',
  description:
    'Read text aloud with a voice on this laptop and save it as a .wav file in an allowed folder. Asks first, as it writes a file.',
  params: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What to read aloud.' },
      path: { type: 'string', description: 'The .wav file to create.' }
    },
    required: ['text', 'path']
  },
  risk: 'write',
  permissions: { speech: true, folders: 'write' },
  describe: (input) =>
    `Read ${String(input.text ?? '').length} characters aloud into ${input.path}`,
  async run(input, ctx) {
    const { path, seconds } = await ctx.speech.speak(input.text, input.path)
    const what = `Saved ${Math.round(seconds)} seconds of speech to ${path}`
    return { output: what, summary: what }
  }
})

export const transcribe = defineTool<{ path: string }>({
  name: 'transcribe',
  description:
    'Turn a recording (a .wav file in an allowed folder) into text, on this laptop. The first use downloads the speech model (about 80 MB).',
  params: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The .wav recording.' } },
    required: ['path']
  },
  risk: 'read',
  permissions: { speech: true, folders: 'read' },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Transcribe ${input.path}`,
  async run(input, ctx) {
    const text = await ctx.speech.transcribe(input.path)
    return { output: text || '(no speech found)', summary: `Transcribed ${input.path}` }
  }
})

export const speechTools = [speak, transcribe]
