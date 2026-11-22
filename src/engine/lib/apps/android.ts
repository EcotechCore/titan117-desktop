/**
 * The Android emulator (6.22, 6.28; decisions §57.9, §57.19): Google's
 * command-line tools and a Java runtime (Eclipse Temurin) downloaded the
 * first time, each checked against a SHA-256 written here, into our data
 * folder. Google's SDK licence is shown in full and accepted by the user
 * themselves before Google's emulator, platform tools and system image are
 * installed by Google's own `sdkmanager`. Nothing touches the user's own
 * Android setup (`~/.android`): the SDK, its settings and the virtual phone
 * live under `<data>/components/android`.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'

import { safeJoin } from './node'

export type AndroidPlatform = 'win32-x64'

interface Download {
  url: string
  sha256: string
  bytes: number
}

/** Google's command-line tools 22.0 (`sdkmanager`, `avdmanager`), from Google's download page. */
export const ANDROID_TOOLS: Record<AndroidPlatform, Download> = {
  'win32-x64': {
    url: 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip',
    sha256: '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a',
    bytes: 155_655_386
  }
}

/** Eclipse Temurin 21 (a Java runtime) for Google's tools and, later, Maestro. GPL v2 with the Classpath Exception, run unchanged. */
export const JAVA_VERSION = '21.0.13.1+2'
export const JAVA: Record<AndroidPlatform, Download> = {
  'win32-x64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/OpenJDK21U-jre_x64_windows_hotspot_21.0.13.1_2.zip',
    sha256: 'e15ee1e54a5a3b38027a09cedfa87bc3348d7dd3ce50866dd3d9671d7fffc6c1',
    bytes: 49_108_427
  }
}

/** Android 14 (API 34) with Google Play (to install Expo Go): Maestro supports API levels 29 to 34. */
export const SYSTEM_IMAGE = 'system-images;android-34;google_apis_playstore;x86_64'
export const SDK_PACKAGES = ['platform-tools', 'emulator', 'platforms;android-34', SYSTEM_IMAGE]
export const AVD_NAME = 'titan117-phone'

export class AndroidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AndroidError'
  }
}

export interface AndroidStatus {
  /** This system can run Google's emulator through Titan117 yet. */
  supported: boolean
  /** Google's tools and the Java runtime are downloaded. */
  tools: boolean
  /** The user accepted Google's SDK licence. */
  licence: boolean
  /** The emulator, platform tools and system image are installed. */
  packages: boolean
  /** The virtual phone exists. */
  phone: boolean
  /** The running emulator's serial, e.g. `emulator-5554`. */
  running: string | null
}

export interface RunResult {
  code: number | null
  output: string
}

/** How a program runs (tests pass a fake). */
export type Exec = (
  file: string,
  args: string[],
  options: { env: Record<string, string>; input?: string; timeoutMs: number; cwd?: string }
) => Promise<RunResult>

export interface AndroidComponent {
  status(): AndroidStatus
  /** Download Google's tools and Java (about 205 MB), checked against their hashes. */
  ensureTools(onProgress?: (note: string) => void): Promise<void>
  /** Google's licence text, as `sdkmanager` shows it, for the user to read. */
  licenceText(): Promise<string>
  /** The user's own click: accept Google's licence (`sdkmanager --licenses`). */
  acceptLicence(): Promise<void>
  /** Google's emulator, platform tools and Android 14 image (about 3 GB), then the virtual phone. */
  installPhone(onProgress?: (note: string) => void): Promise<void>
  /** Start the virtual phone; needs the hypervisor (Windows Hypervisor Platform). */
  start(onProgress?: (note: string) => void): Promise<string>
  stop(): Promise<void>
  /** Open an address (an `exp://` link for Expo Go) in the running phone. */
  openUrl(url: string): Promise<void>
}

const SDK_MANAGER = 'com.android.sdklib.tool.sdkmanager.SdkManagerCli'
const AVD_MANAGER = 'com.android.sdklib.tool.AvdManagerCli'
const MAX_OUTPUT = 40_000

/** Run a program without a shell, with a time limit, collecting its output. */
export const defaultExec: Exec = (file, args, options) =>
  new Promise((resolve) => {
    const child = spawn(file, args, {
      env: options.env,
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let output = ''
    const add = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => child.kill(), options.timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, output: output + String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
    child.stdin.end(options.input ?? '')
  })

function platformOf(): AndroidPlatform | null {
  return process.platform === 'win32' && process.arch === 'x64' ? 'win32-x64' : null
}

/**
 * The licences `sdkmanager --install` asks about, exactly as it shows them:
 * each "License …:" block up to its "Accept? (y/N)" prompt, nothing else
 * (not its notices or progress bars).
 */
export function cleanLicence(output: string): string {
  const text = output.replace(/\r\n?/g, '\n')
  const blocks: string[] = []
  const pattern = /^License [\w.-]+:\n[\s\S]*?(?=Accept\? \(y\/N\))/gm
  for (const match of text.matchAll(pattern)) blocks.push(match[0].trim())
  return blocks.join('\n\n')
}

/** The licence's fingerprint, kept with the user's acceptance. */
const licenceHash = (text: string): string => createHash('sha256').update(text).digest('hex')

export function createAndroidComponent(deps: {
  /** `<data>/components/android` */
  dir: string
  fetch?: typeof fetch
  platform?: AndroidPlatform | null
  exec?: Exec
  /** The scrubbed environment programs start from. */
  baseEnv?: () => Record<string, string>
}): AndroidComponent {
  const platform = deps.platform === undefined ? platformOf() : deps.platform
  const doFetch = deps.fetch ?? fetch
  const exec = deps.exec ?? defaultExec
  const sdk = join(deps.dir, 'sdk')
  const javaHome = join(deps.dir, 'java', JAVA_VERSION)
  const userHome = join(deps.dir, 'user')
  const java = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  const toolsDir = join(sdk, 'cmdline-tools', 'latest')
  const exe = process.platform === 'win32' ? '.exe' : ''
  const adb = join(sdk, 'platform-tools', `adb${exe}`)
  const emulator = join(sdk, 'emulator', `emulator${exe}`)
  let running: string | null = null
  let installing: Promise<void> | null = null
  /** The user's acceptance of the licence text they were shown (its fingerprint and when). */
  const acceptedFile = join(userHome, 'titan117-licence-accepted.json')
  let shown: string | null = null

  function env(): Record<string, string> {
    return {
      ...(deps.baseEnv?.() ?? (process.env as Record<string, string>)),
      JAVA_HOME: javaHome,
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      // The user's own ~/.android (keys, settings, other phones) is never read or changed.
      ANDROID_USER_HOME: userHome,
      ANDROID_AVD_HOME: join(userHome, 'avd'),
      ANDROID_EMULATOR_HOME: userHome
    }
  }

  const tool = (main: string, classpath: string, args: string[]): string[] => [
    `-Dcom.android.sdklib.toolsdir=${toolsDir}`,
    '-classpath',
    join(toolsDir, 'lib', classpath),
    main,
    `--sdk_root=${sdk}`,
    ...args
  ]
  const sdkmanager = (
    args: string[],
    input?: string,
    timeoutMs = 30 * 60_000
  ): Promise<RunResult> =>
    exec(java, tool(SDK_MANAGER, 'sdkmanager-classpath.jar', args), {
      env: env(),
      input,
      timeoutMs
    })

  const status = (): AndroidStatus => ({
    supported: !!platform,
    tools: existsSync(java) && existsSync(join(toolsDir, 'lib', 'sdkmanager-classpath.jar')),
    licence: existsSync(acceptedFile),
    packages:
      existsSync(emulator) && existsSync(adb) && existsSync(join(sdk, ...SYSTEM_IMAGE.split(';'))),
    phone: existsSync(join(userHome, 'avd', `${AVD_NAME}.ini`)),
    running
  })

  /** Download one archive, check its hash, and unpack it (top folder stripped) into `target`. */
  async function fetchAndUnpack(
    what: string,
    spec: Download,
    target: string,
    onProgress?: (note: string) => void
  ): Promise<void> {
    onProgress?.(`Downloading ${what} (about ${Math.round(spec.bytes / 1e6)} MB), once…`)
    let response: Response
    try {
      response = await doFetch(spec.url, { redirect: 'follow' })
    } catch {
      throw new AndroidError(`Couldn't download ${what}: no internet connection.`)
    }
    if (!response.ok) throw new AndroidError(`Couldn't download ${what} (${response.status}).`)
    const data = new Uint8Array(await response.arrayBuffer())
    if (createHash('sha256').update(data).digest('hex') !== spec.sha256)
      throw new AndroidError(
        `The ${what} download didn't match its fingerprint, so it was thrown away. Nothing was installed.`
      )
    const partial = `${target}.partial`
    await rm(partial, { recursive: true, force: true })
    await mkdir(partial, { recursive: true })
    for (const [name, body] of Object.entries(unzipSync(data))) {
      if (name.endsWith('/')) continue
      const relative = name.split('/').slice(1).join('/')
      const file = safeJoin(partial, relative)
      if (!file) throw new AndroidError(`The ${what} download had a file outside its folder.`)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, body)
    }
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await rename(partial, target)
  }

  async function adbRun(args: string[], timeoutMs = 60_000): Promise<RunResult> {
    return exec(adb, args, { env: env(), timeoutMs })
  }

  return {
    status,

    ensureTools(onProgress) {
      if (!platform)
        return Promise.reject(
          new AndroidError('Titan117 sets up the Android emulator on Windows (x64) for now.')
        )
      installing ??= (async () => {
        try {
          if (!existsSync(java)) {
            await fetchAndUnpack(
              'a Java runtime (Eclipse Temurin 21)',
              JAVA[platform],
              javaHome,
              onProgress
            )
            // Only one Java version is kept.
            for (const entry of await readdir(dirname(javaHome)))
              if (entry !== JAVA_VERSION)
                await rm(join(dirname(javaHome), entry), { recursive: true, force: true })
          }
          if (!existsSync(join(toolsDir, 'lib', 'sdkmanager-classpath.jar')))
            await fetchAndUnpack(
              "Google's Android command-line tools",
              ANDROID_TOOLS[platform],
              toolsDir,
              onProgress
            )
        } finally {
          installing = null
        }
      })()
      return installing
    },

    async licenceText() {
      if (!status().tools) throw new AndroidError("Download Google's tools first.")
      // Exactly the licences for what Titan117 installs. "n" to each: nothing is accepted or installed here.
      const result = await sdkmanager(['--install', ...SDK_PACKAGES], 'n\n'.repeat(10), 5 * 60_000)
      const text = cleanLicence(result.output)
      if (!text)
        throw new AndroidError(
          `Google's tools didn't show the licence: ${result.output.trim().split('\n').slice(-3).join(' ')}`
        )
      shown = text
      return text
    },

    async acceptLicence() {
      if (!shown) throw new AndroidError("Read Google's licence first.")
      await mkdir(userHome, { recursive: true })
      await writeFile(
        acceptedFile,
        JSON.stringify({ licence: licenceHash(shown), at: new Date().toISOString() }, null, 2)
      )
    },

    async installPhone(onProgress) {
      if (!status().licence)
        throw new AndroidError("Accept Google's Android SDK licence first (Apps → This laptop).")
      if (!status().packages) {
        onProgress?.(
          "Installing Google's emulator, platform tools and Android 14 (about 3 GB), once…"
        )
        // The user accepted these licences on the screen: "y" answers sdkmanager's same questions.
        const result = await sdkmanager(['--install', ...SDK_PACKAGES], 'y\n'.repeat(10))
        if (result.code !== 0 || !status().packages)
          throw new AndroidError(
            `Google's emulator didn't install: ${result.output.trim().split('\n').slice(-5).join(' ')}`
          )
      }
      if (!status().phone) {
        onProgress?.('Making the virtual phone…')
        // "no" to a custom hardware profile.
        const result = await exec(
          java,
          tool(AVD_MANAGER, 'avdmanager-classpath.jar', [
            'create',
            'avd',
            '--name',
            AVD_NAME,
            '--package',
            SYSTEM_IMAGE,
            '--device',
            'pixel_7'
          ]).filter((a) => !a.startsWith('--sdk_root')),
          { env: env(), input: 'no\n', timeoutMs: 2 * 60_000 }
        )
        if (!status().phone)
          throw new AndroidError(
            `The virtual phone wasn't made: ${result.output.trim().split('\n').slice(-3).join(' ')}`
          )
      }
    },

    async start(onProgress) {
      if (running) return running
      if (!status().phone) throw new AndroidError('Set up the emulator first (Apps → This laptop).')
      onProgress?.('Starting the virtual phone…')
      const child = spawn(
        emulator,
        ['-avd', AVD_NAME, '-port', '5554', '-no-snapshot-save', '-no-boot-anim', '-no-audio'],
        { env: env(), windowsHide: false, detached: false, stdio: 'ignore' }
      )
      let exited = false
      child.on('exit', () => {
        exited = true
        running = null
      })
      const serial = 'emulator-5554'
      const deadline = Date.now() + 4 * 60_000
      while (Date.now() < deadline) {
        if (exited)
          throw new AndroidError(
            'The emulator stopped while starting. Check that Windows Hypervisor Platform is on (Apps → This laptop).'
          )
        const boot = await adbRun(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], 10_000)
        if (boot.output.trim() === '1') {
          running = serial
          return serial
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
      child.kill()
      throw new AndroidError("The virtual phone didn't finish starting within four minutes.")
    },

    async stop() {
      if (!running) return
      await adbRun(['-s', running, 'emu', 'kill'], 30_000)
      running = null
    },

    async openUrl(url) {
      if (!running) throw new AndroidError('Start the virtual phone first.')
      if (!/^(exp|https?):\/\/[\w.:-]+\/?$/.test(url))
        throw new AndroidError('Only an app address opens there.')
      const result = await adbRun([
        '-s',
        running,
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        url
      ])
      if (result.code !== 0)
        throw new AndroidError(`The phone didn't open it: ${result.output.trim()}`)
    }
  }
}
