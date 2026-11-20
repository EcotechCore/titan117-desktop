/**
 * Open a project in the user's editor (13.12): VS Code or Cursor when they
 * are installed, otherwise the folder in Explorer or Finder. The editor's
 * own program is started directly with the folder as its one argument,
 * never through a command shell, so a folder's name can't run anything.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

export interface Editor {
  id: 'vscode' | 'cursor'
  name: string
  /** The program to start (Windows), or the app name for `open -a` (macOS). */
  program: string
}

function which(command: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [command], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : (stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null))
    })
  })
}

/** The editors on this laptop (exported for tests: `find` stands in for the PATH lookup). */
export async function findEditors(
  find: (command: string) => Promise<string | null> = which,
  exists: (path: string) => boolean = existsSync
): Promise<Editor[]> {
  const found: Editor[] = []
  if (process.platform === 'darwin') {
    if (exists('/Applications/Visual Studio Code.app'))
      found.push({ id: 'vscode', name: 'VS Code', program: 'Visual Studio Code' })
    if (exists('/Applications/Cursor.app'))
      found.push({ id: 'cursor', name: 'Cursor', program: 'Cursor' })
    return found
  }
  // Windows: the command-line launchers sit next to the real programs.
  //   VS Code: <install>\bin\code.cmd           → <install>\Code.exe
  //   Cursor:  <install>\resources\app\bin\cursor.cmd → <install>\Cursor.exe
  const code = await find('code')
  if (code) {
    const exe = join(dirname(dirname(code)), 'Code.exe')
    if (exists(exe)) found.push({ id: 'vscode', name: 'VS Code', program: exe })
  }
  const cursor = await find('cursor')
  if (cursor) {
    const exe = join(dirname(dirname(dirname(dirname(cursor)))), 'Cursor.exe')
    if (exists(exe)) found.push({ id: 'cursor', name: 'Cursor', program: exe })
  }
  return found
}

/** The folder's real path when it is one of the allowed folders or inside one; otherwise null. */
export function allowedFolder(folder: string, allowed: string[]): string | null {
  let real: string
  try {
    real = realpathSync.native(folder)
  } catch {
    return null
  }
  const cmp = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  const inside = allowed.some((f) => {
    try {
      const rel = relative(cmp(realpathSync.native(f)), cmp(real))
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    } catch {
      return false
    }
  })
  return inside ? real : null
}

export function openInEditor(editor: Editor, folder: string): void {
  const child =
    process.platform === 'darwin'
      ? spawn('open', ['-a', editor.program, folder], { detached: true, stdio: 'ignore' })
      : spawn(editor.program, [folder], { detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => undefined)
  child.unref()
}
