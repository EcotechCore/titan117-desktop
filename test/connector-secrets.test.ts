// Connector secrets (feature 3.6): kept encrypted by the keychain, never
// readable by the page, refused when malformed.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { ConnectorSecrets } from '../src/main/lib/connector-secrets'
import { tempFolder } from './helpers'

const keychain = {
  encrypt: (text: string) => Buffer.from(text).reverse(),
  decrypt: (data: Buffer) => Buffer.from(data).reverse().toString()
}
const ID = '0b7c6a1e-1111-4222-8333-944445555666'

describe('connector secrets', () => {
  it('are stored encrypted and read back for the engine only', () => {
    const dir = tempFolder()
    const secrets = new ConnectorSecrets(dir, keychain)
    expect(secrets.set(ID, { GITHUB_TOKEN: 'ghp_value_that_is_secret' })).toEqual({ ok: true })
    const file = readFileSync(join(dir, 'connector-secrets', `${ID}.bin`))
    expect(file.toString()).not.toContain('ghp_value_that_is_secret')
    expect(secrets.all()).toEqual({ [ID]: { GITHUB_TOKEN: 'ghp_value_that_is_secret' } })
    secrets.remove(ID)
    expect(secrets.all()).toEqual({})
  })

  it('refuse bad ids, names and values, and refuse without a keychain', () => {
    const dir = tempFolder()
    const secrets = new ConnectorSecrets(dir, keychain)
    expect(secrets.set('../../evil', { A: 'b' }).ok).toBe(false)
    expect(secrets.set(ID, { 'BAD NAME': 'x' }).ok).toBe(false)
    expect(secrets.set(ID, { A: 42 }).ok).toBe(false)
    expect(secrets.set(ID, ['x']).ok).toBe(false)
    expect(new ConnectorSecrets(dir, null).set(ID, { A: 'b' }).ok).toBe(false)
    expect(() => readdirSync(join(dir, 'connector-secrets'))).toThrow()
  })
})
