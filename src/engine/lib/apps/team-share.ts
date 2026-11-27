/**
 * A sidebar app shared with a team (decisions §68.8, §68.13): its source
 * files, the way a marketplace sidebar app arrives (§66). The receiving
 * laptop copies them into a new, empty allowed folder after the user's
 * click, and adds the app to its sidebar through the usual review (what data
 * it reads and writes) and checks; nothing runs before that.
 *
 * What never travels: installed packages, builds, git history, and anything
 * that may hold a secret (`.env` files, keys and certificates).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { DataError, type DataLayer } from './data'

/** Raw bytes at most: sealed, base64 twice, it stays under the 8 MB package limit. */
export const SHARE_MAX_BYTES = 4_000_000
export const SHARE_MAX_FILES = 400
const FILE_MAX = 2_000_000

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.titan117',
  '.next',
  '.expo',
  'build',
  'coverage',
  'test-results',
  'playwright-report'
])
const SECRET_FILE = /^\.env(\..*)?$|\.(pem|key|p12|pfx|keystore|jks)$|^id_(rsa|ed25519|ecdsa)/i
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,99}$/

export interface AppBundle {
  type: 'app'
  id: string
  title: string
  manifest: { reads: string[]; writes: string[]; ai: boolean }
  files: { path: string; data: string }[]
}

export class TeamShareError extends Error {}

/** Whether a relative path may be written: plain segments, no `..`, no hidden or secret files. */
export function safeSharePath(path: string): boolean {
  if (typeof path !== 'string' || path.length > 300) return false
  const parts = path.split('/')
  return (
    parts.length <= 12 &&
    parts.every((p) => SEGMENT.test(p) && p !== '..') &&
    !SECRET_FILE.test(parts[parts.length - 1]!)
  )
}

/** The app's source files, for sealing. */
export function packApp(
  folder: string,
  app: { id: string; title: string; manifest: AppBundle['manifest'] }
): AppBundle {
  const files: AppBundle['files'] = []
  let total = 0
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const path = rel ? `${rel}/${name}` : name
      const info = statSync(full)
      if (info.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full, path)
        continue
      }
      if (!info.isFile() || !safeSharePath(path)) continue
      if (info.size > FILE_MAX)
        throw new TeamShareError(`${path} is too large to share (2 MB a file at most).`)
      total += info.size
      if (total > SHARE_MAX_BYTES)
        throw new TeamShareError(
          'This app is too large to share with the team (4 MB of source at most).'
        )
      if (files.length >= SHARE_MAX_FILES)
        throw new TeamShareError(
          `This app has too many files to share (${SHARE_MAX_FILES} at most).`
        )
      files.push({ path, data: readFileSync(full).toString('base64') })
    }
  }
  walk(folder, '')
  if (!files.some((f) => f.path === 'package.json'))
    throw new TeamShareError('This app has no package.json, so another laptop couldn’t build it.')
  return { type: 'app', id: app.id, title: app.title, manifest: app.manifest, files }
}

/** A bundle from another laptop, checked before any file is written. */
export function checkBundle(raw: unknown): AppBundle {
  const b = raw as Partial<AppBundle> | null
  if (!b || b.type !== 'app' || typeof b.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(b.id))
    throw new TeamShareError('That isn’t a shared app.')
  if (typeof b.title !== 'string' || !Array.isArray(b.files) || b.files.length > SHARE_MAX_FILES)
    throw new TeamShareError('That isn’t a shared app.')
  let total = 0
  const seen = new Set<string>()
  for (const f of b.files) {
    if (
      !f ||
      typeof f.path !== 'string' ||
      typeof f.data !== 'string' ||
      !safeSharePath(f.path) ||
      seen.has(f.path.toLowerCase())
    )
      throw new TeamShareError('The shared app has a file it may not write.')
    seen.add(f.path.toLowerCase())
    total += Math.floor((f.data.length * 3) / 4)
    if (total > SHARE_MAX_BYTES) throw new TeamShareError('The shared app is too large.')
  }
  const m = b.manifest ?? { reads: [], writes: [], ai: false }
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
  return {
    type: 'app',
    id: b.id,
    title: b.title.replace(/\p{Cc}+/gu, ' ').slice(0, 60),
    manifest: { reads: strings(m.reads), writes: strings(m.writes), ai: m.ai === true },
    files: b.files.map((f) => ({ path: f.path, data: f.data }))
  }
}

/**
 * The data layer with an app's own changes refused while the app is shared
 * with a team where this person is a viewer (decisions §68.13): for the app's
 * frame and for Titan alike. The team's changes still arrive (`applyRemote`).
 */
export function readOnlyFor(layer: DataLayer, teamOf: (app: string) => string | null): DataLayer {
  const refuse = (app: string): void => {
    const team = teamOf(app)
    if (team)
      throw new DataError(
        `This app's data is shared with ${team}, where you're a viewer, so it can't be changed on this laptop.`
      )
  }
  return {
    ...layer,
    insert(app, collection, data) {
      refuse(app)
      return layer.insert(app, collection, data)
    },
    update(app, collection, id, patch) {
      refuse(app)
      return layer.update(app, collection, id, patch)
    },
    remove(app, collection, id) {
      refuse(app)
      return layer.remove(app, collection, id)
    }
  }
}
