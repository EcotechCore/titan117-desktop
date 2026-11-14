/**
 * Files only inside allowed folders (guardrails §4). Every path is resolved
 * and checked after following links, so `../` and symlinks can't escape.
 * Tools never import `fs`: they get a `FileAccess` from the permission layer.
 */
import { promises as fs, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export class PermissionError extends Error {
  readonly code = 'PERMISSION_DENIED'
  constructor(message: string) {
    super(message)
    this.name = 'PermissionError'
  }
}

/**
 * Places no agent may reach even inside an allowed folder: saved logins and
 * other tools' credentials (guardrails §8), and our own core (guardrails §4).
 */
const DENIED_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  '.claude',
  '.codex',
  '.cursor',
  '.npmrc',
  '.netrc',
  '.git-credentials'
])

function isCredentialPath(realPath: string): boolean {
  const segments = realPath.split(/[\\/]+/).map((s) => s.toLowerCase())
  return segments.some(
    (segment, i) =>
      DENIED_SEGMENTS.has(segment) ||
      segment === '.env' ||
      segment.startsWith('.env.') ||
      (segment === 'gcloud' && segments[i - 1] === '.config')
  )
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function comparable(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** The real path of `target`, or of its nearest existing parent plus the rest. */
async function realTarget(target: string): Promise<string> {
  let current = target
  const rest: string[] = []
  for (;;) {
    try {
      const real = await fs.realpath(current)
      return rest.length ? join(real, ...rest.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return target
      rest.push(basename(current))
      current = parent
    }
  }
}

export interface FolderEntry {
  name: string
  kind: 'file' | 'folder'
  sizeBytes: number
}

export interface FileAccess {
  list(path: string): Promise<FolderEntry[]>
  read(path: string, maxBytes?: number): Promise<{ text: string; truncated: boolean }>
  write(path: string, text: string): Promise<{ bytes: number; created: boolean }>
}

export interface FolderPolicy {
  /** Folders the user allowed, as real paths. */
  allowed: string[]
  /** Folders that are never reachable: the app itself and its data. */
  core: string[]
}

export function realFolder(path: string): string {
  return realpathSync.native(resolve(path))
}

/**
 * Resolve a path a tool was given and refuse it unless it sits inside an
 * allowed folder. Relative paths are relative to the first allowed folder.
 */
export async function resolveAllowed(policy: FolderPolicy, path: string): Promise<string> {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0'))
    throw new PermissionError('That is not a valid path.')
  if (policy.allowed.length === 0)
    throw new PermissionError('No folder is allowed yet. Choose a folder first.')

  const absolute = isAbsolute(path) ? resolve(path) : resolve(policy.allowed[0], path)
  const real = await realTarget(absolute)
  const realCmp = comparable(real)

  for (const core of policy.core)
    if (isInside(realCmp, comparable(core)))
      throw new PermissionError('The app and its own data are off-limits to agents.')

  const home = policy.allowed.find((folder) => isInside(realCmp, comparable(folder)))
  if (!home) throw new PermissionError(`"${path}" is outside the folders you allowed.`)

  if (isCredentialPath(real))
    throw new PermissionError('Saved logins and credential folders are off-limits to agents.')

  return real
}

const DEFAULT_READ_BYTES = 200_000
const MAX_WRITE_BYTES = 5_000_000

export function createFileAccess(
  policy: FolderPolicy,
  mode: 'read' | 'write' | undefined
): FileAccess {
  function need(wanted: 'read' | 'write'): void {
    if (!mode) throw new PermissionError('This tool did not declare access to folders.')
    if (wanted === 'write' && mode !== 'write')
      throw new PermissionError('This tool may read folders, not change them.')
  }

  return {
    async list(path) {
      need('read')
      const real = await resolveAllowed(policy, path)
      const entries = await fs.readdir(real, { withFileTypes: true })
      const out: FolderEntry[] = []
      for (const entry of entries.slice(0, 500)) {
        const kind = entry.isDirectory() ? 'folder' : 'file'
        let sizeBytes = 0
        if (kind === 'file') {
          try {
            sizeBytes = (await fs.stat(join(real, entry.name))).size
          } catch {
            // A broken link: listed, with no size.
          }
        }
        out.push({ name: entry.name, kind, sizeBytes })
      }
      return out
    },

    async read(path, maxBytes = DEFAULT_READ_BYTES) {
      need('read')
      const real = await resolveAllowed(policy, path)
      const handle = await fs.open(real, 'r')
      try {
        const { size } = await handle.stat()
        const buffer = Buffer.alloc(Math.min(size, maxBytes))
        await handle.read(buffer, 0, buffer.length, 0)
        if (buffer.includes(0)) throw new Error('That file is not text.')
        return { text: buffer.toString('utf8'), truncated: size > maxBytes }
      } finally {
        await handle.close()
      }
    },

    async write(path, text) {
      need('write')
      if (Buffer.byteLength(text) > MAX_WRITE_BYTES) throw new Error('That file is too large.')
      const real = await resolveAllowed(policy, path)
      const existed = await fs.stat(real).then(
        (s) => {
          if (s.isDirectory()) throw new Error('That path is a folder.')
          return true
        },
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        }
      )
      await fs.mkdir(dirname(real), { recursive: true })
      // Checked again after creating parents: a link made meanwhile can't redirect the write.
      const again = await resolveAllowed(policy, real)
      await fs.writeFile(again, text, 'utf8')
      return { bytes: Buffer.byteLength(text), created: !existed }
    }
  }
}
