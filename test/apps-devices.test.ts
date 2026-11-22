// Phase 9 (decisions §57.19): the Android emulator's set-up, the clean-Windows
// test, the desktop installer step and the store guides, without real
// downloads, emulators or sandboxes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  AVD_NAME,
  cleanLicence,
  createAndroidComponent,
  SYSTEM_IMAGE,
  type Exec
} from '../src/engine/lib/apps/android'
import { openInSandbox, sandboxConfig } from '../src/engine/lib/apps/sandbox'
import { createAppService } from '../src/engine/lib/apps/service'
import type { CheckResult, Runner } from '../src/engine/lib/apps/runner'
import type { BrowserTests } from '../src/engine/lib/apps/browsers'
import { storeGuide } from '../src/renderer/src/apps-lib'
import { tempFolder } from './helpers'

const EXE = process.platform === 'win32' ? '.exe' : ''

// Git needs a name and email to save versions; a throwaway home gives it one (HOME only).
beforeAll(() => {
  const home = tempFolder('titan117-home-')
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]
	name = Test User
	email = test@example.com
[core]
	autocrlf = false
'
  )
  process.env.HOME = home
})

describe('the Android emulator’s set-up', () => {
  it('throws away a download that doesn’t match its fingerprint', async () => {
    const dir = tempFolder('titan117-android-')
    const android = createAndroidComponent({
      dir,
      platform: 'win32-x64',
      fetch: (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch
    })
    await expect(android.ensureTools()).rejects.toThrow(/fingerprint/)
    expect(android.status().tools).toBe(false)
  })

  it('says so on a system it doesn’t set up yet', async () => {
    const android = createAndroidComponent({ dir: tempFolder('titan117-android-'), platform: null })
    expect(android.status().supported).toBe(false)
    await expect(android.ensureTools()).rejects.toThrow(/Windows/)
  })

  it('shows Google’s licence without accepting it, and accepts only when asked', async () => {
    const dir = tempFolder('titan117-android-')
    const calls: { input?: string; env: Record<string, string> }[] = []
    const exec: Exec = async (_file, _args, options) => {
      calls.push({ input: options.input, env: options.env })
      return {
        code: 0,
        output: [
          'Loading package information...',
          '1 of 1 SDK package license not accepted.',
          'License android-sdk-license:',
          'Terms and Conditions',
          'This is the Android SDK License Agreement',
          'Accept? (y/N): '
        ].join('\n')
      }
    }
    // As if the tools were downloaded.
    mkdirSync(join(dir, 'java', '21.0.13.1+2', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'java', '21.0.13.1+2', 'bin', `java${EXE}`), '')
    mkdirSync(join(dir, 'sdk', 'cmdline-tools', 'latest', 'lib'), { recursive: true })
    writeFileSync(
      join(dir, 'sdk', 'cmdline-tools', 'latest', 'lib', 'sdkmanager-classpath.jar'),
      ''
    )
    const android = createAndroidComponent({
      dir,
      platform: 'win32-x64',
      exec,
      baseEnv: () => ({})
    })
    expect(android.status().tools).toBe(true)

    const text = await android.licenceText()
    expect(text).toContain('Android SDK License Agreement')
    expect(text).not.toContain('Accept?')
    expect(calls[0].input?.startsWith('n')).toBe(true)
    expect(android.status().licence).toBe(false)
    // Nothing installs before the licence is accepted.
    await expect(android.installPhone()).rejects.toThrow(/licence first/)

    await android.acceptLicence()
    expect(android.status().licence).toBe(true)
    // Shown with "n" answers, the licence's fingerprint kept with the acceptance.
    expect(
      JSON.parse(readFileSync(join(dir, 'user', 'titan117-licence-accepted.json'), 'utf8')).licence
    ).toMatch(/^[0-9a-f]{64}$/)
    // The user's own ~/.android is never used.
    expect(calls[0].env.ANDROID_USER_HOME).toBe(join(dir, 'user'))
    expect(calls[0].env.ANDROID_HOME).toBe(join(dir, 'sdk'))
  })

  it('installs Google’s packages and makes the phone with Google’s own tools', async () => {
    const dir = tempFolder('titan117-android-')
    mkdirSync(join(dir, 'user'), { recursive: true })
    writeFileSync(join(dir, 'user', 'titan117-licence-accepted.json'), '{}')
    const seen: string[][] = []
    const answers: (string | undefined)[] = []
    const exec: Exec = async (_file, args, options) => {
      seen.push(args)
      answers.push(options.input)
      if (args.includes('--install')) {
        mkdirSync(join(dir, 'sdk', 'emulator'), { recursive: true })
        writeFileSync(join(dir, 'sdk', 'emulator', `emulator${EXE}`), '')
        mkdirSync(join(dir, 'sdk', 'platform-tools'), { recursive: true })
        writeFileSync(join(dir, 'sdk', 'platform-tools', `adb${EXE}`), '')
        mkdirSync(join(dir, 'sdk', ...SYSTEM_IMAGE.split(';')), { recursive: true })
      }
      if (args.includes('avd')) {
        mkdirSync(join(dir, 'user', 'avd'), { recursive: true })
        writeFileSync(join(dir, 'user', 'avd', `${AVD_NAME}.ini`), '')
      }
      return { code: 0, output: '' }
    }
    const android = createAndroidComponent({
      dir,
      platform: 'win32-x64',
      exec,
      baseEnv: () => ({})
    })
    await android.installPhone()
    expect(seen[0]).toContain(SYSTEM_IMAGE)
    expect(answers[0]?.startsWith('y')).toBe(true)
    expect(seen[1]).toContain(AVD_NAME)
    expect(seen[1].some((a) => a.startsWith('--sdk_root'))).toBe(false)
    expect(android.status().phone).toBe(true)
    // Only while the phone runs.
    await expect(android.openUrl('exp://10.0.2.2:5000')).rejects.toThrow(/Start the virtual phone/)
  })

  it('keeps only the licence text from sdkmanager’s output', () => {
    expect(
      cleanLicence(
        'WARNING: deprecated\r\nLoading x\r[=====   ] 50%\nLicense android-sdk-license:\n---\nText\nAccept? (y/N): Skipping'
      )
    ).toBe('License android-sdk-license:\n---\nText')
    expect(cleanLicence('All SDK package licenses accepted')).toBe('')
  })
})

describe('a clean Windows (Windows Sandbox)', () => {
  const config = sandboxConfig({
    installerDir: 'C:\\apps\\book & co\\bundle\\nsis',
    installer: 'Customer Book_0.1.0_x64-setup.exe',
    productName: 'Customer Book',
    resultsDir: 'C:\\data\\sandbox\\results'
  })

  it('has no network, maps the installer read-only and writes only its result', () => {
    expect(config).toContain('<Networking>Disable</Networking>')
    expect(config).toContain('<ClipboardRedirection>Disable</ClipboardRedirection>')
    expect(config).toMatch(/book &amp; co[\s\S]*?<ReadOnly>true<\/ReadOnly>/)
    expect(config).toMatch(/results<\/HostFolder>[\s\S]*?<ReadOnly>false<\/ReadOnly>/)
    expect(config).toContain('x64-setup.exe&quot; /S')
    expect(config).toContain('%LOCALAPPDATA%\\Customer Book\\Customer Book.exe')
  })

  it('refuses names that could break out of its command', () => {
    expect(() =>
      sandboxConfig({
        installerDir: 'C:\\x',
        installer: 'a.exe" & calc & "',
        productName: 'X',
        resultsDir: 'C:\\r'
      })
    ).toThrow(/characters/)
  })

  it('says how to turn Windows Sandbox on when it’s off, and launches the .wsb when it’s on', async () => {
    const work = tempFolder('titan117-sandbox-')
    const installer = join(work, 'App_0.1.0_x64-setup.exe')
    writeFileSync(installer, '')
    await expect(
      openInSandbox({
        installerPath: installer,
        productName: 'App',
        workDir: work,
        program: join(work, 'missing.exe')
      })
    ).rejects.toThrow(/Windows Sandbox/)
    const program = join(work, 'WindowsSandbox.exe')
    writeFileSync(program, '')
    const launched: string[] = []
    const run = await openInSandbox({
      installerPath: installer,
      productName: 'App',
      workDir: work,
      program,
      launch: (_p, wsb) => launched.push(wsb)
    })
    expect(readFileSync(launched[0], 'utf8')).toContain('<Networking>Disable</Networking>')
    expect(await run.result()).toBeNull()
    writeFileSync(join(run.resultsDir, 'result.txt'), 'installed\n')
    expect(await run.result()).toBe('installed')
  })
})

describe('the desktop installer step', () => {
  const ok = (name: CheckResult['name']): CheckResult => ({
    name,
    ran: true,
    ok: true,
    exitCode: 0,
    output: '',
    timedOut: false,
    ms: 1
  })
  const runner = (scripts: string[][]): Runner =>
    ({
      needsInstall: () => false,
      install: async () => ok('install'),
      checks: async () => [ok('typecheck'), ok('build'), ok('test')],
      script: async (dir: string, _name: string, args: string[]) => {
        scripts.push(args)
        if (args[0] === 'build') {
          const nsis = join(dir, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
          mkdirSync(nsis, { recursive: true })
          writeFileSync(join(nsis, 'Book_0.1.0_x64-setup.exe'), '')
        }
        return { ok: true, exitCode: 0, output: '', timedOut: false, ms: 1 }
      },
      startPreview: async () => ({ url: 'http://127.0.0.1:5999/' }),
      startPhone: async () => ({ url: '', phone: '' }),
      stopPreview: () => true,
      preview: () => null,
      stopAll: () => undefined
    }) as Runner
  const browsers = {} as BrowserTests

  it('says what to install when Rust or the build tools are missing', async () => {
    const root = tempFolder('titan117-installer-')
    const apps = createAppService({
      runner: runner([]),
      browsers,
      coAuthor: () => false,
      toolchain: async () => ({ rust: false, msvc: false })
    })
    const app = await apps.create(root, { kind: 'desktop', title: 'Book', description: 'x' })
    await expect(apps.makeInstaller(app.folder)).rejects.toThrow(/Rust/)
    const site = await apps.create(root, { title: 'Site', description: 'x' })
    await expect(apps.makeInstaller(site.folder)).rejects.toThrow(/Only a desktop app/)
  })

  it('makes the icons, then an NSIS installer only', async () => {
    const root = tempFolder('titan117-installer-')
    const scripts: string[][] = []
    const apps = createAppService({
      runner: runner(scripts),
      browsers,
      coAuthor: () => false,
      toolchain: async () => ({ rust: true, msvc: true })
    })
    const app = await apps.create(root, { kind: 'desktop', title: 'Book', description: 'x' })
    const { path } = await apps.makeInstaller(app.folder)
    expect(scripts).toEqual([
      ['icon', 'app-icon.svg'],
      ['build', '--bundles', 'nsis']
    ])
    expect(path.endsWith('-setup.exe')).toBe(true)
    expect(apps.installer(app.folder)).toBe(path)
    expect(existsSync(path)).toBe(true)
  })
})

describe('store guides', () => {
  it('names the costs and the stores’ own rules, and the user submits', () => {
    const apple = storeGuide('apple', { title: 'Bakery' })
    expect(apple.cost).toBe('$99 a year')
    expect(apple.steps.join(' ')).toContain('4.2.6')
    const google = storeGuide('google', { title: 'Bakery' })
    expect(google.cost).toBe('$25 once')
    expect(google.steps.join(' ')).toContain('12 testers for 14 days')
    expect(storeGuide('microsoft', { title: 'Book' }).cost).toBe('Free')
    for (const g of [apple, google]) expect(g.start).toMatch(/^https:\/\//)
  })
})
