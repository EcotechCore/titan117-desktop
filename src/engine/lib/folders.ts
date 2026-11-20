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

export interface SearchHit {
  path: string
  /** Matching lines (for a content search), each with its line number. */
  lines: string[]
}

export interface FileAccess {
  list(path: string): Promise<FolderEntry[]>
  read(path: string, maxBytes?: number): Promise<{ text: string; truncated: boolean }>
  /** Raw bytes (audio for speech, binary checks). */
  readBytes(path: string, maxBytes?: number): Promise<Buffer>
  write(path: string, text: string): Promise<{ bytes: number; created: boolean }>
  writeBytes(path: string, data: Buffer): Promise<{ bytes: number; created: boolean }>
  /** Move or rename inside the allowed folders. Never replaces an existing file. */
  move(from: string, to: string): Promise<void>
  makeFolder(path: string): Promise<void>
  /** Delete a file or an empty folder (to the user's recycle bin is the window's job; this is final). */
  remove(path: string): Promise<'file' | 'folder'>
  /** Find files by name (a glob-like pattern) and, optionally, containing some text. */
  search(path: string, name: string, text?: string): Promise<SearchHit[]>
  /** The real path a tool's path stands for, checked. */
  resolve(path: string): Promise<string>
}

export interface FolderPolicy {
  /** Folders the user allowed, as real paths. */
  allowed: string[]
  /** Folders that are never reachable: the app itself and its data. */
  core: string[]
  /** Allowed folders agents may read but never change (7.8, decisions §51). */
  readOnly?: string[]
  /** Folders whose contents may reach local models only (7.7, decisions §51). */
  localOnly?: string[]
  /** Called when a tool reads inside a local-models-only folder. */
  onLocalOnly?: () => void
}

/** The read-only and local-only rules on a resolved path (decisions §51). */
function folderRules(policy: FolderPolicy, real: string, write: boolean): void {
  const cmp = comparable(real)
  if (write && (policy.readOnly ?? []).some((f) => isInside(cmp, comparable(f))))
    throw new PermissionError(
      'That folder is read-only for agents. Change it in Documents if Titan should be able to write there.'
    )
  if ((policy.localOnly ?? []).some((f) => isInside(cmp, comparable(f)))) policy.onLocalOnly?.()
}

export function realFolder(path: string): string {
  return realpathSync.native(resolve(path))
}

/**
 * Resolve a path a tool was given and refuse it unless it sits inside an
 * allowed folder. Relative paths are relative to the first allowed folder.
 */
export async function resolveAllowed(policy: FolderPolicy, path: string): Promise<string> {
  return resolveAllowedPath(policy, path)
}

/**
 * The checks a write gets, for a program we run (the coding engine): inside
 * an allowed folder, not the app's own, not credentials, not read-only.
 * Throws PermissionError; returns the real path.
 */
export async function checkWritable(policy: FolderPolicy, path: string): Promise<string> {
  const real = await resolveAllowedPath(policy, path)
  folderRules(policy, real, true)
  return real
}

/** Whether `child` is `parent` or inside it (both real paths). */
export function isInsideFolder(child: string, parent: string): boolean {
  return isInside(comparable(child), comparable(parent))
}

async function resolveAllowedPath(policy: FolderPolicy, path: string): Promise<string> {
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
const MAX_BINARY_BYTES = 50_000_000
const SEARCH_FILES = 5_000
const SEARCH_HITS = 200

/** `*.txt`, `invoice*`, `report` → a case-insensitive file-name test. */
export function namePattern(pattern: string): RegExp {
  const p = pattern.trim() || '*'
  const body = p
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return p.includes('*') ? new RegExp(`^${body}$`, 'i') : new RegExp(body, 'i')
}

export function createFileAccess(
  policy: FolderPolicy,
  mode: 'read' | 'write' | undefined
): FileAccess {
  // Every path a tool touches passes the folder rules too.
  let writing = false
  async function resolveAllowed(p: FolderPolicy, path: string): Promise<string> {
    const real = await resolveAllowedPath(p, path)
    folderRules(p, real, writing)
    return real
  }

  function need(wanted: 'read' | 'write'): void {
    writing = wanted === 'write'
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

    async readBytes(path, maxBytes = MAX_BINARY_BYTES) {
      need('read')
      const real = await resolveAllowed(policy, path)
      const { size } = await fs.stat(real)
      if (size > maxBytes) throw new Error('That file is too large.')
      return fs.readFile(real)
    },

    async writeBytes(path, data) {
      need('write')
      if (data.length > MAX_BINARY_BYTES) throw new Error('That file is too large.')
      const real = await resolveAllowed(policy, path)
      const existed = await fs.stat(real).then(
        () => true,
        () => false
      )
      await fs.mkdir(dirname(real), { recursive: true })
      const again = await resolveAllowed(policy, real)
      await fs.writeFile(again, data)
      return { bytes: data.length, created: !existed }
    },

    async move(from, to) {
      need('write')
      const source = await resolveAllowed(policy, from)
      const target = await resolveAllowed(policy, to)
      await fs.stat(source)
      const taken = await fs.stat(target).then(
        () => true,
        () => false
      )
      if (taken) throw new Error(`"${to}" already exists. Choose another name.`)
      await fs.mkdir(dirname(target), { recursive: true })
      const again = await resolveAllowed(policy, target)
      await fs.rename(source, again)
    },

    async makeFolder(path) {
      need('write')
      const real = await resolveAllowed(policy, path)
      await fs.mkdir(real, { recursive: true })
    },

    async remove(path) {
      need('write')
      const real = await resolveAllowed(policy, path)
      if (policy.allowed.some((folder) => comparable(folder) === comparable(real)))
        throw new PermissionError('An allowed folder itself is never deleted.')
      const info = await fs.lstat(real)
      if (info.isDirectory()) {
        await fs.rmdir(real)
        return 'folder'
      }
      await fs.unlink(real)
      return 'file'
    },

    async search(path, name, text) {
      need('read')
      const root = await resolveAllowed(policy, path)
      const test = namePattern(name)
      const needle = text?.toLowerCase()
      const hits: SearchHit[] = []
      const queue = [root]
      let seen = 0
      while (queue.length && hits.length < SEARCH_HITS && seen < SEARCH_FILES) {
        const dir = queue.shift()!
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          const full = join(dir, entry.name)
          if (isCredentialPath(full) || entry.name === 'node_modules' || entry.name === '.git')
            continue
          if (entry.isDirectory()) {
            queue.push(full)
            continue
          }
          if (!entry.isFile()) continue
          seen++
          if (!test.test(entry.name)) continue
          const shown = relative(root, full) || entry.name
          if (!needle) {
            hits.push({ path: shown, lines: [] })
            continue
          }
          try {
            const { size } = await fs.stat(full)
            if (size > 2_000_000) continue
            const buffer = await fs.readFile(full)
            if (buffer.includes(0)) continue
            const lines = buffer
              .toString('utf8')
              .split(/\r?\n/)
              .map((line, i) => ({ line, i }))
              .filter(({ line }) => line.toLowerCase().includes(needle))
              .slice(0, 5)
              .map(({ line, i }) => `${i + 1}: ${line.trim().slice(0, 200)}`)
            if (lines.length) hits.push({ path: shown, lines })
          } catch {
            // Unreadable: skipped.
          }
        }
      }
      return hits
    },

    async resolve(path) {
      need('read')
      return resolveAllowed(policy, path)
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
