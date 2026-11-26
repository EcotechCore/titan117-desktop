/**
 * Sealing a sync package (decisions §58.12, §65.6): AES-256-GCM under the
 * account's 32-byte sync key, everything inside the ciphertext, padded to a
 * multiple of 1 KB. The same bytes as the engine's sync core
 * (engine/lib/apps/sync.ts), which keeps its own copy for its tests and
 * checks; a test checks the two open each other's packages.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 1
const MAGIC = Buffer.from('T117S')
const AAD = Buffer.from('titan117-sync-v1')
const PAD = 1024
export const MAX_PACKAGE = 8_000_000

function checkKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('The sync key must be 32 bytes.')
}

export function sealPackage(key: Buffer, body: unknown): string {
  checkKey(key)
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const plain = Buffer.alloc(Math.ceil((json.length + 4) / PAD) * PAD)
  plain.writeUInt32BE(json.length, 0)
  json.copy(plain, 4)
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

/** The package's contents, or null when it was changed, sealed with another key or isn't one. */
export function openPackage(key: Buffer, sealed: string): unknown {
  checkKey(key)
  const raw = Buffer.from(sealed, 'base64')
  if (raw.length > MAX_PACKAGE || raw.length < 34) return null
  if (!raw.subarray(0, 5).equals(MAGIC) || raw[5] !== VERSION) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(6, 18))
    decipher.setAAD(AAD)
    decipher.setAuthTag(raw.subarray(18, 34))
    const plain = Buffer.concat([decipher.update(raw.subarray(34)), decipher.final()])
    const length = plain.readUInt32BE(0)
    if (length > plain.length - 4) return null
    return JSON.parse(plain.subarray(4, 4 + length).toString('utf8')) as unknown
  } catch {
    return null
  }
}
