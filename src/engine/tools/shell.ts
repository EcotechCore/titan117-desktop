/**
 * The shell and code execution (features 3.8, 3.11, 4.10). Commands run in
 * the sandboxed shell (lib/shell.ts); which ones ask first is decided by
 * shell-rules.ts. Scripts run the same way and may call Titan's own tools
 * back through the local tool API, under the same task, permissions and
 * approvals (feature 4.10).
 */
import { defineTool, type Assessment } from './lib/define-tool'
import { classifyCommand } from './shell-rules'

/** Code that may talk to the internet. */
const NETWORKY = /https?:|fetch\(|urllib|requests\.|https?\.request|socket|net\.connect/i

function report(
  result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean },
  seconds: number
): string {
  const lines = [
    result.timedOut
      ? `Stopped after ${seconds} seconds (time limit).`
      : `Exit code ${result.exitCode ?? 'none'}.`
  ]
  if (result.stdout.trim()) lines.push(`Output:\n${result.stdout.trimEnd()}`)
  if (result.stderr.trim()) lines.push(`Errors:\n${result.stderr.trimEnd()}`)
  if (!result.stdout.trim() && !result.stderr.trim()) lines.push('(no output)')
  return lines.join('\n')
}

export const runCommand = defineTool<{
  command: string
  folder?: string
  timeout_seconds?: number
}>({
  name: 'run_command',
  description: [
    'Run a command in the sandboxed shell, inside a folder the user allowed.',
    process.platform === 'win32' ? 'The shell is Windows PowerShell.' : 'The shell is /bin/sh.',
    'Commands that only look (list, read, search, git status) run at once; anything else asks the user first.',
    'Deleting, admin rights, disks, system settings and saved logins always ask.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command line to run.' },
      folder: {
        type: 'string',
        description: 'Where to run it: a folder inside the allowed folders. Default: the first one.'
      },
      timeout_seconds: {
        type: 'number',
        description: 'Stop it after this many seconds (default 120, at most 600).'
      }
    },
    required: ['command']
  },
  risk: 'write',
  permissions: { shell: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Run: ${input.command}`,
  assess(input, ctx): Assessment {
    const verdict = classifyCommand(input.command)
    const folder = ctx.folders[0] ?? ''
    const summary = `Run: ${input.command}${input.folder ? `  (in ${input.folder})` : ''}`
    // A networked command is checked for private content before anyone is asked.
    const outgoing = verdict.network ? input.command : undefined
    if (verdict.risk === 'read-only') return { risk: 'read', summary, outgoing }
    if (verdict.risk === 'always-asks')
      return {
        risk: 'write',
        summary: `${summary} · ${verdict.reason}`,
        alwaysAsks: true,
        outgoing
      }
    return {
      risk: 'write',
      summary: `${summary} · ${verdict.reason}`,
      outgoing,
      ...(verdict.standing
        ? {
            standing: {
              folder,
              command: verdict.standing,
              label: `Always allow \`${verdict.standing}\` in this folder`
            }
          }
        : {})
    }
  },
  async run(input, ctx) {
    const verdict = classifyCommand(input.command)
    const seconds = Math.min(Math.max(Math.round(input.timeout_seconds ?? 120), 1), 600)
    const result = await ctx.shell.run(input.command, {
      cwd: input.folder,
      timeoutMs: seconds * 1000,
      network: verdict.network
    })
    return {
      output: report(result, seconds),
      summary: `Ran \`${input.command.slice(0, 120)}\`: ${result.timedOut ? 'timed out' : `exit ${result.exitCode}`}`
    }
  }
})

export const runCode = defineTool<{
  language: string
  code: string
  folder?: string
  timeout_seconds?: number
}>({
  name: 'run_code',
  description: [
    'Write and run a small script for a one-off job (clean data, build a report, rename many files, process many items).',
    'It runs in the sandboxed shell in an allowed folder, after the user approves it.',
    'JavaScript runs on Node. Python runs only if Python is installed.',
    'For bulk work the script can call Titan\'s own tools: in JavaScript, `await titan.call("read_file", { path: "a.txt" })`',
    'returns { ok, output }; in Python, `titan.call("read_file", {"path": "a.txt"})` returns a dict the same way.',
    'Those calls go through the same permissions and approvals. Print only a short summary: only what the script prints comes back.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'javascript or python.',
        enum: ['javascript', 'python']
      },
      code: { type: 'string', description: 'The whole script.' },
      folder: { type: 'string', description: 'Where it runs. Default: the first allowed folder.' },
      timeout_seconds: { type: 'number', description: 'Time limit (default 120, at most 600).' }
    },
    required: ['language', 'code']
  },
  risk: 'write',
  permissions: { shell: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) =>
    `Run a ${input.language} script (${String(input.code ?? '').split('\n').length} lines)`,
  assess: (input) => ({
    risk: 'write',
    summary: `Run a ${input.language} script (${String(input.code ?? '').split('\n').length} lines)`,
    outgoing: NETWORKY.test(input.code) ? input.code : undefined
  }),
  async run(input, ctx) {
    const seconds = Math.min(Math.max(Math.round(input.timeout_seconds ?? 120), 1), 600)
    const script = await ctx.shell.script(input.language, input.code)
    const result = await ctx.shell.exec(script.program, script.args, {
      cwd: input.folder,
      timeoutMs: seconds * 1000,
      network: false,
      env: script.env
    })
    return {
      output: report(result, seconds),
      summary: `Ran a ${input.language} script: ${result.timedOut ? 'timed out' : `exit ${result.exitCode}`}`
    }
  }
})
