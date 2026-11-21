/**
 * Commands on the user's own servers over SSH (3.15; decisions §34, §55).
 * The same rules as the laptop's shell: commands that only look run at
 * once, others ask (with "always allow `<program>` on this server"), the
 * always-ask list always asks, and a command carrying private content is
 * refused before anyone is asked, since it leaves the laptop.
 */
import { defineTool, type Assessment } from './lib/define-tool'
import { classifyCommand } from './shell-rules'

function report(
  r: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean },
  seconds: number
): string {
  const lines = [
    r.timedOut
      ? `Stopped after ${seconds} seconds (time limit).`
      : `Exit code ${r.exitCode ?? 'none'}.`
  ]
  if (r.stdout.trim()) lines.push(`Output:\n${r.stdout.trimEnd()}`)
  if (r.stderr.trim()) lines.push(`Errors:\n${r.stderr.trimEnd()}`)
  if (!r.stdout.trim() && !r.stderr.trim()) lines.push('(no output)')
  return lines.join('\n')
}

export const serverList = defineTool<Record<string, never>>({
  name: 'server_list',
  description:
    'List the user’s own servers that Titan may run commands on over SSH (the user adds them in the app).',
  params: { type: 'object', properties: {}, required: [] },
  risk: 'read',
  permissions: { servers: true },
  describe: () => 'List your servers',
  async run(_input, ctx) {
    const list = ctx.servers.list()
    return {
      output: list.length
        ? list.map((s) => `- ${s.name} (${s.target})`).join('\n')
        : 'No servers yet. The user adds them on the Code screen.',
      summary: `Listed ${list.length} server(s)`
    }
  }
})

export const serverCommand = defineTool<{
  server: string
  command: string
  timeout_seconds?: number
}>({
  name: 'server_command',
  description: [
    'Run a command on one of the user’s own servers over SSH, as the user (their own SSH keys).',
    'Name the server from server_list. Commands that only look run at once; anything else asks the user first;',
    'deleting, admin rights and system changes always ask. The command runs in the server’s own shell.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'The server’s name, from server_list.' },
      command: { type: 'string', description: 'The command line to run on the server.' },
      timeout_seconds: {
        type: 'number',
        description: 'Stop it after this many seconds (default 120, at most 600).'
      }
    },
    required: ['server', 'command']
  },
  risk: 'write',
  permissions: { servers: true },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `On ${input.server}: ${input.command}`,
  assess(input): Assessment {
    const verdict = classifyCommand(input.command)
    const summary = `On ${input.server}: ${input.command}`
    // Everything sent to a server leaves the laptop: private passages may not go.
    const outgoing = input.command
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
              folder: `ssh:${input.server}`,
              command: verdict.standing,
              label: `Always allow \`${verdict.standing}\` on ${input.server}`
            }
          }
        : {})
    }
  },
  async run(input, ctx) {
    const seconds = Math.min(Math.max(Math.round(input.timeout_seconds ?? 120), 1), 600)
    const result = await ctx.servers.run(input.server, input.command, seconds * 1000)
    return {
      output: report(result, seconds),
      summary: `Ran \`${input.command.slice(0, 100)}\` on ${input.server}: ${result.timedOut ? 'timed out' : `exit ${result.exitCode}`}`
    }
  }
})

export const serverTools = [serverList, serverCommand]
