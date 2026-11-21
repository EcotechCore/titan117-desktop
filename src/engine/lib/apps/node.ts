/**
 * Node.js for the app builder (6.1, 6.28; decisions §56): the official
 * build from nodejs.org, downloaded the first time an app is built and
 * checked against the SHA-256 written here (from the release's
 * SHASUMS256.txt) before anything is unpacked. It lives in the app's data
 * folder; nothing is installed system-wide, and the user's own Node is
 * never used or changed. Its npm installs and runs the apps' packages.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'

export const NODE_VERSION = '26.13.1'

export type Platform = 'win32-x64' | 'win32-arm64' | 'darwin-arm64' | 'darwin-x64'

const NODE: Record<Platform, { file: string; sha256: string; bytes: number }> = {
  'win32-x64': {
    file: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: 'e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7',
    bytes: 41_000_000
  },
  'win32-arm64': {
    file: `node-v${NODE_VERSION}-win-arm64.zip`,
    sha256: '181ebe431b90787113a9e4fc80d38ce86d37888a353a0386de44d2872e48cb97',
    bytes: 38_000_000
  },
  'darwin-arm64': {
    file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: 'aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735',
    bytes: 50_000_000
  },
  'darwin-x64': {
    file: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: '82bb96078a24ca50b9c9a38f2379e6be6d87171fcd400fc14c8934b3bce96e2f',
    bytes: 52_000_000
  }
}

export class NodeDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NodeDownloadError'
  }
}

export interface NodeRuntime {
  /** The `node` program. */
  node: string
  /** npm's entry script, run with `node`. */
  npmCli: string
  /** The folder holding `node`, put first on the PATH of what runs inside an app. */
  binDir: string
}

export interface NodeComponent {
  status(): { version: string; ready: boolean; bytes: number }
  ensure(onProgress?: (note: string) => void): Promise<NodeRuntime>
}

function platformOf(): Platform | null {
  const key = `${process.platform}-${process.arch}`
  return key in NODE ? (key as Platform) : null
}

/** Each file of a gzipped tar with its mode, top folder stripped. */
export function tarFiles(archive: Uint8Array): { path: string; mode: number; data: Uint8Array }[] {
  const tar = gunzipSync(archive)
  const out: { path: string; mode: number; data: Uint8Array }[] = []
  let offset = 0
  let longName: string | null = null
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const field = (start: number, length: number): string =>
      Buffer.from(header.subarray(start, start + length))
        .toString('utf8')
        .replace(/\0.*$/s, '')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const mode = parseInt(field(100, 8).trim() || '644', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    longName = null
    const start = offset + 512
    const body = tar.subarray(start, start + size)
    if (type === 'L') longName = Buffer.from(body).toString('utf8').replace(/\0.*$/s, '')
    else if (type === '0' || type === '')
      out.push({ path: name.replace(/^\.\//, '').split('/').slice(1).join('/'), mode, data: body })
    offset = start + Math.ceil(size / 512) * 512
  }
  return out
}

/** A path inside `root`, or null when an archive entry would land outside it. */
export function safeJoin(root: string, path: string): string | null {
  if (!path || path.includes('\0')) return null
  const full = normalize(join(root, path))
  return full.startsWith(normalize(root) + sep) ? full : null
}

export function createNodeComponent(deps: {
  /** `<data>/components/node` */
  dir: string
  fetch?: typeof fetch
  /** The laptop's system; tests name one. */
  platform?: Platform | null
}): NodeComponent {
  const platform = deps.platform === undefined ? platformOf() : deps.platform
  const doFetch = deps.fetch ?? fetch
  const folder = join(deps.dir, NODE_VERSION)
  const win = platform ? platform.startsWith('win32') : process.platform === 'win32'
  const runtime: NodeRuntime = {
    node: win ? join(folder, 'node.exe') : join(folder, 'bin', 'node'),
    npmCli: win
      ? join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : join(folder, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    binDir: win ? folder : join(folder, 'bin')
  }
  let running: Promise<NodeRuntime> | null = null

  async function install(onProgress?: (note: string) => void): Promise<void> {
    if (!platform)
      throw new NodeDownloadError(
        `The app builder doesn't run on ${process.platform} ${process.arch} yet.`
      )
    const spec = NODE[platform]
    onProgress?.(
      `Downloading Node.js ${NODE_VERSION} (about ${Math.round(spec.bytes / 1e6)} MB), once…`
    )
    let response: Response
    try {
      response = await doFetch(`https://nodejs.org/dist/v${NODE_VERSION}/${spec.file}`, {
        redirect: 'follow'
      })
    } catch {
      throw new NodeDownloadError(
        "Couldn't download Node.js: no internet connection. The app builder needs the internet once, to download it."
      )
    }
    if (!response.ok)
      throw new NodeDownloadError(
        `Couldn't download Node.js (${response.status}). Try again later.`
      )
    const data = new Uint8Array(await response.arrayBuffer())
    if (createHash('sha256').update(data).digest('hex') !== spec.sha256)
      throw new NodeDownloadError(
        "The Node.js download didn't match its fingerprint, so it was thrown away. Nothing was installed."
      )

    const files: { path: string; mode: number; data: Uint8Array }[] = spec.file.endsWith('.zip')
      ? Object.entries(unzipSync(data))
          .filter(([name]) => !name.endsWith('/'))
          .map(([name, body]) => ({
            path: name.split('/').slice(1).join('/'),
            mode: 0o644,
            data: body
          }))
      : tarFiles(data)

    const partial = `${folder}.partial`
    await rm(partial, { recursive: true, force: true })
    await mkdir(partial, { recursive: true })
    for (const file of files) {
      const target = safeJoin(partial, file.path)
      if (!target)
        throw new NodeDownloadError('The Node.js download had a file outside its folder.')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.data)
      if (!win && file.mode & 0o111) await chmod(target, 0o755)
    }
    await rm(folder, { recursive: true, force: true })
    await rename(partial, folder)
    for (const entry of await readdir(deps.dir))
      if (entry !== NODE_VERSION) await rm(join(deps.dir, entry), { recursive: true, force: true })
  }

  return {
    status: () => ({
      version: NODE_VERSION,
      ready: existsSync(runtime.node) && existsSync(runtime.npmCli),
      bytes: platform ? NODE[platform].bytes : 0
    }),
    ensure(onProgress) {
      running ??= (async () => {
        try {
          if (!(existsSync(runtime.node) && existsSync(runtime.npmCli))) await install(onProgress)
          return runtime
        } finally {
          running = null
        }
      })()
      return running
    }
  }
}
