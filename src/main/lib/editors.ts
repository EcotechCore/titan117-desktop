/**
 * Open a project in the user's editor (13.12): VS Code or Cursor when they
 * are installed, otherwise the folder in Explorer or Finder. The editor's
 * own program is started directly with the folder as its one argument,
 * never through a command shell, so a folder's name can't run anything.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

export interface Editor {
  id: 'vscode' | 'cursor' | 'intellij' | 'webstorm' | 'pycharm'
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
  exists: (path: string) => boolean = existsSync,
  list: (dir: string) => string[] = listDir
): Promise<Editor[]> {
  const found: Editor[] = []
  if (process.platform === 'darwin') {
    if (exists('/Applications/Visual Studio Code.app'))
      found.push({ id: 'vscode', name: 'VS Code', program: 'Visual Studio Code' })
    if (exists('/Applications/Cursor.app'))
      found.push({ id: 'cursor', name: 'Cursor', program: 'Cursor' })
    return [...found, ...jetBrains(exists, list)]
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
  found.push(...jetBrains(exists, list))
  return found
}

const JETBRAINS: { id: Editor['id']; name: string; folder: RegExp; exe: string; mac: string[] }[] =
  [
    {
      id: 'intellij',
      name: 'IntelliJ IDEA',
      folder: /^IntelliJ IDEA/i,
      exe: 'idea64.exe',
      mac: ['IntelliJ IDEA.app', 'IntelliJ IDEA Ultimate.app', 'IntelliJ IDEA CE.app']
    },
    {
      id: 'webstorm',
      name: 'WebStorm',
      folder: /^WebStorm/i,
      exe: 'webstorm64.exe',
      mac: ['WebStorm.app']
    },
    {
      id: 'pycharm',
      name: 'PyCharm',
      folder: /^PyCharm/i,
      exe: 'pycharm64.exe',
      mac: ['PyCharm.app', 'PyCharm CE.app', 'PyCharm Professional Edition.app']
    }
  ]

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * JetBrains editors in their usual places: `/Applications` on macOS; on
 * Windows `Program Files\JetBrains\<name> <version>\bin\<name>64.exe` or
 * the Toolbox's `%LOCALAPPDATA%\Programs\<name>\bin`. The newest version wins.
 */
function jetBrains(exists: (path: string) => boolean, list: (dir: string) => string[]): Editor[] {
  const out: Editor[] = []
  for (const ide of JETBRAINS) {
    if (process.platform === 'darwin') {
      const app = ide.mac.find((a) => exists(join('/Applications', a)))
      if (app) out.push({ id: ide.id, name: ide.name, program: app.replace(/\.app$/, '') })
      continue
    }
    const roots = [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'JetBrains'),
      join(process.env['LOCALAPPDATA'] ?? '', 'Programs')
    ]
    const candidates = roots
      .flatMap((root) =>
        list(root)
          .filter((d) => ide.folder.test(d))
          .map((d) => join(root, d, 'bin', ide.exe))
      )
      .filter((p) => exists(p))
      .sort()
    const newest = candidates[candidates.length - 1]
    if (newest) out.push({ id: ide.id, name: ide.name, program: newest })
  }
  return out
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
