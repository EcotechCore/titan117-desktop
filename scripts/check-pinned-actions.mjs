// Fails when a workflow uses a GitHub Action by tag or branch instead of a
// full commit SHA (guardrails §13, security.md B5). Local actions (./...) and
// docker:// images with a digest are fine.
//
//   node scripts/check-pinned-actions.mjs
//
// The same script is used in titan117-web, titan117-desktop and titan117-pop.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(".github", "workflows");
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
const bad = [];

for (const file of files) {
  readFileSync(join(dir, file), "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      const m = line.match(/^\s*-?\s*uses:\s*["']?([^\s"'#]+)/);
      if (!m) return;
      const ref = m[1];
      if (ref.startsWith("./")) return;
      if (ref.startsWith("docker://") && /@sha256:[0-9a-f]{64}$/.test(ref)) return;
      if (/@[0-9a-f]{40}$/.test(ref)) return;
      bad.push(`${file}:${i + 1}: ${ref}`);
    });
}

if (bad.length) {
  console.error("Actions must be pinned to a full commit SHA (guardrails §13):");
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`Actions pinned: ${files.length} workflow file(s) checked.`);
