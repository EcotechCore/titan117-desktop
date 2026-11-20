/**
 * The coding engine's permission prompts, judged by our rules (decisions
 * §53). OpenCode asks before it runs a command or changes a file; each ask
 * becomes an assessment for the permission layer, the same as our own tools
 * get: commands through the shell rules (decisions §43.2), edits only inside
 * the repo and the allowed folders, everything else refused. Unknown means no.
 */
import { join, isAbsolute } from 'node:path'

import { checkWritable, isInsideFolder, PermissionError, type FolderPolicy } from '../folders'
import type { Assessment } from '../../tools/lib/define-tool'
import { classifyCommand } from '../../tools/shell-rules'

/** What OpenCode sends with `permission.asked`. */
export interface EngineAsk {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
}

/** What the permission layer gets: the name it remembers "always" under, the input shown, the assessment. */
export interface AssessedAsk {
  tool: string
  input: Record<string, unknown>
  assessment: Assessment
}

const MAX_DIFF = 20_000

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export async function assessAsk(
  ask: EngineAsk,
  repo: string,
  policy: FolderPolicy
): Promise<AssessedAsk> {
  switch (ask.permission) {
    case 'bash': {
      const command = text(ask.metadata.command) || ask.patterns.join(' && ')
      const verdict = classifyCommand(command)
      const summary = `Run in ${repo}: ${command}`
      const outgoing = verdict.network ? command : undefined
      const input = { command, folder: repo }
      if (verdict.risk === 'read-only')
        return { tool: 'code_command', input, assessment: { risk: 'read', summary, outgoing } }
      if (verdict.risk === 'always-asks')
        return {
          tool: 'code_command',
          input,
          assessment: {
            risk: 'write',
            summary: `${summary} · ${verdict.reason}`,
            alwaysAsks: true,
            outgoing
          }
        }
      return {
        tool: 'code_command',
        input,
        assessment: {
          risk: 'write',
          summary: `${summary} · ${verdict.reason}`,
          outgoing,
          ...(verdict.standing
            ? {
                standing: {
                  folder: repo,
                  command: verdict.standing,
                  label: `Always allow \`${verdict.standing}\` in this folder`
                }
              }
            : {})
        }
      }
    }

    case 'edit': {
      const files = ask.patterns.length ? ask.patterns : [text(ask.metadata.filepath)]
      const input = {
        files,
        diff: text(ask.metadata.diff).slice(0, MAX_DIFF)
      }
      try {
        for (const file of files) {
          const absolute = isAbsolute(file) ? file : join(repo, file)
          const real = await checkWritable(policy, absolute)
          if (!isInsideFolder(real, repo))
            throw new PermissionError(`"${file}" is outside the project folder.`)
        }
      } catch (error) {
        if (!(error instanceof PermissionError)) throw error
        return {
          tool: 'code_edit',
          input,
          assessment: {
            risk: 'write',
            summary: `Change ${files.join(', ')}`,
            refuse: error.message
          }
        }
      }
      const shown =
        files.length > 3
          ? `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`
          : files.join(', ')
      return {
        tool: 'code_edit',
        input,
        assessment: { risk: 'write', summary: `Change ${shown}` }
      }
    }

    case 'doom_loop':
      return {
        tool: 'code_repeat',
        input: { ...ask.metadata },
        assessment: {
          risk: 'write',
          summary: 'The coding engine is repeating the same step. Let it try again?',
          alwaysAsks: true
        }
      }

    case 'external_directory':
      return refused(ask, 'the coding engine works only inside the project folder.')
    case 'webfetch':
    case 'websearch':
      return refused(ask, 'the coding engine has no web access of its own; Titan does web work.')
    default:
      return refused(
        ask,
        `the coding engine asked for "${ask.permission}", which Titan117 doesn't allow.`
      )
  }
}

function refused(ask: EngineAsk, why: string): AssessedAsk {
  return {
    tool: `code_${ask.permission}`.slice(0, 40),
    input: { patterns: ask.patterns },
    assessment: {
      risk: 'write',
      summary: `${ask.permission}: ${ask.patterns.join(', ')}`,
      refuse: why
    }
  }
}
