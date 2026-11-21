/**
 * The user's own servers over SSH (3.15; decisions §34, §55). Commands run
 * with the user's own SSH setup (their keys, their agent, their
 * `~/.ssh/config` and known hosts), acting as the user, the way git does.
 * Only servers the user added in the app can be reached: an agent names a
 * server from that list, never an address. SSH never prompts: no password
 * questions, and a host must already be in the user's known hosts.
 *
 * The local `ssh` program is started directly, never through a shell here;
 * the command runs in the server's own shell, which is the point.
 */
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'

import { cleanEnv } from './shell'

export interface Server {
  /** The name agents and the user use: short, from the user. */
  name: string
  /** `user@host`, `host`, or an alias from the user's `~/.ssh/config`. */
  target: string
  port?: number
}

export class SshError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshError'
  }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/
// No leading dash (it would read as an option), no spaces or shell characters.
const TARGET = /^(?!-)[A-Za-z0-9._-]+(@[A-Za-z0-9._:\][-]+)?$/

/** Checks a server the user is adding. Throws SshError. */
export function checkServer(input: { name?: unknown; target?: unknown; port?: unknown }): Server {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const target = typeof input.target === 'string' ? input.target.trim() : ''
  if (!NAME.test(name))
    throw new SshError('Give the server a short name (letters, digits, spaces, dots, dashes).')
  if (!TARGET.test(target))
    throw new SshError('The address is user@host, a host, or a name from your SSH config.')
  let port: number | undefined
  if (input.port !== undefined && input.port !== null && input.port !== '') {
    port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new SshError('The port is a number from 1 to 65535.')
  }
  return { name, target, ...(port ? { port } : {}) }
}

/** The arguments for `ssh` (exported for tests). Never prompts, never trusts an unknown host. */
export function sshArgs(server: Server, command: string, timeoutSeconds: number): string[] {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `ConnectTimeout=${Math.min(Math.max(Math.round(timeoutSeconds), 5), 30)}`,
    '-o',
    'ServerAliveInterval=15',
    // No forwarding of the user's agent or ports to the server.
    '-a',
    '-x',
    '-T',
    ...(server.port ? ['-p', String(server.port)] : []),
    server.target,
    '--',
    command
  ]
}

export interface SshResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const MAX_OUTPUT = 100_000

export function runOnServer(
  server: Server,
  command: string,
  options: { timeoutMs: number; signal?: AbortSignal; program?: string }
): Promise<SshResult> {
  const env = cleanEnv(
    process.env,
    tmpdir(),
    process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}
  )
  return new Promise((resolve, reject) => {
    let timedOut = false
    const child = execFile(
      options.program ?? 'ssh',
      sshArgs(server, command, options.timeoutMs / 1000),
      { env, timeout: options.timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code
        if (code === 'ENOENT')
          return reject(
            new SshError(
              'SSH isn’t installed on this laptop (Windows: Settings → Optional features → OpenSSH Client).'
            )
          )
        if ((error as { killed?: boolean } | null)?.killed) timedOut = true
        const exitCode = typeof code === 'number' ? code : error ? null : 0
        // 255 is ssh's own failure: no connection, refused key, unknown host.
        if (
          exitCode === 255 &&
          /Host key verification failed|Permission denied|Could not resolve|Connection (refused|timed out)/i.test(
            stderr
          )
        )
          return reject(
            new SshError(
              /Host key verification failed/i.test(stderr)
                ? `${server.name}'s host key isn't known yet. Connect once yourself in a terminal (ssh ${server.target}) to check and accept it.`
                : /Permission denied/i.test(stderr)
                  ? `${server.name} didn't accept your SSH key. Check that your key works in a terminal (ssh ${server.target}).`
                  : `Couldn't reach ${server.name}: ${stderr.trim().split('\n').pop()}`
            )
          )
        resolve({
          exitCode,
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: stderr.slice(0, MAX_OUTPUT),
          timedOut
        })
      }
    )
    options.signal?.addEventListener('abort', () => child.kill(), { once: true })
  })
}
