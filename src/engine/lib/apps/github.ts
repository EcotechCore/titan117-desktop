/**
 * Saving an app to the user's own GitHub (6.18; decisions §25, §56.16): a
 * repository in the user's account, made through our GitHub App's sign-in
 * as the user, then the app's versions pushed to it, as the user. Our app
 * needs GitHub's "Repository creation" (or "Administration") permission to
 * make the repository; without it, the user makes an empty one on GitHub's
 * own page (filled in) and Titan117 uses it.
 */
import { gitPushTo, gitRemoteSet, gitStatus, GitError } from '../git'

export interface GitHubRepo {
  owner: string
  repo: string
  url: string
}

export type SaveResult =
  | { status: 'saved'; repo: GitHubRepo; created: boolean }
  /** Our app may not make repositories: the user makes an empty one on GitHub's page, then saves again. */
  | { status: 'make-it'; url: string; name: string }

const API = 'https://api.github.com'
const NAME = /^[A-Za-z0-9._-]{1,100}$/

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
}

/** GitHub's own "new repository" page, filled in. */
export function newRepoUrl(name: string, description: string, isPrivate: boolean): string {
  const q = new URLSearchParams({
    name,
    description: description.slice(0, 300),
    visibility: isPrivate ? 'private' : 'public'
  })
  return `https://github.com/new?${q}`
}

/** Whether a repository exists for this token and holds no commits yet. */
async function emptyRepo(
  fetchFn: typeof fetch,
  token: string,
  owner: string,
  name: string
): Promise<'empty' | 'used' | 'missing'> {
  const repo = await fetchFn(`${API}/repos/${owner}/${name}`, { headers: headers(token) })
  if (repo.status === 404) return 'missing'
  if (!repo.ok)
    throw new GitError(`GitHub answered ${repo.status} when looking for ${owner}/${name}.`)
  const commits = await fetchFn(`${API}/repos/${owner}/${name}/commits?per_page=1`, {
    headers: headers(token)
  })
  // GitHub answers 409 for a repository with no commits.
  return commits.status === 409 ? 'empty' : 'used'
}

/**
 * The repository to save into: the app's own `origin` on GitHub, an empty one
 * the user made with the app's name, or a new private one we make for them.
 */
export async function findOrMakeRepo(
  fetchFn: typeof fetch,
  token: string,
  input: { name: string; description: string; private: boolean }
): Promise<SaveResult> {
  if (!NAME.test(input.name)) throw new GitError(`"${input.name}" can't be a repository name.`)
  const me = await fetchFn(`${API}/user`, { headers: headers(token) })
  if (me.status === 401)
    throw new GitError(
      'Your GitHub sign-in has expired. Sign in with GitHub again on the Code screen.'
    )
  if (!me.ok) throw new GitError(`GitHub answered ${me.status}.`)
  const owner = String(((await me.json()) as { login?: string }).login ?? '')
  if (!owner) throw new GitError('GitHub didn’t say who is signed in.')

  // The first free name: the app's own, then -2 … -5. An empty repository of that name is used.
  let name = input.name
  for (let n = 2; ; n++) {
    const found = await emptyRepo(fetchFn, token, owner, name)
    if (found === 'empty')
      return {
        status: 'saved',
        repo: { owner, repo: name, url: `https://github.com/${owner}/${name}` },
        created: false
      }
    if (found === 'missing') break
    if (n > 5)
      throw new GitError(
        `${owner}/${input.name} and the next names are taken. Make an empty repository on GitHub and save again.`
      )
    name = `${input.name}-${n}`
  }

  const made = await fetchFn(`${API}/user/repos`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      name,
      description: input.description.slice(0, 300),
      private: input.private,
      auto_init: false
    })
  })
  if (made.status === 201) {
    const body = (await made.json()) as {
      name?: string
      owner?: { login?: string }
      html_url?: string
    }
    const repo = String(body.name ?? name)
    const login = String(body.owner?.login ?? owner)
    return {
      status: 'saved',
      repo: {
        owner: login,
        repo,
        url: String(body.html_url ?? `https://github.com/${login}/${repo}`)
      },
      created: true
    }
  }
  // Our app may not make repositories (403), or the name exists where our app can't see it (422).
  if (made.status === 403 || made.status === 404 || made.status === 422)
    return { status: 'make-it', name, url: newRepoUrl(name, input.description, input.private) }
  throw new GitError(`GitHub answered ${made.status} when making the repository.`)
}

/** Connect the app's folder to the repository and push its main branch (never forced). */
export async function pushApp(
  dir: string,
  repo: GitHubRepo,
  token: string | null
): Promise<{ branch: string }> {
  const status = await gitStatus(dir)
  if (!status.branch) throw new GitError('The app isn’t on a branch.')
  await gitRemoteSet(dir, 'origin', `https://github.com/${repo.owner}/${repo.repo}.git`)
  await gitPushTo(dir, 'origin', status.branch, token)
  return { branch: status.branch }
}
