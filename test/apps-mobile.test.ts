// The app builder for mobile apps (phase 9, decisions §57): the Expo
// template, making and checking a mobile app, opening it to a phone on the
// same Wi-Fi only when asked, and the read-only check of what this laptop
// can do for emulators, clean Windows and desktop apps.
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

import { createAppService } from '../src/engine/lib/apps/service'
import { mobileTemplate, TEMPLATE_VERSIONS } from '../src/engine/lib/apps/template'
import {
  createRunner,
  isExpoApp,
  lanAddress,
  type CheckResult,
  type Runner
} from '../src/engine/lib/apps/runner'
import type { BrowserReport, BrowserTests } from '../src/engine/lib/apps/browsers'
import { assess, type DeviceCheck, type DeviceFacts } from '../src/engine/lib/apps/devices'
import { appCreateRequest } from '../src/renderer/src/apps-lib'
import { buildPrompt, fixPrompt, planPrompt } from '../src/engine/tools/apps'
import { tempFolder } from './helpers'

beforeAll(() => {
  const home = tempFolder('titan117-home-')
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = Test User\n\temail = test@example.com\n[core]\n\tautocrlf = false\n'
  )
  process.env.HOME = home
})

const ok = (name: CheckResult['name']): CheckResult => ({
  name,
  ran: true,
  ok: true,
  exitCode: 0,
  output: '',
  timedOut: false,
  ms: 1
})

function fakeRunner(): Runner & { phones: string[] } {
  const phones: string[] = []
  return {
    phones,
    needsInstall: () => false,
    install: async () => ok('install'),
    checks: async () => [ok('typecheck'), ok('build'), ok('test')],
    startPreview: async () => ({ url: 'http://127.0.0.1:5999/' }),
    startPhone: async (dir: string) => {
      phones.push(dir)
      return { url: 'http://127.0.0.1:5999/', phone: 'exp://192.168.1.20:5999' }
    },
    stopPreview: () => true,
    preview: () => null,
    stopAll: () => undefined
  }
}

function recordingBrowsers(): BrowserTests & { profiles: (string | undefined)[] } {
  const profiles: (string | undefined)[] = []
  return {
    profiles,
    status: () => ({ firefox: true, webkit: true }),
    ensure: async () => undefined,
    run: async (_url, _out, options): Promise<BrowserReport> => {
      profiles.push(options?.profile)
      return {
        engines: [
          { engine: 'chromium', ran: true },
          { engine: 'webkit', ran: true }
        ],
        shots: [],
        seo: [{ check: 'Shows something', ok: true, detail: 'fine' }]
      }
    }
  }
}

describe('the mobile template', () => {
  const files = mobileTemplate({
    name: 'Café "Ana"',
    title: 'Café "Ana"',
    description: 'Coffee & cake',
    lang: 'ro'
  })

  it('is an Expo app with the name, description and language filled in, safely', () => {
    const app = JSON.parse(files.get('app.json')!)
    expect(app.expo.name).toBe('Café "Ana"')
    expect(app.expo.slug).toBe('cafe-ana')
    expect(app.expo.description).toBe('Coffee & cake')
    expect(app.expo.web.lang).toBe('ro')
    expect(JSON.parse(files.get('package.json')!).name).toBe('cafe-ana')
    for (const [path, content] of files) expect(content, path).not.toMatch(/\{\{\w+\}\}/)
  })

  it('has its own tsconfig, git ignore list, test and agent notes', () => {
    expect(JSON.parse(files.get('tsconfig.json')!).extends).toBe('expo/tsconfig.base')
    expect(files.get('.gitignore')).toContain('node_modules')
    expect(files.get('.gitignore')).toContain('.titan117/reports')
    expect(files.has('src/App.test.tsx')).toBe(true)
    expect(files.get('AGENTS.md')).toContain('Expo SDK 58')
  })

  it('pins every package exactly, from the public registry only', () => {
    const pkg = JSON.parse(files.get('package.json')!)
    expect(pkg.dependencies.expo).toBe('58.0.26')
    expect(pkg.dependencies['react-native-web']).toBeTruthy()
    for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    const lock = JSON.parse(files.get('package-lock.json')!) as {
      packages: Record<string, { resolved?: string; integrity?: string }>
    }
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//)
      expect(entry.integrity, path).toMatch(/^sha512-/)
    }
  })

  it('previews on this laptop only, and opens to the network only through its phone script', () => {
    const pkg = JSON.parse(files.get('package.json')!)
    expect(pkg.scripts.dev).toBe('expo start --web')
    expect(pkg.scripts.phone).toBe('expo start --lan')
    expect(pkg.scripts.dev).not.toContain('tunnel')
    expect(pkg.scripts.phone).not.toContain('tunnel')
  })
})

describe('making and checking a mobile app', () => {
  it('makes a mobile app as version 1 with the brand colour, and checks it at phone sizes', async () => {
    const root = tempFolder('titan117-mobile-')
    const browsers = recordingBrowsers()
    const runner = fakeRunner()
    const apps = createAppService({ runner, browsers, coAuthor: () => true })
    const app = await apps.create(root, {
      kind: 'mobile',
      title: 'Cluj Bakery',
      description: 'Order bread for the morning.',
      brand: {
        primary: '#2255aa',
        accent: '#111111',
        font: 'system',
        tone: 'warm',
        logo: ''
      }
    })
    expect(app.kind).toBe('mobile')
    expect(app.template).toBe(TEMPLATE_VERSIONS.mobile)
    expect(isExpoApp(app.folder)).toBe(true)
    expect(readFileSync(join(app.folder, 'src', 'theme.ts'), 'utf8')).toContain('#2255aa')
    expect(readFileSync(join(app.folder, 'AGENTS.md'), 'utf8')).toContain('Tone of voice')
    expect((await apps.versions(app.folder))[0].subject).toBe(
      'Version 1: a new mobile app, "Cluj Bakery", from the template'
    )
    expect(apps.list([root]).map((a) => a.kind)).toEqual(['mobile'])

    const report = await apps.check(app.folder)
    expect(report.passed).toBe(true)
    expect(browsers.profiles).toEqual(['mobile'])
    // Nothing from the report lands in git.
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: app.folder }).toString()).toBe('')
  })

  it('opens only a mobile app on a phone, and never publishes it to a website host', async () => {
    const root = tempFolder('titan117-mobile-')
    const runner = fakeRunner()
    const apps = createAppService({
      runner,
      browsers: recordingBrowsers(),
      coAuthor: () => false,
      hosting: {
        token: () => 'token',
        published: () => ({}),
        setPublished: () => undefined
      }
    })
    const site = await apps.create(root, { title: 'Site', description: 'A site.' })
    await expect(apps.startPhone(site.folder)).rejects.toThrow(/Only a mobile app/)
    const mobile = await apps.create(root, {
      kind: 'mobile',
      title: 'Phone',
      description: 'An app.'
    })
    expect((await apps.startPhone(mobile.folder)).phone).toBe('exp://192.168.1.20:5999')
    expect(runner.phones).toEqual([mobile.folder])
    await expect(apps.publish(mobile.folder)).rejects.toThrow(/App Store and Google Play/)
  })

  it('a web app made before phase 9 still reads as a web app', async () => {
    const root = tempFolder('titan117-mobile-')
    const apps = createAppService({
      runner: fakeRunner(),
      browsers: recordingBrowsers(),
      coAuthor: () => false
    })
    const site = await apps.create(root, { title: 'Old site', description: 'A site.' })
    expect(site.kind).toBe('web')
    expect(isExpoApp(site.folder)).toBe(false)
    // An unknown kind isn't an app.
    mkdirSync(join(root, 'odd', '.titan117'), { recursive: true })
    writeFileSync(join(root, 'odd', '.titan117', 'app.json'), JSON.stringify({ kind: 'tv' }))
    expect(apps.list([root]).map((a) => a.title)).toEqual(['Old site'])
  })
})

describe('opening a mobile app to the phone', () => {
  it('picks the Wi-Fi address, never a virtual machine’s or a public one', () => {
    const entry = (address: string, internal = false) =>
      ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as const
    expect(
      lanAddress({
        'vEthernet (WSL)': [entry('172.20.16.1')],
        'Wi-Fi': [entry('192.168.1.23')],
        Loopback: [entry('127.0.0.1', true)]
      })
    ).toBe('192.168.1.23')
    expect(lanAddress({ Ethernet: [entry('10.0.0.5')] })).toBe('10.0.0.5')
    expect(lanAddress({ 'vEthernet (Default Switch)': [entry('172.30.0.1')] })).toBeNull()
    expect(lanAddress({ Ethernet: [entry('85.120.1.2')] })).toBeNull()
  })

  it('refuses a website, and says so when the laptop has no network a phone can share', async () => {
    const site = tempFolder('titan117-runner-')
    writeFileSync(join(site, 'package.json'), JSON.stringify({ dependencies: { react: '1' } }))
    const runner = createRunner({
      node: async () => {
        throw new Error('no Node in this test')
      },
      npmDir: tempFolder('titan117-npm-'),
      scratch: tempFolder('titan117-scratch-'),
      lan: () => null
    })
    await expect(runner.startPhone(site)).rejects.toThrow(/Only a mobile app/)
    const mobile = tempFolder('titan117-runner-')
    writeFileSync(join(mobile, 'package.json'), JSON.stringify({ dependencies: { expo: '58' } }))
    await expect(runner.startPhone(mobile)).rejects.toThrow(/same Wi-Fi/)
  })
})

describe('what this laptop can do', () => {
  const windowsPro: DeviceFacts = {
    platform: 'win32',
    arch: 'x64',
    edition: 'Microsoft Windows 11 Pro',
    ramGb: 32,
    freeDiskGb: 700,
    virtualization: true,
    hypervisorPlatform: false,
    windowsSandbox: false,
    webview2: '142.0.1',
    msvc: false,
    rust: false,
    lan: '192.168.1.23'
  }
  const byId = (facts: DeviceFacts): Record<string, DeviceCheck> =>
    Object.fromEntries(assess(facts).map((c) => [c.id, c]))

  it('says what to switch on, and where, without changing anything', () => {
    const c = byId(windowsPro)
    expect(c.preview.ok).toBe(true)
    expect(c['expo-go'].ok).toBe(true)
    expect(c.emulator.ok).toBe(false)
    expect(c.emulator.fix).toContain('Windows Hypervisor Platform')
    expect(c.sandbox.ok).toBe(false)
    expect(c.sandbox.fix).toContain('Windows Sandbox')
    expect(c['ios-simulator'].ok).toBe(false)
    expect(c.tauri.ok).toBe(false)
    expect(c.tauri.detail).toContain('Rust')
    expect(c.tauri.detail).toContain('C++ build tools')
  })

  it('is ready when the features are on and the tools are there', () => {
    const c = byId({
      ...windowsPro,
      hypervisorPlatform: true,
      windowsSandbox: true,
      msvc: true,
      rust: true
    })
    expect(c.emulator.ok).toBe(true)
    expect(c.sandbox.ok).toBe(true)
    expect(c.tauri.ok).toBe(true)
  })

  it('knows Windows Home has no Sandbox, small laptops can’t run the emulator, and Macs have the simulator', () => {
    expect(byId({ ...windowsPro, edition: 'Microsoft Windows 11 Home' }).sandbox.ok).toBe(false)
    const small = byId({ ...windowsPro, hypervisorPlatform: true, ramGb: 4, freeDiskGb: 5 })
    expect(small.emulator.ok).toBe(false)
    expect(small.emulator.detail).toContain('4 GB of memory')
    expect(small.emulator.detail).toContain('5 GB free')
    const mac = byId({
      platform: 'darwin',
      arch: 'arm64',
      ramGb: 16,
      freeDiskGb: 200,
      xcode: true,
      rust: true,
      lan: '192.168.1.5'
    })
    expect(mac['ios-simulator'].ok).toBe(true)
    expect(mac.emulator.ok).toBe(true)
    expect(mac.sandbox).toBeUndefined()
    expect(byId({ ...windowsPro, lan: null })['expo-go'].ok).toBe(false)
  })

  it('can’t tell when Windows didn’t answer, rather than guessing', () => {
    const c = byId({ ...windowsPro, hypervisorPlatform: undefined, windowsSandbox: undefined })
    expect(c.emulator.ok).toBeNull()
    expect(c.sandbox.ok).toBeNull()
  })
})

describe('building a mobile app', () => {
  it('gives the coding engine the mobile stack and specialist, not the website’s', () => {
    const plan = planPrompt('a menu screen', 'mobile')
    expect(plan).toContain('Expo SDK 58')
    expect(plan).toContain('Mobile specialist rules')
    expect(plan).not.toContain('site.config.json')
    expect(buildPrompt('x', 'y', 'mobile')).toContain('Expo Go')
    expect(fixPrompt('✗ build', 'mobile')).toContain('react-native-web')
    // A website keeps its own rules.
    expect(planPrompt('a page')).toContain('site.config.json')
  })

  it('the Apps screen asks Titan for a mobile app by name', () => {
    expect(appCreateRequest('C:\\apps', 'Bakery', 'Bread.', '', 'blank', 'mobile')).toContain(
      'app_create, target "mobile"'
    )
    expect(appCreateRequest('C:\\apps', 'Bakery', 'Bread.', '')).toContain('new web app')
  })
})

describe('the mobile template on disk', () => {
  it('ships no native project folders and keeps reports out of git', () => {
    const dir = join(__dirname, '..', 'src', 'engine', 'lib', 'apps', 'templates', 'mobile')
    expect(existsSync(join(dir, 'android'))).toBe(false)
    expect(existsSync(join(dir, 'ios'))).toBe(false)
    expect(readFileSync(join(dir, 'gitignore'), 'utf8')).toMatch(/^android$/m)
  })
})
