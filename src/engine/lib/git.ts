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
import { realFolder } from './folders'
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

function run(
  program: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      {
        cwd,
        env: { ...gitEnv(), ...extraEnv },
        timeout: TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      },
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

/**
 * A project's root folder, written one way (the real path), so project
 * memory (13.8) finds the same project from any folder inside it: the git
 * repository's top folder, or the folder itself when it isn't a repository.
 */
export async function projectRootOf(dir: string): Promise<string> {
  const top = await run('git', ['rev-parse', '--show-toplevel'], dir).catch(() => null)
  return realFolder(top && top.code === 0 && top.stdout.trim() ? top.stdout.trim() : dir)
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
  options: { staged?: boolean; file?: string; base?: string } = {}
): Promise<string> {
  const args = ['diff', '--no-color', '--no-ext-diff']
  if (options.staged) args.push('--staged')
  // A branch's work since it left `base` (to review the whole branch).
  if (options.base) {
    if (!BRANCH_NAME.test(options.base))
      throw new GitError(`"${options.base}" isn’t a branch name.`)
    args.push(`${options.base}...HEAD`)
  }
  if (options.file) args.push('--', options.file)
  const text = await git(dir, ...args)
  return text.length > MAX_DIFF
    ? `${text.slice(0, MAX_DIFF)}\n[The diff is longer; only its start is shown.]`
    : text
}

/** Lines added and removed per changed file since the last commit (new files counted whole). */
export async function gitChangedFiles(
  dir: string
): Promise<Map<string, { file: string; additions: number; deletions: number }>> {
  const out = new Map<string, { file: string; additions: number; deletions: number }>()
  const numstat = await run('git', ['diff', 'HEAD', '--numstat'], dir)
  if (numstat.code === 0)
    for (const line of numstat.stdout.split('\n')) {
      const [a, d, file] = line.split('\t')
      if (file) out.set(file, { file, additions: Number(a) || 0, deletions: Number(d) || 0 })
    }
  const untracked = await run('git', ['ls-files', '--others', '--exclude-standard'], dir)
  if (untracked.code === 0)
    for (const file of untracked.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean))
      if (!out.has(file)) out.set(file, { file, additions: 0, deletions: 0 })
  return out
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

/** Opens a pull request through GitHub's API; its address, or null when GitHub said no. */
export async function createWithApi(
  fetchFn: typeof fetch,
  token: string,
  repo: { owner: string; repo: string },
  pr: { title: string; body: string; head: string; base: string }
): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
  const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls`
  const created = await fetchFn(base, { method: 'POST', headers, body: JSON.stringify(pr) })
  if (created.status === 201)
    return String(((await created.json()) as { html_url?: string }).html_url ?? '') || null
  // One already open for this branch: that one.
  if (created.status === 422) {
    const open = await fetchFn(
      `${base}?state=open&head=${encodeURIComponent(`${repo.owner}:${pr.head}`)}`,
      {
        headers
      }
    )
    if (open.ok) {
      const list = (await open.json()) as { html_url?: string }[]
      if (list[0]?.html_url) return list[0].html_url
    }
  }
  return null
}

export async function openPullRequest(
  dir: string,
  input: { title: string; body: string; base?: string },
  options: { githubToken?: string | null; fetch?: typeof fetch } = {}
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

  // The user's GitHub sign-in through our app (decisions §25): GitHub shows the user, with the app's badge.
  if (options.githubToken) {
    const made = await createWithApi(
      options.fetch ?? fetch,
      options.githubToken,
      status.remote.github,
      { title: input.title, body: input.body, head: status.branch, base }
    ).catch(() => null)
    if (made) return { how: 'opened', url: made }
  }

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

/** A new repository on `main`, for a new app project (6.13: its first version). */
export async function gitInit(dir: string): Promise<void> {
  const inside = await run('git', ['rev-parse', '--show-toplevel'], dir)
  if (inside.code === 0) return
  await git(dir, 'init', '-q', '-b', 'main')
}

export interface GitVersion {
  sha: string
  subject: string
  /** Unix milliseconds. */
  at: number
}

/** The latest commits on the current branch, newest first (an app's versions, 6.13). */
export async function gitLog(dir: string, limit = 50): Promise<GitVersion[]> {
  const result = await run(
    'git',
    ['log', `-${Math.min(Math.max(limit, 1), 500)}`, '--format=%h%x1f%s%x1f%ct'],
    dir
  )
  if (result.code !== 0) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, at] = line.split('\x1f')
      return { sha, subject, at: Number(at) * 1000 }
    })
}

/**
 * Put every file back as it was at `sha`, as a new commit on top (6.13:
 * one-click rollback). History is kept, so the rollback can be undone too.
 */
export async function gitRestore(
  dir: string,
  sha: string,
  input: { message: string; coAuthor: boolean }
): Promise<{ sha: string }> {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new GitError(`"${sha}" isn’t a version.`)
  const status = await gitStatus(dir)
  if (status.changes.length)
    throw new GitError(
      'There are changes not saved as a version yet. Save or undo them first, then go back.'
    )
  await git(dir, 'cat-file', '-e', `${sha}^{commit}`)
  await git(dir, 'restore', `--source=${sha}`, '--staged', '--worktree', '--', '.')
  const after = await gitStatus(dir)
  if (!after.changes.length) throw new GitError('That version is the same as the current one.')
  return { sha: (await gitCommit(dir, { ...input })).sha }
}

/** Point a remote at a URL, adding it if it's new (an app's own repository, 6.18). */
export async function gitRemoteSet(dir: string, name: string, url: string): Promise<void> {
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(name)) throw new GitError(`"${name}" isn’t a remote name.`)
  if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\.git$/.test(url))
    throw new GitError('Only a GitHub repository address can be used here.')
  const has = (await git(dir, 'remote')).split(/\r?\n/).includes(name)
  await git(dir, 'remote', ...(has ? ['set-url', name, url] : ['add', name, url]))
}

/**
 * Push one branch of an app's own repository (6.18, decisions §56.16): the
 * same branch name on the remote, never forced. With the user's GitHub
 * sign-in token, git gets it as a header through its environment (never on
 * a command line, never saved in the repository's settings); without it,
 * the user's own git sign-in is used.
 */
export async function gitPushTo(
  dir: string,
  remote: string,
  branch: string,
  token: string | null
): Promise<void> {
  if (!BRANCH_NAME.test(branch)) throw new GitError(`"${branch}" isn’t a branch name.`)
  const env: Record<string, string> = token
    ? {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
      }
    : {}
  const result = await run(
    'git',
    ['push', '--set-upstream', remote, `${branch}:${branch}`],
    dir,
    env
  )
  if (result.code === 0) return
  const why = `${result.stderr}\n${result.stdout}`
  if (/non-fast-forward|fetch first|rejected/i.test(why))
    throw new GitError(
      'GitHub has changes this app doesn’t have (someone changed the repository on GitHub). Nothing was overwritten.'
    )
  if (/403|not found|denied|Authentication failed|could not read Username/i.test(why))
    throw new GitError(
      'GitHub didn’t let Titan117 push to this repository. On the Code screen, under GitHub, press Change repositories and add it.'
    )
  throw new GitError(why.trim().split('\n').slice(-3).join('\n') || 'The push failed.')
}
