/**
 * The code builder (5.7, §13; decisions §53): hand a coding job in a project
 * folder to the coding engine. Starting it changes nothing; every command it
 * runs and every file it changes asks through the same approvals as Titan's
 * own tools, so the tool itself is `read`.
 */
import { defineTool } from './lib/define-tool'

const MAX_TEXT = 6_000

export const codeTask = defineTool<{ folder: string; request: string; mode?: 'build' | 'plan' }>({
  name: 'code_task',
  description: [
    'Hand a coding job in a project folder (a code repository the user allowed) to the coding engine:',
    'fix bugs, add features, write tests, refactor, explain code. It reads the code, runs commands and edits files;',
    'each command and each change asks the user first. Use mode "plan" to only read and propose a plan (13.2),',
    '"build" (default) to make the changes. Calling it again in the same task continues the same coding session.',
    'Describe the job fully: the engine sees only this request and the code.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'The project folder, inside the allowed folders.' },
      request: { type: 'string', description: 'What to do, in full.' },
      mode: { type: 'string', enum: ['build', 'plan'], description: 'build (default) or plan.' }
    },
    required: ['folder', 'request']
  },
  risk: 'read',
  permissions: { code: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Coding job in ${input.folder}: ${String(input.request ?? '').slice(0, 80)}`,
  async run(input, ctx) {
    const result = await ctx.code.run({
      folder: input.folder,
      request: input.request,
      mode: input.mode === 'plan' ? 'plan' : 'build'
    })
    const files = result.files.length
      ? result.files.map((f) => `- ${f.file} (+${f.additions} −${f.deletions})`).join('\n')
      : '(no files changed)'
    const head =
      result.status === 'done'
        ? 'The coding engine finished.'
        : result.status === 'stopped'
          ? 'The coding job was stopped.'
          : `The coding engine stopped with a problem: ${result.error ?? 'unknown'}`
    return {
      output: `${head}\n\nChanged files:\n${files}\n\nIts answer:\n${result.text.slice(0, MAX_TEXT) || '(none)'}`,
      summary: `Coding job: ${result.status}, ${result.files.length} file(s) changed, ${result.steps} steps`,
      costUsd: result.costUsd
    }
  }
})
