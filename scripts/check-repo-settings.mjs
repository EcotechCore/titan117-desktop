// Repository settings check (guardrails §13): fails when `main` loses its
// protection, when the rules stop applying to admins, or when a CI job in
// .github/workflows/ci.yml isn't a required check.
//
//   node scripts/check-repo-settings.mjs            (in CI: uses GITHUB_REPOSITORY and GITHUB_TOKEN)
//   node scripts/check-repo-settings.mjs owner/repo (locally)
//
// It reads GitHub's branch endpoint, which any reader of the repo can call.
// That endpoint doesn't show the pull request rule, so that one is checked
// by hand when settings change. The same script is used in titan117-web,
// titan117-desktop and titan117-pop.
import { readFileSync } from "node:fs";

const repo = process.argv[2] ?? process.env.GITHUB_REPOSITORY;
if (!repo) {
  console.error("Pass owner/repo, or set GITHUB_REPOSITORY.");
  process.exit(1);
}

// Job names: the `name:` two levels under `jobs:` in the CI workflow.
const jobs = readFileSync(".github/workflows/ci.yml", "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^ {4}name: (.+?)\s*$/)?.[1])
  .filter(Boolean);

const headers = { Accept: "application/vnd.github+json", "User-Agent": "titan117-repo-settings-check" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(`https://api.github.com/repos/${repo}/branches/main`, { headers });
// A missing or unreadable repo is reported like any other problem below.
const branch = res.ok ? await res.json() : {};
const checks = branch.protection?.required_status_checks;
const required = new Set(checks?.contexts ?? []);

const problems = res.ok ? [] : [`could not read the main branch: HTTP ${res.status}`];
if (!branch.protected || !branch.protection?.enabled) problems.push("main is not protected");
if (checks?.enforcement_level !== "everyone") {
  problems.push(`required checks apply to "${checks?.enforcement_level ?? "nobody"}", not to everyone (admins included)`);
}
if (jobs.length === 0) problems.push("no jobs found in .github/workflows/ci.yml");
for (const job of jobs) if (!required.has(job)) problems.push(`CI job "${job}" is not a required check`);

if (problems.length) {
  console.error(`Repository settings of ${repo} don't match guardrails §13:`);
  for (const p of problems) console.error(`  ${p}`);
  // exitCode, not exit(): the open connection closes cleanly first.
  process.exitCode = 1;
} else {
  console.log(`Repository settings OK: main is protected for everyone; ${jobs.length} CI jobs required.`);
}
