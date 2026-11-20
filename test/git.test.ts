/**
 * Git as the user (13.7, decisions §25, §54), against real repositories: a
 * local bare repository stands in for GitHub.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CO_AUTHOR,
  compareUrl,
  githubOf,
  gitBranch,
  gitCommit,
  gitDiff,
  gitPush,
  gitStatus
} from '../src/engine/lib/git'
import { tempFolder } from './helpers'

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** A repository with one commit on main, pushed to a bare "remote". */
function repoWithRemote(): { repo: string; remote: string } {
  const remote = tempFolder('t117-git-remote-')
  sh(remote, 'init', '-q', '--bare', '-b', 'main')
  const repo = tempFolder('t117-git-repo-')
  sh(repo, 'init', '-q', '-b', 'main')
  sh(repo, 'config', 'user.name', 'Test User')
  sh(repo, 'config', 'user.email', 'test@example.com')
  sh(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-qm', 'Start')
  sh(repo, 'remote', 'add', 'origin', remote)
  sh(repo, 'push', '-q', '-u', 'origin', 'main')
  return { repo, remote }
}

describe('git, as the user', () => {
  it('reads the branch, the main branch, the remote and the changes', async () => {
    const { repo } = repoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    writeFileSync(join(repo, 'b.txt'), 'new\n')
    const s = await gitStatus(join(repo))
    expect(s.branch).toBe('main')
    expect(s.defaultBranch).toBe('main')
    expect(s.remote?.name).toBe('origin')
    expect(s.changes).toEqual(
      expect.arrayContaining([
        { status: ' M', path: 'a.txt' },
        { status: '??', path: 'b.txt' }
      ])
    )
    expect(await gitDiff(repo)).toContain('+two')
    await expect(gitStatus(tempFolder('t117-not-git-'))).rejects.toThrow(/isn’t a git repository/)
  })

  it('commits as the user with the Titan117 co-author line, or without it', async () => {
    const { repo } = repoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    const { files } = await gitCommit(repo, {
      message: 'Change a\n\nWhy it changed.',
      coAuthor: true
    })
    expect(files).toEqual(['a.txt'])
    expect(sh(repo, 'log', '-1', '--format=%an <%ae>')).toContain('Test User <test@example.com>')
    const body = sh(repo, 'log', '-1', '--format=%B')
    expect(body).toContain('Why it changed.')
    expect(body.trim().endsWith(CO_AUTHOR)).toBe(true)
    expect(sh(repo, 'log', '-1', '--format=%(trailers:key=Co-authored-by)')).toContain('Titan117')

    writeFileSync(join(repo, 'a.txt'), 'three\n')
    await gitCommit(repo, { message: 'Again', coAuthor: false })
    expect(sh(repo, 'log', '-1', '--format=%B')).not.toContain('Titan117')
    await expect(gitCommit(repo, { message: 'Nothing', coAuthor: true })).rejects.toThrow(
      /nothing to commit/
    )
  })

  it('never commits a .env file or a key, and leaves nothing staged', async () => {
    const { repo } = repoWithRemote()
    writeFileSync(join(repo, '.env'), 'DB_PASSWORD=hunter2hunter2\n')
    await expect(gitCommit(repo, { message: 'Add env', coAuthor: true })).rejects.toThrow(/\.env/)
    expect(sh(repo, 'diff', '--staged', '--name-only').trim()).toBe('')

    sh(repo, 'clean', '-fq')
    writeFileSync(join(repo, 'config.js'), `export const key = 'sk-or-v1-${'a'.repeat(40)}'\n`)
    await expect(gitCommit(repo, { message: 'Add config', coAuthor: true })).rejects.toThrow(
      /key or token/
    )
    expect(sh(repo, 'log', '-1', '--format=%s').trim()).toBe('Start')

    // An example file is fine.
    sh(repo, 'clean', '-fq')
    writeFileSync(join(repo, '.env.example'), 'DB_PASSWORD=\n')
    await expect(gitCommit(repo, { message: 'Example env', coAuthor: true })).resolves.toBeTruthy()
  })

  it('pushes a work branch, never the main branch', async () => {
    const { repo, remote } = repoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    await gitCommit(repo, { message: 'On main', coAuthor: true })
    await expect(gitPush(repo)).rejects.toThrow(/doesn’t push to "main"/)
    expect(sh(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('Start')

    expect(await gitBranch(repo, 'fix/a-text')).toEqual({ created: true })
    writeFileSync(join(repo, 'a.txt'), 'three\n')
    await gitCommit(repo, { message: 'Fix a', coAuthor: true })
    expect(await gitPush(repo)).toEqual({ branch: 'fix/a-text', remote: 'origin' })
    expect(sh(remote, 'log', '-1', '--format=%s', 'fix/a-text').trim()).toBe('Fix a')
    expect(await gitBranch(repo, 'fix/a-text')).toEqual({ created: false })
  })

  it('refuses branch names that could be read as options or paths', async () => {
    const { repo } = repoWithRemote()
    for (const name of ['--force', 'a..b', 'x.lock', 'bad name', ''])
      await expect(gitBranch(repo, name)).rejects.toThrow(/usable branch name/)
  })

  it('reads GitHub remotes and fills in the pull request page', () => {
    expect(githubOf('https://github.com/EcotechCore/titan117-web.git')).toEqual({
      owner: 'EcotechCore',
      repo: 'titan117-web'
    })
    expect(githubOf('git@github.com:a-b/c.d.git')).toEqual({ owner: 'a-b', repo: 'c.d' })
    expect(githubOf('https://gitlab.com/a/b.git')).toBeNull()
    const url = compareUrl({ owner: 'o', repo: 'r' }, 'main', 'fix/x', 'Fix x', 'Body & more')
    expect(url).toBe(
      'https://github.com/o/r/compare/main...fix%2Fx?expand=1&title=Fix+x&body=Body+%26+more'
    )
  })
})

// The tool-level denials (outside folders, read-only tools, approvals) are in tool-denials.test.ts.
