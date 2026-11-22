/**
 * A clean Windows for desktop apps (6.26; decisions §57.12, §57.19):
 * Windows Sandbox (Windows Pro, Enterprise or Education), a fresh Windows
 * each time that's gone when it closes. The installer's folder is mapped
 * read-only, networking is off, and at sign-in the installer runs silently
 * and the app starts; a small results folder (the only writable one) gets
 * a note saying whether the app was installed.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

const SANDBOX_USER = 'C:\\Users\\WDAGUtilityAccount'
const IN_INSTALLER = `${SANDBOX_USER}\\Desktop\\installer`
const IN_RESULTS = `${SANDBOX_USER}\\Desktop\\results`

const xml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A Windows file or product name safe inside the sign-in command. */
const SAFE_NAME = /^[\p{L}\p{N} .()_-]{1,120}$/u

/**
 * The `.wsb` file: no network, the installer read-only, a results folder,
 * and a sign-in command that installs silently (`/S`, Tauri's NSIS
 * installer, per user) and then starts the app.
 */
export function sandboxConfig(input: {
  installerDir: string
  installer: string
  productName: string
  resultsDir: string
}): string {
  if (!SAFE_NAME.test(input.installer) || !SAFE_NAME.test(input.productName))
    throw new SandboxError(
      'The installer or app name has characters a clean-Windows test can’t use.'
    )
  const exe = `%LOCALAPPDATA%\\${input.productName}\\${input.productName}.exe`
  const steps = [
    `"${IN_INSTALLER}\\${input.installer}" /S`,
    `if exist "${exe}" (echo installed> "${IN_RESULTS}\\result.txt" & start "" "${exe}") else (echo not-installed> "${IN_RESULTS}\\result.txt")`
  ]
  const command = `cmd.exe /c ${steps.join(' & ')}`
  return [
    '<Configuration>',
    '  <Networking>Disable</Networking>',
    '  <VGpu>Default</VGpu>',
    '  <ClipboardRedirection>Disable</ClipboardRedirection>',
    '  <PrinterRedirection>Disable</PrinterRedirection>',
    '  <AudioInput>Disable</AudioInput>',
    '  <VideoInput>Disable</VideoInput>',
    '  <MemoryInMB>4096</MemoryInMB>',
    '  <MappedFolders>',
    '    <MappedFolder>',
    `      <HostFolder>${xml(input.installerDir)}</HostFolder>`,
    `      <SandboxFolder>${xml(IN_INSTALLER)}</SandboxFolder>`,
    '      <ReadOnly>true</ReadOnly>',
    '    </MappedFolder>',
    '    <MappedFolder>',
    `      <HostFolder>${xml(input.resultsDir)}</HostFolder>`,
    `      <SandboxFolder>${xml(IN_RESULTS)}</SandboxFolder>`,
    '      <ReadOnly>false</ReadOnly>',
    '    </MappedFolder>',
    '  </MappedFolders>',
    '  <LogonCommand>',
    `    <Command>${xml(command)}</Command>`,
    '  </LogonCommand>',
    '</Configuration>',
    ''
  ].join('\n')
}

/** Where Windows keeps Windows Sandbox's program. */
export function sandboxProgram(windowsDir = process.env.SystemRoot ?? 'C:\\Windows'): string {
  return join(windowsDir, 'System32', 'WindowsSandbox.exe')
}

export interface SandboxRun {
  /** The folder the sandbox writes its result to. */
  resultsDir: string
  /** `installed`, `not-installed`, or null until the sandbox has written it. */
  result(): Promise<string | null>
}

/** Open the installer in a fresh Windows Sandbox (one at a time; Windows' own rule). */
export async function openInSandbox(input: {
  installerPath: string
  productName: string
  /** A folder of ours for the `.wsb` file and the results. */
  workDir: string
  program?: string
  launch?: (program: string, wsb: string) => void
}): Promise<SandboxRun> {
  const program = input.program ?? sandboxProgram()
  if (!existsSync(program))
    throw new SandboxError(
      'Windows Sandbox is off. Start → “Turn Windows features on or off” → tick “Windows Sandbox” → OK → restart.'
    )
  if (!existsSync(input.installerPath)) throw new SandboxError('Make the installer first.')
  const resultsDir = join(input.workDir, 'results')
  await rm(resultsDir, { recursive: true, force: true })
  await mkdir(resultsDir, { recursive: true })
  const wsb = join(input.workDir, 'titan117-clean-windows.wsb')
  await writeFile(
    wsb,
    sandboxConfig({
      installerDir: join(input.installerPath, '..'),
      installer: basename(input.installerPath),
      productName: input.productName,
      resultsDir
    })
  )
  ;(
    input.launch ??
    ((p, file) => spawn(p, [file], { detached: true, stdio: 'ignore', windowsHide: false }).unref())
  )(program, wsb)
  return {
    resultsDir,
    async result() {
      try {
        return (await readFile(join(resultsDir, 'result.txt'), 'utf8')).trim() || null
      } catch {
        return null
      }
    }
  }
}
