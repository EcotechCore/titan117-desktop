// What's inside the build (guardrails §6, §8, §16): everything in the
// installer is public. Run after `electron-vite build`; fails when out/ holds
// anything but the three bundles, or any file contains a secret-looking value
// or server-only code.
//
//   node scripts/check-build-contents.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = 'out'
if (!existsSync(root)) {
  console.error('No out/ folder: run `electron-vite build` first.')
  process.exit(1)
}

const ALLOWED_TOP = new Set(['main', 'preload', 'renderer'])
const FORBIDDEN = [
  [/sk_(live|test)_[0-9A-Za-z]{10,}/, 'a Stripe secret key'],
  [/sk-or-v1-[0-9a-f]{20,}/, 'an OpenRouter key'],
  [/CONVEX_DEPLOY_KEY/, 'a Convex deploy key name'],
  [/CLERK_SECRET_KEY/, 'a Clerk secret key name'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/gh[pousr]_[0-9A-Za-z]{30,}/, 'a GitHub token'],
  [/from\s*["']convex\/server["']|require\(["']convex\/server["']\)/, 'server-only Convex code']
]

/** @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const problems = []
const files = walk(root)
for (const file of files) {
  const rel = relative(root, file)
  const top = rel.split(sep)[0]
  if (!ALLOWED_TOP.has(top)) problems.push(`${rel}: not part of main, preload or renderer`)
  if (/\.(map)$/.test(rel)) problems.push(`${rel}: source maps don't ship`)
  if (/(^|[\\/])\.env/.test(rel)) problems.push(`${rel}: environment file`)
  if (/\.(js|mjs|cjs|html|css|json|txt)$/.test(rel)) {
    const text = readFileSync(file, 'utf8')
    for (const [pattern, what] of FORBIDDEN)
      if (pattern.test(text)) problems.push(`${rel}: contains ${what}`)
  }
}

if (problems.length) {
  console.error("The build holds things that mustn't ship (guardrails §6, §8):")
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`Build contents OK: ${files.length} files in out/.`)
