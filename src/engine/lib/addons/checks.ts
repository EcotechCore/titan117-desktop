/**
 * What the user sees before installing an add-on (features 10.7-10.9;
 * decisions §66.5): its licence, known vulnerabilities in its npm
 * dependencies (OSV's public API: only package names and versions leave the
 * laptop), keys or private keys left in its files, and install scripts.
 * Ideas from licensee and gitleaks (both MIT); our own short rules.
 */
import type { AddonPackage, SourceFetch } from './source'

export type LicenceVerdict = 'ok' | 'copyleft' | 'unknown' | 'restricted'

export interface LicenceCheck {
  /** An SPDX id, or null when none was found. */
  id: string | null
  file: string | null
  verdict: LicenceVerdict
  note: string
}

export interface DependencyCheck {
  ecosystem: 'npm'
  /** Packages with an exact version that were checked. */
  checked: number
  /** Listed with a range (`^1.2.0`), so the version that would install isn't known. */
  unpinned: string[]
  vulnerable: { name: string; version: string; ids: string[] }[]
  /** Why the scan couldn't run (offline, OSV refused), or null. */
  error: string | null
}

export interface SecretFinding {
  file: string
  line: number
  rule: string
}

export interface AddonChecks {
  licence: LicenceCheck
  dependencies: DependencyCheck
  secrets: SecretFinding[]
  /** `preinstall`, `install` or `postinstall` scripts: they run when someone installs the packages. */
  installScripts: string[]
  files: number
  bytes: number
}

const LICENCE_FILE = /^(licen[cs]e|copying|unlicense)(\.(md|txt|rst))?$/i
const OK = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0'
])

/** The licence from a licence file's text: the common ones, by their own words. */
export function detectLicence(text: string): string | null {
  const t = text.replace(/\s+/g, ' ')
  if (
    /Sustainable Use License|Commons Clause|Business Source License|Elastic License|PolyForm Noncommercial/i.test(
      t
    )
  )
    return 'LicenseRef-restricted'
  if (/non-?commercial/i.test(t) && !/GNU/.test(t)) return 'LicenseRef-noncommercial'
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0'
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t))
    return /Version 2\.1/i.test(t) ? 'LGPL-2.1' : 'LGPL-3.0'
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2,/i.test(t) ? 'GPL-2.0' : 'GPL-3.0'
  if (/Mozilla Public License,? (version|v\.?) ?2\.0/i.test(t)) return 'MPL-2.0'
  if (/Apache License,? Version 2\.0/i.test(t)) return 'Apache-2.0'
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t))
    return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(t))
    return 'ISC'
  if (/Redistribution and use in source and binary forms/i.test(t))
    return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause'
  if (/This is free and unencumbered software released into the public domain/i.test(t))
    return 'Unlicense'
  if (/CC0 1\.0 Universal/i.test(t)) return 'CC0-1.0'
  return null
}

export function checkLicence(
  files: Map<string, Uint8Array>,
  declared: string | null
): LicenceCheck {
  const file =
    [...files.keys()].filter((f) => !f.includes('/')).find((f) => LICENCE_FILE.test(f)) ?? null
  const id = file
    ? detectLicence(new TextDecoder().decode(files.get(file)!.slice(0, 64 * 1024)))
    : null
  const shown = id ?? (file ? null : declared)
  if (!file)
    return {
      id: null,
      file: null,
      verdict: 'unknown',
      note: declared
        ? `There is no licence file; titan.json says ${declared}. Without the file, the author hasn't given you the right to use it.`
        : 'There is no licence: legally you may not use, copy or change it. Ask the author to add one.'
    }
  if (!shown)
    return {
      id: null,
      file,
      verdict: 'unknown',
      note: `${file} isn't a licence we recognise. Read it before installing.`
    }
  if (OK.has(shown))
    return { id: shown, file, verdict: 'ok', note: `${shown}: you may use and change it.` }
  if (shown.startsWith('LicenseRef-'))
    return {
      id: shown,
      file,
      verdict: 'restricted',
      note: 'Its licence limits commercial use or isn’t open source. A company may not be allowed to use it.'
    }
  return {
    id: shown,
    file,
    verdict: 'copyleft',
    note: `${shown}: you may use it, but what you build from it and share may have to be shared under the same licence.`
  }
}

const EXACT = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/** npm packages with their exact versions: from package-lock.json, else exact ones in package.json. */
export function npmPackages(files: Map<string, Uint8Array>): {
  packages: { name: string; version: string }[]
  unpinned: string[]
  installScripts: string[]
} {
  const read = (path: string): Record<string, unknown> | null => {
    const raw = files.get(path)
    if (!raw || raw.byteLength > 5 * 1024 * 1024) return null
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const out = new Map<string, string>()
  const unpinned: string[] = []
  const installScripts: string[] = []
  for (const path of [...files.keys()].filter(
    (f) => /(^|\/)package\.json$/.test(f) && !f.includes('node_modules/')
  )) {
    const pkg = read(path)
    if (!pkg) continue
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>
    for (const s of ['preinstall', 'install', 'postinstall', 'prepare'])
      if (typeof scripts[s] === 'string') installScripts.push(`${path}: ${s}`)
    const dir = path.slice(0, -'package.json'.length)
    const lock = read(`${dir}package-lock.json`)
    const lockPackages = lock?.packages as Record<string, { version?: string }> | undefined
    if (lockPackages) {
      for (const [key, value] of Object.entries(lockPackages)) {
        if (!key.startsWith('node_modules/')) continue
        const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
        if (NPM_NAME.test(name) && value?.version && EXACT.test(value.version))
          out.set(`${name}@${value.version}`, name)
      }
      continue
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const deps = (pkg[field] ?? {}) as Record<string, unknown>
      for (const [name, version] of Object.entries(deps)) {
        if (!NPM_NAME.test(name) || typeof version !== 'string') continue
        if (EXACT.test(version)) out.set(`${name}@${version}`, name)
        else unpinned.push(`${name} ${version}`.slice(0, 120))
      }
    }
  }
  const packages = [...out.keys()].slice(0, 3000).map((k) => {
    const at = k.lastIndexOf('@')
    return { name: k.slice(0, at), version: k.slice(at + 1) }
  })
  return { packages, unpinned: unpinned.slice(0, 200), installScripts }
}

/** Ask OSV which of these versions have known vulnerabilities. */
export async function scanDependencies(
  packages: { name: string; version: string }[],
  fetch: SourceFetch
): Promise<{ vulnerable: DependencyCheck['vulnerable']; error: string | null }> {
  const vulnerable: DependencyCheck['vulnerable'] = []
  try {
    for (let i = 0; i < packages.length; i += 500) {
      const batch = packages.slice(i, i + 500)
      const res = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: batch.map((p) => ({
            package: { name: p.name, ecosystem: 'npm' },
            version: p.version
          }))
        })
      })
      if (!res.ok) return { vulnerable, error: `OSV answered ${res.status}.` }
      const body = (await res.json()) as { results?: { vulns?: { id: string }[] }[] }
      ;(body.results ?? []).forEach((r, j) => {
        const ids = (r.vulns ?? []).map((v) => String(v.id)).slice(0, 20)
        if (ids.length && batch[j]) vulnerable.push({ ...batch[j], ids })
      })
    }
    return { vulnerable, error: null }
  } catch (error) {
    return {
      vulnerable,
      error: error instanceof Error ? error.message.slice(0, 200) : 'The scan failed.'
    }
  }
}

/** Keys and private keys left in files. The value itself is never kept or shown. */
const SECRET_RULES: { rule: string; re: RegExp }[] = [
  {
    rule: 'Private key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/
  },
  { rule: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { rule: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { rule: 'OpenRouter key', re: /\bsk-or-v1-[A-Fa-f0-9]{32,}/ },
  { rule: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { rule: 'Stripe live key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
  { rule: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: 'Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ }
]

export function scanSecrets(files: Map<string, Uint8Array>): SecretFinding[] {
  const found: SecretFinding[] = []
  for (const [file, data] of files) {
    if (data.byteLength > 1024 * 1024 || found.length >= 50) continue
    // Binary files (with a zero byte early on) aren't read.
    if (data.subarray(0, 8000).includes(0)) continue
    const lines = new TextDecoder().decode(data).split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const { rule, re } of SECRET_RULES)
        if (re.test(line)) {
          found.push({ file, line: i + 1, rule })
          break
        }
    })
  }
  return found.slice(0, 50)
}

export async function checkPackage(
  pkg: Pick<AddonPackage, 'files'> & { manifest?: { license: string | null } | null },
  fetch: SourceFetch
): Promise<AddonChecks> {
  const { packages, unpinned, installScripts } = npmPackages(pkg.files)
  const scan = packages.length
    ? await scanDependencies(packages, fetch)
    : { vulnerable: [], error: null }
  let bytes = 0
  for (const data of pkg.files.values()) bytes += data.byteLength
  return {
    licence: checkLicence(pkg.files, pkg.manifest?.license ?? null),
    dependencies: { ecosystem: 'npm', checked: packages.length, unpinned, ...scan },
    secrets: scanSecrets(pkg.files),
    installScripts,
    files: pkg.files.size,
    bytes
  }
}

/** The checks in a few lines, for the approval card and for Titan. */
export function describeChecks(checks: AddonChecks): string[] {
  const lines = [`Licence: ${checks.licence.note}`]
  const d = checks.dependencies
  if (d.error) lines.push(`Dependency scan: couldn’t run (${d.error}).`)
  else if (d.checked === 0 && d.unpinned.length === 0) lines.push('Dependencies: none.')
  else
    lines.push(
      d.vulnerable.length
        ? `Dependencies: ${d.vulnerable.length} of ${d.checked} have known vulnerabilities (${d.vulnerable
            .slice(0, 5)
            .map((v) => `${v.name} ${v.version}`)
            .join(', ')}).`
        : `Dependencies: ${d.checked} checked against OSV, no known vulnerabilities.`
    )
  if (d.unpinned.length)
    lines.push(
      `${d.unpinned.length} dependencies have no exact version, so they couldn’t be checked.`
    )
  if (checks.secrets.length)
    lines.push(
      `Keys found in its files: ${checks.secrets
        .slice(0, 5)
        .map((s) => `${s.rule} in ${s.file}:${s.line}`)
        .join('; ')}.`
    )
  if (checks.installScripts.length)
    lines.push(
      `Install scripts: ${checks.installScripts.join('; ')} (never run by installing it here).`
    )
  lines.push(`${checks.files} files, ${Math.round(checks.bytes / 1024)} KB.`)
  return lines
}
