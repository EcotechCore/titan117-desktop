// Licence check (guardrails §11): every installed package must be MIT,
// Apache 2.0, BSD or ISC, or a permissive licence of the same kind, or a named
// exception below with its reason. GPL, AGPL and unknown licences fail.
//
//   node scripts/check-licenses.mjs        (run from the repo root; uses pnpm)
//
// The same script is used in titan117-web, titan117-desktop and titan117-pop.
import { execSync } from "node:child_process";

const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  // Permissive in the same way: no conditions beyond keeping the notice, or none at all.
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
]);

// package name → reason. Only for licences that aren't in ALLOWED.
const EXCEPTIONS = {
  // CC-BY-4.0 data (browser support tables), used at build time; attribution only.
  "caniuse-lite": "CC-BY-4.0 data used by build tools; attribution only",
  // WTFPL puts no conditions at all; pulled in by electron-builder (build tool only).
  "truncate-utf8-bytes": "WTFPL, no conditions; installer build tool only",
  // MPL-2.0 is file-level copyleft: it applies only if we change its files, which we don't.
  "axe-core": "MPL-2.0, unmodified, accessibility testing only",
  lightningcss: "MPL-2.0, unmodified CSS build tool",
  "lightningcss-win32-x64-msvc": "MPL-2.0, unmodified CSS build tool (Windows binary)",
  "lightningcss-linux-x64-gnu": "MPL-2.0, unmodified CSS build tool (Linux binary)",
  "lightningcss-linux-x64-musl": "MPL-2.0, unmodified CSS build tool (Linux binary)",
  "lightningcss-darwin-arm64": "MPL-2.0, unmodified CSS build tool (macOS binary)",
  "lightningcss-darwin-x64": "MPL-2.0, unmodified CSS build tool (macOS binary)",
  // sharp's prebuilt binaries bundle libvips (LGPL-3.0) as a separate, unmodified,
  // dynamically loaded library; used by Next.js image optimisation on the server.
  "@img/sharp-win32-x64": "LGPL-3.0 libvips, unmodified dynamic library",
  "@img/sharp-libvips-linux-x64": "LGPL-3.0 libvips, unmodified dynamic library",
  "@img/sharp-libvips-linuxmusl-x64": "LGPL-3.0 libvips, unmodified dynamic library",
  "@img/sharp-libvips-darwin-arm64": "LGPL-3.0 libvips, unmodified dynamic library",
  "@img/sharp-libvips-darwin-x64": "LGPL-3.0 libvips, unmodified dynamic library",
};

/** "MIT OR Apache-2.0" passes if any side is allowed; "A AND B" needs both. */
function allowed(expr) {
  const clean = expr.replace(/[()]/g, "").trim();
  if (/ OR /i.test(clean)) return clean.split(/ OR /i).some((p) => allowed(p));
  if (/ AND /i.test(clean)) return clean.split(/ AND /i).every((p) => allowed(p));
  return ALLOWED.has(clean);
}

// A fixed command with no user input, so running it through the shell is safe.
const out = execSync("pnpm licenses list --json -r", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(out);

const failures = [];
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    if (allowed(license) || EXCEPTIONS[pkg.name]) continue;
    failures.push(`${pkg.name}@${pkg.versions?.join(",") ?? "?"}: ${license}`);
  }
}

if (failures.length) {
  console.error("Licences not allowed (guardrails §11). Replace the package or add a reasoned exception:");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
const total = Object.values(byLicense).reduce((n, p) => n + p.length, 0);
console.log(`Licences OK: ${total} packages.`);
