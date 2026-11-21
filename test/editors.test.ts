/**
 * Open in your editor (13.12): only allowed folders open, and the editor's
 * own program is found next to its command-line launcher.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { allowedFolder, findEditors } from '../src/main/lib/editors'
import { tempFolder } from './helpers'

describe('open in your editor', () => {
  it('opens only an allowed folder or one inside it', () => {
    const allowed = tempFolder('t117-ed-allowed-')
    const other = tempFolder('t117-ed-other-')
    mkdirSync(join(allowed, 'app'))
    expect(allowedFolder(join(allowed, 'app'), [allowed])).toBeTruthy()
    expect(allowedFolder(allowed, [allowed])).toBeTruthy()
    expect(allowedFolder(other, [allowed])).toBeNull()
    expect(allowedFolder(join(allowed, '..'), [allowed])).toBeNull()
    expect(allowedFolder(join(allowed, 'missing'), [allowed])).toBeNull()
  })

  it.runIf(process.platform === 'win32')(
    'finds VS Code and Cursor next to their launchers',
    async () => {
      const editors = await findEditors(
        async (command) =>
          command === 'code'
            ? 'C:\\Apps\\VS Code\\bin\\code.cmd'
            : command === 'cursor'
              ? 'C:\\Apps\\Cursor\\resources\\app\\bin\\cursor.cmd'
              : null,
        (path) => ['C:\\Apps\\VS Code\\Code.exe', 'C:\\Apps\\Cursor\\Cursor.exe'].includes(path)
      )
      expect(editors).toEqual([
        { id: 'vscode', name: 'VS Code', program: 'C:\\Apps\\VS Code\\Code.exe' },
        { id: 'cursor', name: 'Cursor', program: 'C:\\Apps\\Cursor\\Cursor.exe' }
      ])
      expect(
        await findEditors(
          async () => null,
          () => false
        )
      ).toEqual([])
    }
  )

  it.runIf(process.platform === 'win32')(
    'finds the newest JetBrains IDE in Program Files or the Toolbox folder',
    async () => {
      const pf = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'JetBrains')
      const lad = join(process.env['LOCALAPPDATA'] ?? '', 'Programs')
      const present = new Set([
        join(pf, 'IntelliJ IDEA 2025.3', 'bin', 'idea64.exe'),
        join(pf, 'IntelliJ IDEA 2026.2', 'bin', 'idea64.exe'),
        join(lad, 'WebStorm', 'bin', 'webstorm64.exe')
      ])
      const editors = await findEditors(
        async () => null,
        (path) => present.has(path),
        (dir) =>
          dir === pf
            ? ['IntelliJ IDEA 2025.3', 'IntelliJ IDEA 2026.2', 'Other']
            : dir === lad
              ? ['WebStorm']
              : []
      )
      expect(editors.map((e) => [e.id, e.program])).toEqual([
        ['intellij', join(pf, 'IntelliJ IDEA 2026.2', 'bin', 'idea64.exe')],
        ['webstorm', join(lad, 'WebStorm', 'bin', 'webstorm64.exe')]
      ])
    }
  )
})
