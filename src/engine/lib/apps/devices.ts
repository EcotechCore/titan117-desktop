/**
 * What this laptop can do for mobile and desktop apps (6.22–6.28, decisions
 * §57): the hardware check before anything big is downloaded. It only reads
 * (Windows' own feature list, memory, disk, installed tools) and changes
 * nothing; turning a Windows feature on is the user's own step, shown with
 * where to click.
 */
import { execFile } from 'node:child_process'
import { existsSync, statfsSync } from 'node:fs'
import { totalmem } from 'node:os'
import { delimiter, join } from 'node:path'

import { lanAddress } from './runner'

/** What the probe found; every field may be missing when it couldn't tell. */
export interface DeviceFacts {
  platform: NodeJS.Platform
  arch: string
  /** Windows' edition name, e.g. "Microsoft Windows 11 Pro". */
  edition?: string
  build?: number
  ramGb: number
  freeDiskGb: number | null
  /** A hypervisor is running, or the processor's virtualization is on in the firmware. */
  virtualization?: boolean
  /** Windows features, on or off: the Android emulator's hypervisor and Windows Sandbox. */
  hypervisorPlatform?: boolean
  windowsSandbox?: boolean
  /** The WebView2 runtime's version (Tauri apps show their window with it). */
  webview2?: string | null
  /** Microsoft's C++ build tools (Tauri needs them on Windows). */
  msvc?: boolean
  rust?: boolean
  /** Xcode on a Mac (the iOS Simulator). */
  xcode?: boolean
  /** This laptop's address on the Wi-Fi, for Expo Go. */
  lan: string | null
}

export interface DeviceCheck {
  id: 'preview' | 'expo-go' | 'emulator' | 'ios-simulator' | 'sandbox' | 'tauri'
  label: string
  /** null: can't tell. */
  ok: boolean | null
  detail: string
  /** The user's own step to make it work. */
  fix?: string
  /** Built yet in Titan117, or coming later in phase 9. */
  built: boolean
}

export const EMULATOR_MIN_RAM_GB = 8
export const EMULATOR_MIN_DISK_GB = 16

/** Plain verdicts from the facts: pure, so every system can be tested anywhere. */
export function assess(f: DeviceFacts): DeviceCheck[] {
  const win = f.platform === 'win32'
  const mac = f.platform === 'darwin'
  const checks: DeviceCheck[] = [
    {
      id: 'preview',
      label: 'Mobile apps in the preview',
      ok: true,
      detail:
        'Mobile apps open in the Apps screen through react-native-web, at phone sizes, in Chromium and WebKit.',
      built: true
    },
    {
      id: 'expo-go',
      label: 'On your phone with Expo Go',
      ok: !!f.lan,
      detail: f.lan
        ? `Phones on the same Wi-Fi reach this laptop at ${f.lan}. Install Expo Go from the App Store or Google Play, then scan the code.`
        : 'This laptop isn’t on a Wi-Fi or cable network a phone can share.',
      ...(f.lan
        ? win
          ? {
              fix: 'The first time, Windows may ask whether Node.js may use private networks: allow it for private networks only.'
            }
          : {}
        : { fix: 'Connect the laptop and the phone to the same Wi-Fi.' }),
      built: true
    }
  ]

  // The Android emulator (6.22): virtualization, Windows Hypervisor Platform, memory and disk.
  const emulatorProblems: string[] = []
  const emulatorFixes: string[] = []
  if (f.arch !== 'x64' && !(mac && f.arch === 'arm64'))
    emulatorProblems.push(
      'Google’s emulator runs on Intel and AMD processors, or a Mac with Apple silicon'
    )
  if (f.ramGb < EMULATOR_MIN_RAM_GB)
    emulatorProblems.push(
      `${f.ramGb} GB of memory (${EMULATOR_MIN_RAM_GB} GB at least, 16 GB is best)`
    )
  if (f.freeDiskGb !== null && f.freeDiskGb < EMULATOR_MIN_DISK_GB)
    emulatorProblems.push(`${f.freeDiskGb} GB free on the disk (${EMULATOR_MIN_DISK_GB} GB needed)`)
  if (win && f.virtualization === false) {
    emulatorProblems.push('the processor’s virtualization is off')
    emulatorFixes.push(
      'Turn on virtualization (Intel VT-x or AMD-V) in the laptop’s firmware settings.'
    )
  }
  if (win && f.hypervisorPlatform === false) {
    emulatorProblems.push('Windows Hypervisor Platform is off')
    emulatorFixes.push(
      'Start → type “Turn Windows features on or off” → tick “Windows Hypervisor Platform” → OK → restart.'
    )
  }
  const emulatorUnknown = win && f.hypervisorPlatform === undefined
  checks.push({
    id: 'emulator',
    label: 'Android emulator',
    ok: emulatorProblems.length ? false : emulatorUnknown ? null : true,
    detail: emulatorProblems.length
      ? `Not yet: ${emulatorProblems.join('; ')}.`
      : emulatorUnknown
        ? 'Couldn’t read Windows’ features; the emulator checks again when it starts.'
        : `Ready: ${f.ramGb} GB of memory${f.freeDiskGb !== null ? `, ${f.freeDiskGb} GB free` : ''}. Titan117 downloads Google’s emulator (about 3 GB) the first time.`,
    ...(emulatorFixes.length ? { fix: emulatorFixes.join(' ') } : {}),
    built: false
  })

  // The iOS Simulator (6.23) needs a Mac with Xcode.
  checks.push({
    id: 'ios-simulator',
    label: 'iPhone simulator',
    ok: mac ? (f.xcode ?? null) : false,
    detail: mac
      ? f.xcode
        ? 'Xcode is installed.'
        : 'Needs Xcode from the Mac App Store.'
      : 'Apple’s simulator runs only on a Mac. On this laptop, test on a real iPhone with Expo Go.',
    ...(mac && !f.xcode ? { fix: 'Install Xcode from the Mac App Store, open it once.' } : {}),
    built: false
  })

  // A clean Windows for desktop apps (6.26): Windows Sandbox, on Pro, Enterprise or Education.
  if (win) {
    const home = /home/i.test(f.edition ?? '')
    checks.push({
      id: 'sandbox',
      label: 'A clean Windows to test desktop apps',
      ok: home ? false : (f.windowsSandbox ?? null),
      detail: home
        ? 'Windows Sandbox needs Windows Pro, Enterprise or Education; this laptop has Home.'
        : f.windowsSandbox
          ? 'Windows Sandbox is on: each test starts from a fresh Windows and leaves nothing behind.'
          : f.windowsSandbox === false
            ? 'Windows Sandbox is off.'
            : 'Couldn’t read whether Windows Sandbox is on.',
      ...(!home && f.windowsSandbox === false
        ? {
            fix: 'Start → type “Turn Windows features on or off” → tick “Windows Sandbox” → OK → restart.'
          }
        : {}),
      built: false
    })
  }

  // Desktop apps with Tauri (6.4): Rust, and on Windows the C++ build tools and WebView2.
  const tauriMissing: string[] = []
  if (!f.rust) tauriMissing.push('Rust')
  if (win && !f.msvc) tauriMissing.push('Microsoft’s C++ build tools')
  if (win && f.webview2 === null) tauriMissing.push('the WebView2 runtime')
  if (mac && !f.xcode) tauriMissing.push('Xcode’s command-line tools')
  checks.push({
    id: 'tauri',
    label: 'Desktop apps (Tauri)',
    ok: tauriMissing.length === 0,
    detail: tauriMissing.length
      ? `Needs ${tauriMissing.join(', ')}.`
      : 'Rust and the build tools are installed.',
    ...(tauriMissing.length
      ? {
          fix: win
            ? 'Install “Build Tools for Visual Studio” with “Desktop development with C++” (from visualstudio.microsoft.com), then Rust from rustup.rs. Titan117 will guide this when desktop apps arrive.'
            : 'Install Xcode’s command-line tools (xcode-select --install), then Rust from rustup.rs.'
        }
      : {}),
    built: false
  })
  return checks
}

/** Windows' own answers, read once with PowerShell: no changes, no elevation. */
const WINDOWS_PROBE = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$o=[ordered]@{}',
  '$o.edition=(Get-CimInstance Win32_OperatingSystem).Caption',
  '$o.build=[Environment]::OSVersion.Version.Build',
  '$o.hypervisor=[bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent',
  '$o.firmware=[bool](Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled',
  "foreach($x in Get-CimInstance Win32_OptionalFeature -Filter \"Name='HypervisorPlatform' or Name='Containers-DisposableClientVM'\"){ $o[$x.Name]=[int]$x.InstallState }",
  "$wv=Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'",
  "if(-not $wv){ $wv=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' }",
  '$o.webview2=$wv.pv',
  '$vsw=Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\\Installer\\vswhere.exe"',
  'if(Test-Path $vsw){ $o.msvc=[bool](& $vsw -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) } else { $o.msvc=$false }',
  '$o | ConvertTo-Json -Compress'
].join('; ')

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) =>
      resolve(error ? '' : String(stdout))
    )
  })
}

/** A program on the PATH or in its usual folder. */
function onPath(name: string, extra: string[] = []): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd'] : ['']
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...extra].filter(Boolean)
  return dirs.some((dir) => exts.some((ext) => existsSync(join(dir, name + ext))))
}

/** Read the laptop's facts. `dataDir` is where downloads would go (its disk's free space counts). */
export async function probeDevice(dataDir: string): Promise<DeviceFacts> {
  let freeDiskGb: number | null = null
  try {
    const s = statfsSync(dataDir)
    freeDiskGb = Math.round((s.bavail * s.bsize) / 1e9)
  } catch {
    /* unknown */
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const facts: DeviceFacts = {
    platform: process.platform,
    arch: process.arch,
    ramGb: Math.round(totalmem() / 1e9),
    freeDiskGb,
    lan: lanAddress(),
    rust: onPath('rustc', [join(home, '.cargo', 'bin')])
  }
  if (process.platform === 'win32') {
    const out = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PROBE],
      30_000
    )
    try {
      const raw = JSON.parse(out) as Record<string, unknown>
      facts.edition = typeof raw.edition === 'string' ? raw.edition : undefined
      facts.build = typeof raw.build === 'number' ? raw.build : undefined
      facts.virtualization = raw.hypervisor === true || raw.firmware === true
      // InstallState 1 is on; 2 is off.
      if (typeof raw.HypervisorPlatform === 'number')
        facts.hypervisorPlatform = raw.HypervisorPlatform === 1
      if (typeof raw['Containers-DisposableClientVM'] === 'number')
        facts.windowsSandbox = raw['Containers-DisposableClientVM'] === 1
      facts.webview2 = typeof raw.webview2 === 'string' && raw.webview2 ? raw.webview2 : null
      facts.msvc = raw.msvc === true
    } catch {
      /* PowerShell didn't answer: the checks say "can't tell" */
    }
  } else if (process.platform === 'darwin') {
    facts.xcode = (await run('xcode-select', ['-p'], 10_000)).trim().length > 0
  }
  return facts
}
