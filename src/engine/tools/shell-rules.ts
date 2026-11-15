/**
 * Which shell commands ask first (feature 3.8, decisions §33.1, §43).
 *
 *   read-only     a short list of commands that only look (list, read, search,
 *                 git status): run without asking
 *   risky         everything else: asks, with "allow once" or "always allow
 *                 this command in this project"
 *   always asks   deleting, admin or sudo, formatting disks, system changes,
 *                 touching saved logins: asks every time, even after "always"
 *
 * Unknown means risky. A command is only as safe as its riskiest part, and
 * anything that hides what runs (a subshell, an encoded command, piping into
 * a shell) is risky at least.
 */

export type ShellRisk = 'read-only' | 'risky' | 'always-asks'

export interface ShellVerdict {
  risk: ShellRisk
  /** Why, in a few words, for the approval card. */
  reason: string
  /** The command name a standing "always" covers, e.g. `npm install` or `git commit`. */
  standing: string | null
  /** Whether it is likely to use the network. */
  network: boolean
}

const READ_ONLY = new Set([
  'ls',
  'dir',
  'gci',
  'get-childitem',
  'cat',
  'type',
  'gc',
  'get-content',
  'head',
  'tail',
  'wc',
  'pwd',
  'get-location',
  'echo',
  'write-output',
  'write-host',
  'where',
  'where.exe',
  'which',
  'get-command',
  'grep',
  'rg',
  'findstr',
  'select-string',
  'sls',
  'sort',
  'sort-object',
  'uniq',
  'date',
  'get-date',
  'whoami',
  'hostname',
  'tree',
  'file',
  'stat',
  'du',
  'df',
  'measure-object',
  'test-path',
  'get-item',
  'gi',
  'get-itemproperty',
  'select-object',
  'select',
  'where-object',
  'format-table',
  'ft',
  'format-list',
  'fl',
  'convertfrom-json',
  'convertto-json',
  'get-filehash',
  'resolve-path',
  'split-path',
  'join-path',
  'get-process',
  'ps',
  'uname',
  'env'
])

/** Git subcommands that only look. */
const GIT_READ = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'remote',
  'rev-parse',
  'blame',
  'ls-files',
  'describe',
  'tag'
])

/** Program `--version` and `--help` only look, whatever the program. */
const LOOK_FLAGS = new Set(['--version', '-v', '-version', '--help', '-h', 'version'])

const DELETE = new Set([
  'rm',
  'rmdir',
  'rd',
  'del',
  'erase',
  'remove-item',
  'ri',
  'shred',
  'unlink',
  'clear-content',
  'clc',
  'clear-recyclebin'
])

const ADMIN = new Set(['sudo', 'su', 'doas', 'runas', 'pkexec', 'gsudo'])

const DISKS = new Set([
  'format',
  'diskpart',
  'mkfs',
  'fdisk',
  'parted',
  'format-volume',
  'clear-disk',
  'initialize-disk',
  'remove-partition',
  'diskutil',
  'dd',
  'cipher'
])

const SYSTEM = new Set([
  'reg',
  'regedit',
  'set-itemproperty',
  'new-itemproperty',
  'remove-itemproperty',
  'set-executionpolicy',
  'schtasks',
  'sc',
  'sc.exe',
  'netsh',
  'bcdedit',
  'shutdown',
  'restart-computer',
  'stop-computer',
  'launchctl',
  'systemctl',
  'crontab',
  'chown',
  'icacls',
  'takeown',
  'attrib',
  'setx',
  'defaults',
  'csrutil',
  'spctl',
  'set-mppreference',
  'add-mppreference',
  'new-service',
  'set-service',
  'stop-service',
  'kill',
  'taskkill',
  'stop-process',
  'pkill',
  'killall'
])

const LOGINS = new Set([
  'cmdkey',
  'vaultcmd',
  'security',
  'get-storedcredential',
  'keyring',
  'secret-tool',
  'git-credential',
  'mimikatz'
])

const NETWORK = new Set([
  'curl',
  'curl.exe',
  'wget',
  'invoke-webrequest',
  'iwr',
  'invoke-restmethod',
  'irm',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'nc',
  'ncat',
  'netcat',
  'telnet',
  'rsync',
  'start-bitstransfer',
  'bitsadmin',
  'certutil',
  'nslookup',
  'ping',
  'test-netconnection',
  'send-mailmessage'
])

/** Package managers and tools that reach the network for some subcommands. */
const NETWORK_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote', 'submodule']),
  npm: new Set(['install', 'i', 'ci', 'add', 'update', 'publish', 'exec', 'create', 'init']),
  pnpm: new Set(['install', 'i', 'add', 'update', 'publish', 'dlx', 'create']),
  yarn: new Set(['install', 'add', 'upgrade', 'publish', 'dlx', 'create']),
  pip: new Set(['install', 'download']),
  pip3: new Set(['install', 'download']),
  python: new Set(['-m']),
  brew: new Set(['install', 'upgrade', 'update']),
  winget: new Set(['install', 'upgrade']),
  choco: new Set(['install', 'upgrade']),
  npx: new Set(['*']),
  bunx: new Set(['*'])
}

/** Programs whose first word is a subcommand: "always" is per subcommand. */
const SUBCOMMANDS = new Set([
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'docker',
  'cargo',
  'go',
  'dotnet',
  'pip',
  'pip3',
  'kubectl',
  'gh',
  'brew',
  'winget',
  'choco'
])

/** Paths that hold saved logins or other tools' credentials. */
const LOGIN_PATHS =
  /(^|[\\/\s"'=])(\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|\.claude|\.codex|\.cursor|\.git-credentials|\.netrc|\.npmrc|\.env(\.[\w-]+)?|keychains?|login data|cookies|credentials?(\.json|\.xml)?|id_rsa|id_ed25519)([\\/\s"']|$)/i

/** Ways to hide what runs. */
const HIDDEN =
  /(\$\(|`|\binvoke-expression\b|\biex\b|-encodedcommand|-enc\s|\bbase64\s+(-d|--decode)|\|\s*(sh|bash|zsh|pwsh|powershell|cmd|python3?|node)\b|\beval\b|\bsource\b|\bstart-process\b.*-verb\s+runas)/i

/** Writing through redirection or a writing cmdlet. */
const WRITES =
  /(>|\bout-file\b|\bset-content\b|\badd-content\b|\btee\b|\btee-object\b|\bnew-item\b|\bcopy-item\b|\bmove-item\b|\brename-item\b)/i

/** Split a command line into its parts at `;`, `&&`, `||`, `|`, `&` and newlines (quotes respected). */
export function segments(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      current += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''))
}

/** The program a segment runs: its first word without leading env assignments, path or `.exe`. */
export function programOf(segment: string): { name: string; args: string[] } {
  const all = words(segment)
  let i = 0
  while (i < all.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(all[i])) i++
  if (all[i] === '&' || all[i] === '.') i++
  const raw = all[i] ?? ''
  const name = raw
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, '')
  return { name, args: all.slice(i + 1) }
}

export function classifyCommand(command: string): ShellVerdict {
  const parts = segments(command)
  if (parts.length === 0)
    return { risk: 'risky', reason: 'an empty command', standing: null, network: false }

  let risk = 'read-only' as ShellRisk
  let reason = 'only reads'
  let network = false
  const raise = (to: ShellRisk, why: string): void => {
    const order: ShellRisk[] = ['read-only', 'risky', 'always-asks']
    if (order.indexOf(to) > order.indexOf(risk)) {
      risk = to
      reason = why
    }
  }

  if (LOGIN_PATHS.test(command)) raise('always-asks', 'touches saved logins or credentials')
  if (HIDDEN.test(command)) raise('risky', 'hides what runs (a subshell or encoded command)')
  if (WRITES.test(command)) raise('risky', 'writes files')
  if (/https?:\/\//i.test(command)) network = true

  for (const part of parts) {
    const { name, args } = programOf(part)
    const sub = (args[0] ?? '').toLowerCase()
    if (DELETE.has(name)) raise('always-asks', 'deletes files')
    else if (ADMIN.has(name)) raise('always-asks', 'runs as administrator')
    else if (DISKS.has(name)) raise('always-asks', 'changes disks')
    else if (SYSTEM.has(name)) raise('always-asks', 'changes system settings or stops programs')
    else if (LOGINS.has(name)) raise('always-asks', 'touches saved logins')
    else if (NETWORK.has(name)) {
      network = true
      raise('risky', 'uses the internet')
    } else if (name === 'git' && sub === 'clean') raise('always-asks', 'deletes files')
    else if (name === 'git' && args.some((a) => a === '--force' || a === '-f') && sub === 'push')
      raise('always-asks', 'force-pushes')
    else if (name === 'git' && GIT_READ.has(sub)) {
      // Looks only.
    } else if (
      NETWORK_SUBCOMMANDS[name] &&
      (NETWORK_SUBCOMMANDS[name].has(sub) || NETWORK_SUBCOMMANDS[name].has('*'))
    ) {
      network = true
      raise('risky', 'uses the internet')
    } else if (READ_ONLY.has(name)) {
      if (name === 'find' || args.some((a) => /^-(delete|exec|execdir|ok)$/.test(a)))
        raise('risky', 'can run or delete through find')
    } else if (args.length === 1 && LOOK_FLAGS.has(sub)) {
      // `node --version`, `python -h`: only look.
    } else raise('risky', `runs ${name || 'a program'}`)
    if (name === 'find' && args.some((a) => /^-(delete|exec|execdir|ok)$/.test(a)))
      raise('risky', 'can run or delete through find')
  }

  let standing: string | null = null
  if (risk === 'risky' && parts.length === 1 && !HIDDEN.test(command)) {
    const { name, args } = programOf(parts[0])
    const sub = args[0]
    // "Always" covers `npm install` or `git commit`, or a whole program like `echo`.
    standing =
      SUBCOMMANDS.has(name) && sub && /^[a-z][a-z0-9:-]*$/i.test(sub)
        ? `${name} ${sub.toLowerCase()}`
        : name
  }
  return { risk, reason, standing, network }
}
