/**
 * Share what you built (features 10.6, 18.6; decisions §66.23): an add-on made
 * on this laptop goes to a new public repository in the user's own GitHub
 * account, as the user, through their GitHub sign-in (§25). Our GitHub App can
 * create repositories and write files, but setting topics and forking need
 * "Administration: write", which it doesn't ask for (it would also let it
 * delete repositories), so the user adds the `titan117-addon` topic on
 * GitHub's own page, and suggestions to someone else's add-on go through
 * GitHub's own fork page.
 */
import type { AddonService } from './service'
import { AddonError } from './store'

const GITHUB = 'https://api.github.com'
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

function mit(year: number, holder: string): string {
  return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
}

function apache(year: number, holder: string): string {
  return `Copyright ${year} ${holder}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`
}

export async function publishAddon(
  service: AddonService,
  name: string,
  repoName: string,
  licence: 'MIT' | 'Apache-2.0' | 'none',
  token: string,
  fetch: Fetch
): Promise<{ url: string }> {
  const addon = service.store.get(name)
  if (!addon) throw new AddonError('There is no such add-on.')
  if (addon.repo)
    throw new AddonError(`${addon.title} comes from ${addon.repo}; it is already published.`)
  if (!REPO_NAME.test(repoName) || repoName.startsWith('.'))
    throw new AddonError(
      'Give the repository a short name of letters, digits, dots, dashes or underscores.'
    )
  const version = addon.versions.find((v) => v.id === addon.current)!
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
  const me = await fetch(`${GITHUB}/user`, { headers })
  if (!me.ok)
    throw new AddonError(
      'GitHub didn’t accept the sign-in. Sign in with GitHub again on the Code screen.'
    )
  const login = String(((await me.json()) as { login?: unknown }).login ?? '')
  const created = await fetch(`${GITHUB}/user/repos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: repoName,
      description: version.manifest.description.slice(0, 300),
      private: false
    })
  })
  if (created.status === 422)
    throw new AddonError(`You already have a repository called ${repoName}. Pick another name.`)
  if (created.status === 403)
    throw new AddonError(
      'Titan117’s GitHub App may not create repositories in your account. Make an empty public repository on GitHub, then try again with its name.'
    )
  if (!created.ok)
    throw new AddonError(`GitHub answered ${created.status} when making the repository.`)
  const repo = `${login}/${repoName}`

  const year = new Date().getFullYear()
  const files = new Map<string, Uint8Array>()
  for (const path of service.store.files(name))
    files.set(path, new Uint8Array(service.store.file(name, path)))
  if (licence !== 'none' && !files.has('LICENSE'))
    files.set(
      'LICENSE',
      new TextEncoder().encode(licence === 'MIT' ? mit(year, login) : apache(year, login))
    )
  if (!files.has('README.md'))
    files.set(
      'README.md',
      new TextEncoder().encode(
        `# ${version.manifest.title}\n\n${version.manifest.description}\n\nA Titan117 ${version.manifest.type} add-on. To install it, paste \`${repo}\` on the Add-ons screen in Titan117.\n`
      )
    )
  // One file at a time: GitHub's contents API isn't meant for parallel writes.
  for (const [path, data] of files) {
    const res = await fetch(
      `${GITHUB}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `Add ${path}`,
          content: Buffer.from(data).toString('base64')
        })
      }
    )
    if (!res.ok)
      throw new AddonError(
        `GitHub refused ${path} (${res.status}). The repository ${repo} was made; on GitHub, choose it for Titan117’s app (Choose repositories on the Code screen), then publish again.`
      )
  }
  service.store.setPublished(name, repo)
  return { url: `https://github.com/${repo}` }
}
