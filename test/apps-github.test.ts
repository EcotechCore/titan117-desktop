// Saving an app to the user's own GitHub (6.18, decisions §56.16): the
// repository is found or made through GitHub's API as the user, the app's
// versions are pushed (never forced, the token never on a command line or in
// the repository's settings), and each new version follows.
import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

import { findOrMakeRepo, newRepoUrl } from '../src/engine/lib/apps/github'
import { createAppService, type GitHubLink } from '../src/engine/lib/apps/service'
import { gitPushTo } from '../src/engine/lib/git'
import type { Runner } from '../src/engine/lib/apps/runner'
import type { BrowserTests } from '../src/engine/lib/apps/browsers'
import { tempFolder } from './helpers'

beforeAll(() => {
  const home = tempFolder('titan117-home-')
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = Test User\n\temail = test@example.com\n'
  )
  process.env.HOME = home
})

const TOKEN = 'ghu_0000000000000000000000000000testtoken'

/** A fake GitHub API: who is signed in, which repositories exist, and what POST /user/repos says. */
function fakeGitHub(options: { repos?: Record<string, 'empty' | 'used'>; create?: number }): {
  fetch: typeof fetch
  calls: string[]
} {
  const calls: string[] = []
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`)
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    if (url.endsWith('/user')) return Response.json({ login: 'ana' })
    const commits = /\/repos\/ana\/([^/]+)\/commits/.exec(url)
    if (commits)
      return new Response('{}', { status: options.repos?.[commits[1]] === 'empty' ? 409 : 200 })
    const repo = /\/repos\/ana\/([^/?]+)$/.exec(url)
    if (repo) return new Response('{}', { status: options.repos?.[repo[1]] ? 200 : 404 })
    if (url.endsWith('/user/repos') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; private: boolean }
      expect(body.private).toBe(true)
      return options.create === 201
        ? Response.json(
            {
              name: body.name,
              owner: { login: 'ana' },
              html_url: `https://github.com/ana/${body.name}`
            },
            { status: 201 }
          )
        : new Response('{"message":"Resource not accessible by integration"}', {
            status: options.create ?? 403
          })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { fetch: fake, calls }
}

describe('finding or making the repository', () => {
  it('makes a private repository in the user’s account', async () => {
    const gh = fakeGitHub({ create: 201 })
    const result = await findOrMakeRepo(gh.fetch, TOKEN, {
      name: 'cluj-bakery',
      description: 'Bread',
      private: true
    })
    expect(result).toEqual({
      status: 'saved',
      repo: { owner: 'ana', repo: 'cluj-bakery', url: 'https://github.com/ana/cluj-bakery' },
      created: true
    })
  })

  it('uses an empty repository of that name, and never one that has commits', async () => {
    const empty = fakeGitHub({ repos: { 'cluj-bakery': 'empty' } })
    expect(
      await findOrMakeRepo(empty.fetch, TOKEN, {
        name: 'cluj-bakery',
        description: '',
        private: true
      })
    ).toMatchObject({ status: 'saved', created: false, repo: { repo: 'cluj-bakery' } })
    expect(empty.calls.some((c) => c.startsWith('POST'))).toBe(false)

    const used = fakeGitHub({ repos: { 'cluj-bakery': 'used' }, create: 201 })
    expect(
      await findOrMakeRepo(used.fetch, TOKEN, {
        name: 'cluj-bakery',
        description: '',
        private: true
      })
    ).toMatchObject({ status: 'saved', created: true, repo: { repo: 'cluj-bakery-2' } })
  })

  it('sends the user to GitHub’s own page when our app may not make repositories', async () => {
    const gh = fakeGitHub({ create: 403 })
    const result = await findOrMakeRepo(gh.fetch, TOKEN, {
      name: 'cluj-bakery',
      description: 'Fresh bread',
      private: true
    })
    expect(result).toEqual({
      status: 'make-it',
      name: 'cluj-bakery',
      url: newRepoUrl('cluj-bakery', 'Fresh bread', true)
    })
    expect(result.status === 'make-it' && result.url).toMatch(
      /^https:\/\/github\.com\/new\?name=cluj-bakery&description=Fresh\+bread&visibility=private$/
    )
  })

  it('refuses a name GitHub would read as something else', async () => {
    await expect(
      findOrMakeRepo(fakeGitHub({}).fetch, TOKEN, { name: '../x', description: '', private: true })
    ).rejects.toThrow(/can't be a repository name/)
  })
})

describe('pushing', () => {
  function repoWithCommit(): { dir: string; remote: string } {
    const dir = tempFolder('titan117-push-')
    const remote = tempFolder('titan117-remote-')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'one'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
    return { dir, remote }
  }

  it('pushes the branch, keeps the token out of the repository’s settings, and never overwrites', async () => {
    const { dir, remote } = repoWithCommit()
    await gitPushTo(dir, 'origin', 'main', TOKEN)
    expect(
      execFileSync('git', ['log', '--format=%s', 'main'], { cwd: remote }).toString().trim()
    ).toBe('one')
    expect(readFileSync(join(dir, '.git', 'config'), 'utf8')).not.toContain('ghu_')

    // Someone changed the repository on GitHub: the push is refused, nothing is overwritten.
    const other = tempFolder('titan117-other-')
    execFileSync('git', ['clone', '-q', remote, other])
    writeFileSync(join(other, 'b.txt'), 'theirs\n')
    execFileSync('git', ['add', '.'], { cwd: other })
    execFileSync('git', ['commit', '-qm', 'theirs'], { cwd: other })
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: other })
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    execFileSync('git', ['commit', '-qam', 'two'], { cwd: dir })
    await expect(gitPushTo(dir, 'origin', 'main', TOKEN)).rejects.toThrow(/Nothing was overwritten/)
    expect(
      execFileSync('git', ['log', '-1', '--format=%s', 'main'], { cwd: remote }).toString().trim()
    ).toBe('theirs')
  })
})

describe('the app service and GitHub', () => {
  it('saves the app, then pushes each new version', async () => {
    let links: Record<string, GitHubLink> = {}
    const pushes: string[] = []
    const gh = fakeGitHub({ create: 201 })
    const apps = createAppService({
      runner: { preview: () => null } as unknown as Runner,
      browsers: {} as BrowserTests,
      coAuthor: () => true,
      github: {
        token: () => TOKEN,
        links: () => links,
        setLinks: (next) => (links = next),
        fetch: gh.fetch,
        push: async (dir, repo, token) => {
          expect(token).toBe(TOKEN)
          pushes.push(`${repo.owner}/${repo.repo}`)
          return { branch: 'main' }
        }
      }
    })
    const app = await apps.create(tempFolder('titan117-apps-'), {
      title: 'Cluj Bakery',
      description: 'Bread.'
    })
    expect(await apps.saveToGitHub(app.folder, { private: true })).toMatchObject({
      status: 'saved',
      created: true
    })
    expect(apps.info(app.folder).github).toMatchObject({
      owner: 'ana',
      repo: 'cluj-bakery',
      sync: true,
      error: null
    })

    writeFileSync(join(app.folder, 'src', 'x.ts'), 'export const x = 1\n')
    const version = await apps.saveVersion(app.folder, 'Add x')
    expect(version?.pushed).toBe('https://github.com/ana/cluj-bakery')
    expect(pushes).toEqual(['ana/cluj-bakery', 'ana/cluj-bakery'])

    // Stopped: new versions stay on the laptop.
    apps.stopGitHubSync(app.folder)
    writeFileSync(join(app.folder, 'src', 'y.ts'), 'export const y = 1\n')
    expect((await apps.saveVersion(app.folder, 'Add y'))?.pushed).toBeNull()
    expect(pushes).toHaveLength(2)
  })

  it('needs the GitHub sign-in, and a failed push never breaks saving a version', async () => {
    let links: Record<string, GitHubLink> = {}
    let token: string | null = null
    const apps = createAppService({
      runner: { preview: () => null } as unknown as Runner,
      browsers: {} as BrowserTests,
      coAuthor: () => true,
      github: {
        token: () => token,
        links: () => links,
        setLinks: (next) => (links = next),
        fetch: fakeGitHub({ create: 201 }).fetch,
        push: async () => {
          throw new Error('GitHub didn’t let Titan117 push to this repository.')
        }
      }
    })
    const app = await apps.create(tempFolder('titan117-apps-'), {
      title: 'Shop',
      description: 'A shop.'
    })
    await expect(apps.saveToGitHub(app.folder, { private: true })).rejects.toThrow(
      /Sign in with GitHub/
    )
    token = TOKEN
    await expect(apps.saveToGitHub(app.folder, { private: true })).rejects.toThrow(/didn’t let/)
    writeFileSync(join(app.folder, 'src', 'x.ts'), 'export const x = 1\n')
    const version = await apps.saveVersion(app.folder, 'Add x')
    expect(version?.sha).toBeTruthy()
    expect(version?.pushError).toMatch(/didn’t let/)
    expect(apps.info(app.folder).github?.error).toMatch(/didn’t let/)
  })
})
