/**
 * Git for the code builder (13.7, decisions §25): the user's own git, with
 * their own name, email and sign-in (Git Credential Manager, SSH keys), so
 * every commit and push is theirs. Each agent commit carries a
 * `Co-authored-by: Titan117` line unless the user turned it off.
 *
 * Hard rules, whatever was approved: never a force-push, never a push to
 * the repo's default branch (work goes on a branch and a pull request),
 * never a commit that carries a key, a token or a `.env` file.
 *
 * Pull requests (decisions §25, §54): with GitHub's own CLI (`gh`) signed
 * in on the laptop, it opens the pull request as the user; otherwise the
 * user gets GitHub's "open a pull request" page, filled in, to press
 * Create. Our GitHub App's sign-in replaces both once it's registered.
 */
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'

import { looksSecret } from '../redact'
import { cleanEnv } from './shell'

export const CO_AUTHOR = 'Co-authored-by: Titan117 <noreply@titan117.com>'

const MAX_DIFF = 60_000
const TIMEOUT_MS = 120_000

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitChange {
  path: string
  /** Two letters from `git status --porcelain`: `M `, ` M`, `??`, `A `, `D `… */
  status: string
}

export interface GitStatus {
  root: string
  branch: string | null
  /** The remote's default branch (`main`, `master`…), when known. */
  defaultBranch: string | null
  remote: { name: string; url: string; github: { owner: string; repo: string } | null } | null
  ahead: number
  behind: number
  changes: GitChange[]
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function gitEnv(): Record<string, string> {
  const extra: Record<string, string> = {
    // Never wait on a password prompt in a terminal nobody sees.
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1'
  }
  // The user's SSH agent, so pushes over SSH work as they do in their terminal.
  if (process.env.SSH_AUTH_SOCK) extra.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK
  return cleanEnv(process.env, tmpdir(), extra)
}

function run(program: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      { cwd, env: gitEnv(), timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code
        if (code === 'ENOENT')
          return reject(
            new GitError(
              program === 'git'
                ? 'Git isn’t installed on this laptop. Install it from git-scm.com, then try again.'
                : `${program} isn’t installed.`
            )
          )
        resolve({ code: typeof code === 'number' ? code : error ? 1 : 0, stdout, stderr })
      }
    )
  })
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await run('git', args, cwd)
  if (result.code !== 0)
    throw new GitError(
      (result.stderr || result.stdout).trim().split('\n').slice(-4).join('\n') ||
        `git ${args[0]} failed.`
    )
  return result.stdout
}

/** owner/repo from a GitHub remote URL (https or SSH), or null. */
export function githubOf(url: string): { owner: string; repo: string } | null {
  const m =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      url.trim()
    )
  return m ? { owner: m[1], repo: m[2] } : null
}

/** A remote URL without any user or token in it, for showing and logging. */
function safeUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^@/]+@/, '$1')
}

export async function gitStatus(dir: string): Promise<GitStatus> {
  const inside = await run('git', ['rev-parse', '--show-toplevel'], dir)
  if (inside.code !== 0) throw new GitError(`"${dir}" isn’t a git repository.`)
  const root = inside.stdout.trim()
  const porcelain = await git(root, 'status', '--porcelain=v1', '--branch', '-z')
  const entries = porcelain.split('\0').filter(Boolean)
  const head = entries[0]?.startsWith('## ') ? entries.shift()!.slice(3) : ''
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  if (head && !head.startsWith('HEAD (no branch)')) {
    branch =
      head
        .replace(/^No commits yet on /, '')
        .split('...')[0]
        .split(' ')[0] || null
    ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
    behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  }
  const changes: GitChange[] = []
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2)
    changes.push({ status, path: entries[i].slice(3) })
    // A rename's old name follows as its own entry.
    if (status.startsWith('R') || status.startsWith('C')) i++
  }

  const remotes = (await git(root, 'remote')).split('\n').filter(Boolean)
  const remoteName = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
  let remote: GitStatus['remote'] = null
  let defaultBranch: string | null = null
  if (remoteName) {
    const url = (await git(root, 'remote', 'get-url', remoteName)).trim()
    remote = { name: remoteName, url: safeUrl(url), github: githubOf(url) }
    const headRef = await run(
      'git',
      ['symbolic-ref', '--short', `refs/remotes/${remoteName}/HEAD`],
      root
    )
    if (headRef.code === 0) defaultBranch = headRef.stdout.trim().replace(`${remoteName}/`, '')
  }
  if (!defaultBranch) {
    const local = (await git(root, 'branch', '--format=%(refname:short)')).split('\n')
    defaultBranch = ['main', 'master'].find((b) => local.includes(b)) ?? null
  }
  return { root, branch, defaultBranch, remote, ahead, behind, changes }
}

export async function gitDiff(
  dir: string,
  options: { staged?: boolean; file?: string } = {}
): Promise<string> {
  const args = ['diff', '--no-color', '--no-ext-diff']
  if (options.staged) args.push('--staged')
  if (options.file) args.push('--', options.file)
  const text = await git(dir, ...args)
  return text.length > MAX_DIFF
    ? `${text.slice(0, MAX_DIFF)}\n[The diff is longer; only its start is shown.]`
    : text
}

const BRANCH_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,100}(?<![./])$/

export async function gitBranch(dir: string, name: string): Promise<{ created: boolean }> {
  if (!BRANCH_NAME.test(name) || name.endsWith('.lock'))
    throw new GitError(`"${name}" isn’t a usable branch name.`)
  const exists =
    (await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], dir)).code === 0
  await git(dir, ...(exists ? ['switch', name] : ['switch', '-c', name]))
  return { created: !exists }
}

/** Paths that must never be committed (guardrails §8). */
function secretPath(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]+/)
  const name = parts[parts.length - 1] ?? ''
  if (name === '.env.example' || name === '.env.sample' || name === '.env.template') return false
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    /\.(pem|key|p12|pfx)$/.test(name) ||
    ['id_rsa', 'id_ed25519', '.npmrc', '.netrc', '.git-credentials', 'credentials.json'].includes(
      name
    ) ||
    parts.some((p) => ['.ssh', '.aws', '.gnupg'].includes(p))
  )
}

export async function gitCommit(
  dir: string,
  input: { message: string; files?: string[]; coAuthor: boolean }
): Promise<{ sha: string; files: string[] }> {
  const message = input.message.trim()
  if (!message) throw new GitError('A commit needs a message.')
  if (input.files?.length) await git(dir, 'add', '--', ...input.files)
  else await git(dir, 'add', '--all')
  const staged = (await git(dir, 'diff', '--staged', '--name-only', '-z'))
    .split('\0')
    .filter(Boolean)
  if (!staged.length) throw new GitError('There is nothing to commit.')

  // Nothing secret goes into history: unstage and refuse.
  const badPath = staged.find(secretPath)
  const addedLines = (await git(dir, 'diff', '--staged', '--no-color', '-U0'))
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n')
  if (badPath || looksSecret(addedLines)) {
    await git(dir, 'reset', '-q')
    throw new GitError(
      badPath
        ? `Not committed: "${badPath}" holds secrets (keys, passwords) and must not go into git. Nothing was committed.`
        : 'Not committed: the changes contain something that looks like a key or token. Remove it first. Nothing was committed.'
    )
  }

  const full = input.coAuthor ? `${message}\n\n${CO_AUTHOR}` : message
  // One -m per paragraph: git joins them with a blank line, so the trailer stays a trailer.
  const paragraphs = full.split(/\n{2,}/)
  const commit = await run('git', ['commit', '-q', ...paragraphs.flatMap((p) => ['-m', p])], dir)
  if (commit.code !== 0) {
    const why = (commit.stderr || commit.stdout).trim()
    if (/user\.(name|email)|identity unknown/i.test(why))
      throw new GitError(
        'Git doesn’t know your name and email yet. Set them once in a terminal: git config --global user.name "Your Name" and git config --global user.email "you@example.com".'
      )
    throw new GitError(why.split('\n').slice(-4).join('\n') || 'The commit failed.')
  }
  const sha = (await git(dir, 'rev-parse', '--short', 'HEAD')).trim()
  return { sha, files: staged }
}

export async function gitPush(dir: string): Promise<{ branch: string; remote: string }> {
  const status = await gitStatus(dir)
  if (!status.remote) throw new GitError('This repository has no remote to push to.')
  if (!status.branch) throw new GitError('Not on a branch: switch to a branch first.')
  const protectedNames = new Set([
    'main',
    'master',
    ...(status.defaultBranch ? [status.defaultBranch] : [])
  ])
  if (protectedNames.has(status.branch))
    throw new GitError(
      `Titan117 doesn’t push to "${status.branch}", the main branch. Make a branch for the work, push that, and open a pull request.`
    )
  // Never --force, in any form.
  await git(dir, 'push', '--set-upstream', status.remote.name, `${status.branch}:${status.branch}`)
  return { branch: status.branch, remote: status.remote.name }
}

/** GitHub's own page for opening a pull request, filled in (exported for tests). */
export function compareUrl(
  github: { owner: string; repo: string },
  base: string,
  head: string,
  title: string,
  body: string
): string {
  const query = new URLSearchParams({ expand: '1', title, body: body.slice(0, 4000) })
  return `https://github.com/${github.owner}/${github.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${query}`
}

export interface PullRequestResult {
  /** `opened`: gh opened it as the user. `link`: the user presses Create on GitHub's page. */
  how: 'opened' | 'link'
  url: string
}

export async function openPullRequest(
  dir: string,
  input: { title: string; body: string; base?: string }
): Promise<PullRequestResult> {
  const status = await gitStatus(dir)
  if (!status.remote?.github)
    throw new GitError('Pull requests work with repositories on GitHub; this one’s remote isn’t.')
  if (!status.branch) throw new GitError('Not on a branch.')
  const base = input.base ?? status.defaultBranch ?? 'main'
  if (status.branch === base)
    throw new GitError(`The work is on "${base}" itself; make a branch and push it first.`)
  const pushed = await run(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/remotes/${status.remote.name}/${status.branch}`],
    dir
  )
  if (pushed.code !== 0)
    throw new GitError(`Push "${status.branch}" first (git_push), then open the pull request.`)

  // GitHub's own CLI, if the user has it and is signed in: it acts as them.
  const auth = await run('gh', ['auth', 'status', '--hostname', 'github.com'], dir).catch(
    () => null
  )
  if (auth && auth.code === 0) {
    const created = await run(
      'gh',
      [
        'pr',
        'create',
        '--title',
        input.title,
        '--body',
        input.body,
        '--base',
        base,
        '--head',
        status.branch
      ],
      dir
    )
    const url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.stdout + created.stderr)?.[0]
    if (created.code === 0 && url) return { how: 'opened', url }
    const existing = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.stderr)?.[0]
    if (existing) return { how: 'opened', url: existing }
  }
  return {
    how: 'link',
    url: compareUrl(status.remote.github, base, status.branch, input.title, input.body)
  }
}
