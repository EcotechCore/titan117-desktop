// Files only inside allowed folders (guardrails §4): `../`, absolute paths,
// links, the app's own folders and credential folders are all refused.
import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

import { createFileAccess, PermissionError, type FolderPolicy } from '../src/engine/lib/folders'
import { tempFolder } from './helpers'

let allowed: string
let outside: string
let core: string
let policy: FolderPolicy

beforeAll(() => {
  allowed = tempFolder('titan117-allowed-')
  outside = tempFolder('titan117-outside-')
  core = join(allowed, 'app-data')
  mkdirSync(core)
  mkdirSync(join(allowed, 'docs'))
  mkdirSync(join(allowed, '.ssh'))
  writeFileSync(join(allowed, 'docs', 'note.txt'), 'hello')
  writeFileSync(join(allowed, '.ssh', 'id_rsa'), 'private')
  writeFileSync(join(allowed, '.env'), 'SECRET=1')
  writeFileSync(join(core, 'titan117.db'), 'core')
  writeFileSync(join(outside, 'secret.txt'), 'outside')
  // A link inside the allowed folder that points out of it. Junctions need no
  // admin rights on Windows.
  symlinkSync(outside, join(allowed, 'link-out'), 'junction')
  policy = { allowed: [allowed], core: [core] }
})

describe('allowed folders', () => {
  it('reads, lists and writes inside', async () => {
    const files = createFileAccess(policy, 'write')
    expect((await files.read('docs/note.txt')).text).toBe('hello')
    expect((await files.list('docs')).map((e) => e.name)).toEqual(['note.txt'])
    await files.write('docs/new/made.txt', 'made')
    expect((await files.read(join(allowed, 'docs', 'new', 'made.txt'))).text).toBe('made')
  })

  it.each<[string, () => string]>([
    ['../ out of the folder', () => `../${basename(outside)}/secret.txt`],
    ['a long ../ chain', () => 'docs/../../../../../../etc/passwd'],
    ['an absolute path outside', () => join(outside, 'secret.txt')],
    ['a link that points outside', () => 'link-out/secret.txt'],
    ['the app and its own data', () => 'app-data/titan117.db'],
    ['a saved-logins folder', () => '.ssh/id_rsa'],
    ['an environment file', () => '.env'],
    ['a null byte', () => 'docs/note.txt\0.png']
  ])('refuses to read %s', async (_, path) => {
    const files = createFileAccess(policy, 'write')
    await expect(files.read(path())).rejects.toBeInstanceOf(PermissionError)
  })

  it('refuses to write outside, through a link or into the core', async () => {
    const files = createFileAccess(policy, 'write')
    await expect(files.write(join(outside, 'x.txt'), 'x')).rejects.toBeInstanceOf(PermissionError)
    await expect(files.write('link-out/x.txt', 'x')).rejects.toBeInstanceOf(PermissionError)
    await expect(files.write('app-data/settings.json', '{}')).rejects.toBeInstanceOf(
      PermissionError
    )
    await expect(files.write('../escaped.txt', 'x')).rejects.toBeInstanceOf(PermissionError)
    expect(existsSync(join(outside, 'x.txt'))).toBe(false)
  })

  it('refuses everything when no folder is allowed', async () => {
    const files = createFileAccess({ allowed: [], core: [] }, 'write')
    await expect(files.list('.')).rejects.toBeInstanceOf(PermissionError)
  })

  it('refuses a tool that did not declare folder access, or only read access', async () => {
    await expect(createFileAccess(policy, undefined).read('docs/note.txt')).rejects.toBeInstanceOf(
      PermissionError
    )
    await expect(createFileAccess(policy, 'read').write('docs/x.txt', 'x')).rejects.toBeInstanceOf(
      PermissionError
    )
  })
})
