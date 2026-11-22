/**
 * The sync core for sidebar apps (6.12; decisions §32, §58.7): what one
 * device sends another, sealed so our cloud can't read it. A package holds
 * one app's changes (each record as it is now, or its deletion), encrypted
 * with AES-256-GCM under the account's sync key; the app's name and every
 * field are inside the ciphertext, and its length is padded so sizes say
 * little. The receiving device merges last-writer-wins (`applyRemote`).
 *
 * The transport (our cloud relay, holding only these packages) and how the
 * sync key reaches a user's devices come with phase 15's device keys; the
 * key never leaves the laptop's keychain and is never sent to us.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { APP_ID, DataError, type DataLayer, type SyncEntry } from './data'

const VERSION = 1
const MAGIC = Buffer.from('T117S')
const AAD = Buffer.from('titan117-sync-v1')
/** Packages are padded to a multiple of this many bytes. */
const PAD = 1024
/** One package at most (about a thousand typical records). */
const MAX_PACKAGE = 8_000_000

export class SyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

/** A new random sync key for an account (kept in the OS keychain). */
export function newSyncKey(): Buffer {
  return randomBytes(32)
}

function checkKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new SyncError('The sync key must be 32 bytes.')
}

/** Seal one app's changes: `T117S` · version · IV · tag · ciphertext, as base64. */
export function seal(key: Buffer, app: string, entries: SyncEntry[]): string {
  checkKey(key)
  const body = Buffer.from(JSON.stringify({ app, entries }), 'utf8')
  // A 4-byte length, the JSON, then zeros up to the next multiple of PAD.
  const plain = Buffer.alloc(Math.ceil((body.length + 4) / PAD) * PAD)
  plain.writeUInt32BE(body.length, 0)
  body.copy(plain, 4)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    iv,
    cipher.getAuthTag(),
    encrypted
  ]).toString('base64')
}

/** Open a package sealed with the same key; anything changed or sealed with another key fails. */
export function open(key: Buffer, sealed: string): { app: string; entries: SyncEntry[] } {
  checkKey(key)
  const raw = Buffer.from(sealed, 'base64')
  if (raw.length > MAX_PACKAGE) throw new SyncError('That sync package is too big.')
  if (raw.length < 5 + 1 + 12 + 16 || !raw.subarray(0, 5).equals(MAGIC) || raw[5] !== VERSION)
    throw new SyncError('That isn’t a Titan117 sync package.')
  const iv = raw.subarray(6, 18)
  const tag = raw.subarray(18, 34)
  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    plain = Buffer.concat([decipher.update(raw.subarray(34)), decipher.final()])
  } catch {
    throw new SyncError('That sync package was changed, or sealed with another key.')
  }
  const length = plain.readUInt32BE(0)
  if (length > plain.length - 4) throw new SyncError('That sync package is damaged.')
  const parsed = JSON.parse(plain.subarray(4, 4 + length).toString('utf8')) as {
    app?: unknown
    entries?: unknown
  }
  if (typeof parsed.app !== 'string' || !APP_ID.test(parsed.app) || !Array.isArray(parsed.entries))
    throw new SyncError('That sync package is damaged.')
  return { app: parsed.app, entries: parsed.entries as SyncEntry[] }
}

/** This device's changes to one app after `since`, sealed; null when nothing changed. */
export function exportChanges(
  data: DataLayer,
  key: Buffer,
  app: string,
  since: number
): { upTo: number; sealed: string | null } {
  const { upTo, entries } = data.entriesSince(app, since)
  return { upTo, sealed: entries.length ? seal(key, app, entries) : null }
}

/**
 * Merge a package from another of the user's devices. Only apps this device
 * has in its sidebar are accepted; a bad record stops nothing else.
 */
export function importChanges(
  data: DataLayer,
  key: Buffer,
  sealed: string,
  known: (app: string) => boolean
): { app: string; applied: number; skipped: number; refused: number } {
  const { app, entries } = open(key, sealed)
  if (!known(app)) throw new SyncError(`"${app}" isn’t in this laptop's sidebar.`)
  let applied = 0
  let skipped = 0
  let refused = 0
  for (const entry of entries) {
    try {
      if (data.applyRemote(app, entry)) applied++
      else skipped++
    } catch (error) {
      if (!(error instanceof DataError)) throw error
      refused++
    }
  }
  return { app, applied, skipped, refused }
}
