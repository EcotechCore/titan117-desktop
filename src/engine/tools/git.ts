/**
 * Git for agents (13.7, decisions §25, §54): as the user, inside the allowed
 * folders. Looking runs at once; a branch or a commit asks (with "always in
 * this task"); pushing and opening a pull request are outward actions and
 * ask every time, on the laptop. The rules in lib/git.ts hold whatever is
 * approved: no force-push, no push to the main branch, no secrets committed.
 */
import { defineTool } from './lib/define-tool'
import { GitError } from '../lib/git'

const folderParam = {
  type: 'string',
  description: 'The repository folder (or any folder inside it), inside the allowed folders.'
} as const

export const gitStatusTool = defineTool<{ folder: string }>({
  name: 'git_status',
  description:
    'Show a git repository’s branch, its main branch, its GitHub remote, and the files changed since the last commit.',
  params: { type: 'object', properties: { folder: folderParam }, required: ['folder'] },
  risk: 'read',
  permissions: { git: 'read' },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Git status of ${input.folder}`,
  async run(input, ctx) {
    const s = await ctx.git.status(input.folder)
    const lines = [
      `Repository: ${s.root}`,
      `Branch: ${s.branch ?? '(none)'}${s.ahead || s.behind ? ` (ahead ${s.ahead}, behind ${s.behind})` : ''}`,
      `Main branch: ${s.defaultBranch ?? 'unknown'}`,
      `Remote: ${s.remote ? `${s.remote.name} ${s.remote.url}${s.remote.github ? ` (GitHub ${s.remote.github.owner}/${s.remote.github.repo})` : ''}` : 'none'}`,
      s.changes.length
        ? `Changed files:\n${s.changes.map((c) => `  ${c.status} ${c.path}`).join('\n')}`
        : 'No changes since the last commit.'
    ]
    return {
      output: lines.join('\n'),
      summary: `Git status of ${s.root}: ${s.changes.length} changed`
    }
  }
})

export const gitDiffTool = defineTool<{ folder: string; file?: string; staged?: boolean }>({
  name: 'git_diff',
  description:
    'Show what changed in a git repository since the last commit, as a diff (optionally one file).',
  params: {
    type: 'object',
    properties: {
      folder: folderParam,
      file: { type: 'string', description: 'Only this file (path inside the repository).' },
      staged: { type: 'boolean', description: 'Only what is staged for the next commit.' }
    },
    required: ['folder']
  },
  risk: 'read',
  permissions: { git: 'read' },
  untrustedOutput: true,
  privateOutput: true,
  describe: (input) => `Git diff in ${input.folder}${input.file ? ` (${input.file})` : ''}`,
  async run(input, ctx) {
    const diff = await ctx.git.diff(input.folder, { file: input.file, staged: input.staged })
    return {
      output: diff.trim() || '(no changes)',
      summary: `Git diff in ${input.folder}: ${diff.split('\n').length} lines`
    }
  }
})

export const gitBranchTool = defineTool<{ folder: string; name: string }>({
  name: 'git_branch',
  description:
    'Switch to a git branch, making it if it doesn’t exist. Do work on a branch of its own (for example "fix/cart-total"), never on the main branch.',
  params: {
    type: 'object',
    properties: { folder: folderParam, name: { type: 'string', description: 'The branch name.' } },
    required: ['folder', 'name']
  },
  risk: 'write',
  permissions: { git: 'write' },
  describe: (input) => `Switch ${input.folder} to the branch "${input.name}"`,
  async run(input, ctx) {
    const { created } = await ctx.git.branch(input.folder, input.name)
    return {
      output: `${created ? 'Made and switched to' : 'Switched to'} the branch "${input.name}".`,
      summary: `${created ? 'New branch' : 'Switched to branch'} ${input.name}`
    }
  }
})

export const gitCommitTool = defineTool<{ folder: string; message: string; files?: string[] }>({
  name: 'git_commit',
  description: [
    'Commit changes in a git repository, as the user (their own git name and email).',
    'Commits every change, or only the files listed. Write a short, clear message: a summary line, then details.',
    'Files holding secrets (.env, keys) and changes containing keys or tokens are refused.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      folder: folderParam,
      message: { type: 'string', description: 'The commit message.' },
      files: {
        type: 'array',
        description: 'Only these files (paths inside the repository). Default: every change.'
      }
    },
    required: ['folder', 'message']
  },
  risk: 'write',
  permissions: { git: 'write' },
  describe: (input) =>
    `Commit in ${input.folder}${input.files?.length ? ` (${input.files.length} files)` : ''}: ${String(
      input.message ?? ''
    )
      .split('\n')[0]
      .slice(0, 100)}`,
  async run(input, ctx) {
    if (
      input.files !== undefined &&
      !(Array.isArray(input.files) && input.files.every((f) => typeof f === 'string'))
    )
      throw new GitError('"files" must be a list of file paths.')
    const { sha, files } = await ctx.git.commit(input.folder, {
      message: input.message,
      files: input.files
    })
    return {
      output: `Committed ${sha} with ${files.length} file(s):\n${files.map((f) => `  ${f}`).join('\n')}`,
      summary: `Committed ${sha}: ${input.message.split('\n')[0].slice(0, 80)}`
    }
  }
})

export const gitPushTool = defineTool<{ folder: string }>({
  name: 'git_push',
  description:
    'Push the current branch to the repository’s remote (GitHub), as the user. Asks the user every time. Never pushes the main branch and never forces.',
  params: { type: 'object', properties: { folder: folderParam }, required: ['folder'] },
  risk: 'external',
  permissions: { git: 'write' },
  describe: (input) => `Push the current branch of ${input.folder} to its remote`,
  async run(input, ctx) {
    const { branch, remote } = await ctx.git.push(input.folder)
    return { output: `Pushed "${branch}" to ${remote}.`, summary: `Pushed ${branch} to ${remote}` }
  }
})

export const pullRequestTool = defineTool<{
  folder: string
  title: string
  body: string
  base?: string
}>({
  name: 'pull_request',
  description: [
    'Open a pull request on GitHub for the current branch (push it first), as the user. Asks the user every time.',
    'With GitHub’s own CLI signed in on the laptop it opens the pull request; otherwise it gives a link to GitHub’s',
    'page with everything filled in, where the user presses Create. Give the link to the user either way.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      folder: folderParam,
      title: { type: 'string', description: 'The pull request title.' },
      body: { type: 'string', description: 'What changed and why, and how it was tested.' },
      base: { type: 'string', description: 'The branch to merge into. Default: the main branch.' }
    },
    required: ['folder', 'title', 'body']
  },
  risk: 'external',
  permissions: { git: 'write' },
  describe: (input) =>
    `Open a pull request from ${input.folder}: ${String(input.title ?? '').slice(0, 100)}`,
  async run(input, ctx) {
    const pr = await ctx.git.pullRequest(input.folder, {
      title: input.title,
      body: input.body,
      base: input.base
    })
    return pr.how === 'opened'
      ? {
          output: `Opened the pull request: ${pr.url}`,
          summary: `Opened a pull request: ${pr.url}`
        }
      : {
          output: `GitHub’s CLI isn’t signed in on this laptop, so the pull request is ready for the user to open: ${pr.url}\nTell the user to open this link and press "Create pull request".`,
          summary: 'Pull request ready to open on GitHub'
        }
  }
})

export const gitTools = [
  gitStatusTool,
  gitDiffTool,
  gitBranchTool,
  gitCommitTool,
  gitPushTool,
  pullRequestTool
]
