/**
 * The coding engine's programs, downloaded the first time the code builder
 * is used (decisions §53): OpenCode from npm, its official channel, and
 * ripgrep from its GitHub releases (OpenCode would otherwise fetch ripgrep
 * by itself). Each is a pinned version checked against a hash written here
 * before anything is unpacked; a file that doesn't match is thrown away.
 * Nothing is installed globally: both live in the app's data folder.
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'

export const OPENCODE_VERSION = '1.19.6'
export const RIPGREP_VERSION = '15.1.0'

type Platform = 'win32-x64' | 'win32-arm64' | 'darwin-arm64' | 'darwin-x64'

export interface ComponentSpec {
  id: 'opencode' | 'ripgrep'
  name: string
  version: string
  url: string
  /** `sha512-<base64>` (npm's integrity) or `sha256-<hex>`. */
  hash: string
  archive: 'tgz' | 'zip'
  /** The program's path inside the archive. */
  member: string
  /** Its file name once unpacked. */
  program: string
  /** Rough download size, for the "this downloads N MB" note. */
  bytes: number
}

const exe = (name: string, platform: Platform): string =>
  platform.startsWith('win32') ? `${name}.exe` : name

const OPENCODE_HASH: Record<Platform, string> = {
  'win32-x64':
    'sha512-qCh34hNhX4yaNmOfXZXjxbai5Y/HXgTgWKaTk/5TfDEAs+0QWr9OFiebJU/J3tvZnCLktjsEMAXJsoYwKI2mxg==',
  'win32-arm64':
    'sha512-vs0YKh09rQyDcr5bro3WL3MewGVT5EuPr990RtJFMk7o1fmUeGHAMlpMn42m50GsQpBEjRhG6JWbP5QEp7Mpvw==',
  'darwin-arm64':
    'sha512-GZjEsOTlr/e8fUF+lsFtTJGNIyHfUZcN9+iN6uXAbsH6t1PJABZrWE+5Lu2raX7g/EUXXCCB9NJ9L0AyMcWkKA==',
  'darwin-x64':
    'sha512-70AIcsjh9ywsh+cuRmSkMziKm/doJ0u9J/5BvU/ZCBpRYPWlKupGNWFRNua3xfjMqSjGuAmbQI2HjFpN+1OPyg=='
}

const RIPGREP: Record<Platform, { target: string; archive: 'tgz' | 'zip'; sha256: string }> = {
  'win32-x64': {
    target: 'x86_64-pc-windows-msvc',
    archive: 'zip',
    sha256: '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a'
  },
  'win32-arm64': {
    target: 'aarch64-pc-windows-msvc',
    archive: 'zip',
    sha256: '00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e'
  },
  'darwin-arm64': {
    target: 'aarch64-apple-darwin',
    archive: 'tgz',
    sha256: '378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715'
  },
  'darwin-x64': {
    target: 'x86_64-apple-darwin',
    archive: 'tgz',
    sha256: '64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882'
  }
}

export function currentPlatform(): Platform | null {
  const key = `${process.platform}-${process.arch}`
  return key in OPENCODE_HASH ? (key as Platform) : null
}

export function componentSpecs(platform: Platform): ComponentSpec[] {
  const os = platform.replace('win32', 'windows')
  const rg = RIPGREP[platform]
  const rgName = `ripgrep-${RIPGREP_VERSION}-${rg.target}`
  return [
    {
      id: 'opencode',
      name: 'OpenCode (the coding engine)',
      version: OPENCODE_VERSION,
      url: `https://registry.npmjs.org/opencode-${os}/-/opencode-${os}-${OPENCODE_VERSION}.tgz`,
      hash: OPENCODE_HASH[platform],
      archive: 'tgz',
      member: `package/bin/${exe('opencode', platform)}`,
      program: exe('opencode', platform),
      bytes: 80_000_000
    },
    {
      id: 'ripgrep',
      name: 'ripgrep (code search)',
      version: RIPGREP_VERSION,
      url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${rgName}.${rg.archive === 'zip' ? 'zip' : 'tar.gz'}`,
      hash: `sha256-${rg.sha256}`,
      archive: rg.archive,
      member: `${rgName}/${exe('rg', platform)}`,
      program: exe('rg', platform),
      bytes: 2_500_000
    }
  ]
}

export class ComponentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComponentError'
  }
}

/** Whether `data` matches a `sha512-<base64>` or `sha256-<hex>` hash. */
export function matchesHash(data: Uint8Array, hash: string): boolean {
  const [algorithm, expected] = [
    hash.slice(0, hash.indexOf('-')),
    hash.slice(hash.indexOf('-') + 1)
  ]
  if (algorithm === 'sha512') return createHash('sha512').update(data).digest('base64') === expected
  if (algorithm === 'sha256') return createHash('sha256').update(data).digest('hex') === expected
  return false
}

/** One file out of a gzipped tar (npm packages, ripgrep for macOS). */
export function fromTgz(archive: Uint8Array, member: string): Uint8Array | null {
  const tar = gunzipSync(archive)
  let offset = 0
  let longName: string | null = null
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) return null
    const field = (start: number, length: number): string =>
      Buffer.from(header.subarray(start, start + length))
        .toString('utf8')
        .replace(/\0.*$/s, '')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    longName = null
    const start = offset + 512
    const body = tar.subarray(start, start + size)
    if (type === 'L') longName = Buffer.from(body).toString('utf8').replace(/\0.*$/s, '')
    else if ((type === '0' || type === '') && name.replace(/^\.\//, '') === member) return body
    offset = start + Math.ceil(size / 512) * 512
  }
  return null
}

export interface ComponentStatus {
  id: ComponentSpec['id']
  name: string
  version: string
  ready: boolean
  bytes: number
}

export interface Components {
  status(): ComponentStatus[]
  /** Download whatever is missing; returns each program's path. */
  ensure(onProgress?: (note: string) => void): Promise<{ opencode: string; ripgrepDir: string }>
}

export function createComponents(deps: {
  /** Where the programs live: `<data>/components`. */
  dir: string
  fetch?: typeof fetch
  platform?: Platform | null
}): Components {
  const platform = deps.platform === undefined ? currentPlatform() : deps.platform
  const doFetch = deps.fetch ?? fetch
  const specs = platform ? componentSpecs(platform) : []
  const folderOf = (spec: ComponentSpec): string => join(deps.dir, spec.id, spec.version)
  const pathOf = (spec: ComponentSpec): string => join(folderOf(spec), spec.program)
  let running: ReturnType<Components['ensure']> | null = null

  async function install(spec: ComponentSpec, onProgress?: (note: string) => void): Promise<void> {
    onProgress?.(
      `Downloading ${spec.name} ${spec.version} (about ${Math.round(spec.bytes / 1e6)} MB)…`
    )
    let response: Response
    try {
      response = await doFetch(spec.url, { redirect: 'follow' })
    } catch {
      throw new ComponentError(
        `Couldn't download ${spec.name}: no internet connection. The code builder needs the internet once, to download it.`
      )
    }
    if (!response.ok)
      throw new ComponentError(
        `Couldn't download ${spec.name} (${response.status}). Try again later.`
      )
    const data = new Uint8Array(await response.arrayBuffer())
    if (!matchesHash(data, spec.hash))
      throw new ComponentError(
        `The ${spec.name} download didn't match its fingerprint, so it was thrown away. Nothing was installed.`
      )
    const program =
      spec.archive === 'tgz'
        ? fromTgz(data, spec.member)
        : (unzipSync(data, { filter: (f) => f.name === spec.member })[spec.member] ?? null)
    if (!program) throw new ComponentError(`The ${spec.name} download didn't contain the program.`)

    const folder = folderOf(spec)
    const partial = `${folder}.partial`
    await rm(partial, { recursive: true, force: true })
    await mkdir(partial, { recursive: true })
    await writeFile(join(partial, spec.program), program)
    if (process.platform !== 'win32') await chmod(join(partial, spec.program), 0o755)
    await rm(folder, { recursive: true, force: true })
    await rename(partial, folder)
    // Older versions go once the new one is in place.
    const root = join(deps.dir, spec.id)
    for (const entry of await readdir(root))
      if (entry !== spec.version) await rm(join(root, entry), { recursive: true, force: true })
  }

  return {
    status: () =>
      specs.map((spec) => ({
        id: spec.id,
        name: spec.name,
        version: spec.version,
        ready: existsSync(pathOf(spec)),
        bytes: spec.bytes
      })),

    ensure(onProgress) {
      if (!platform)
        return Promise.reject(
          new ComponentError(
            `The code builder doesn't run on ${process.platform} ${process.arch} yet.`
          )
        )
      running ??= (async () => {
        try {
          for (const spec of specs) {
            const ok = existsSync(pathOf(spec)) && (await stat(pathOf(spec))).size > 0
            if (!ok) await install(spec, onProgress)
          }
          const [opencode, ripgrep] = specs
          return { opencode: pathOf(opencode), ripgrepDir: folderOf(ripgrep) }
        } finally {
          running = null
        }
      })()
      return running
    }
  }
}
