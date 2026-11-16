// Downloads Microsoft's Visual C++ redistributable for the Windows installer
// (decisions §49) from Microsoft's permanent link, and keeps it only if its
// Authenticode signature is valid and from Microsoft. Run before
// `pnpm build:win`; the file is not committed.
//
//   node scripts/fetch-vc-redist.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
const dir = join('build', 'vendor')
const file = join(dir, 'vc_redist.x64.exe')

mkdirSync(dir, { recursive: true })
const response = await fetch(URL, { redirect: 'follow' })
if (!response.ok) {
  console.error(`Microsoft answered ${response.status}.`)
  process.exit(1)
}
const host = new globalThis.URL(response.url).hostname
if (!/(^|\.)microsoft\.com$/.test(host)) {
  console.error(`The download came from ${host}, not microsoft.com. Not kept.`)
  process.exit(1)
}
writeFileSync(file, Buffer.from(await response.arrayBuffer()))

// A fixed command with the file path as its only input.
const check = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`
  ],
  { encoding: 'utf8' }
).trim()
const [status, subject] = check.split('|')
if (status !== 'Valid' || !/O=Microsoft Corporation/.test(subject ?? '')) {
  rmSync(file, { force: true })
  console.error(`The file's signature is ${status} (${subject}). Not kept.`)
  process.exit(1)
}
console.log(`Kept ${file}: signed by Microsoft (${status}).`)
