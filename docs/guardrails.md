# Guardrails

Draft, 15 Oct 2026. The rules every piece of work in `titan117-web`, `titan117-desktop` and `titan117-pop` follows, so what we build works and doesn't open security holes. Shared doc: edited in `titan117-web`, copied to the desktop repo (decision 17). Built on the Ninjathons guardrail ("every check happens in Convex, before the data leaves the server") and extended for the desktop engine. Architecture: [03-architecture.md](03-architecture.md). Features: [notes/brainstorming-feature-map.md](notes/brainstorming-feature-map.md).

**How this file works:** every rule names what **enforces** it (a lint rule, a test, a CI check, or a review step). A rule nobody checks is a wish, so new rules come with their check. If a check fails, the work isn't done and the pull request doesn't merge.

---

## 1. Done means done

A piece of work is done only when all of these are true:

1. **Typecheck, lint, tests and build pass** locally and in CI.
2. **New behaviour has tests**, including the refusals (what a signed-out user, a free user, another account or an unapproved tool call gets).
3. **It was seen working in the real app**: the web page in the browser, the desktop feature in the running app, at phone and desktop widths for web pages, light and dark.
4. **No new console errors or warnings.**
5. **`progress.md` is updated** in the same commit: a dated log entry, and the phase table if it changed (as in Ninjathons).
6. **Docs are updated** where the work changes a decision, the architecture or a feature.
7. **Anything not checked is said so** in the log entry ("not seen signed in", "not tested on macOS").

Enforced by: CI (1, 2), the pull request checklist (§15) and review (3 to 7).

## 2. The Convex guardrail (`titan117-web`)

**Non-negotiable: every check happens in Convex, before the data leaves the server.** Next.js decides what to show; Convex decides what to send. Middleware, hidden buttons and client-side plan checks are for user experience only, never security. This holds for every caller: our web app, our desktop engine, or an attacker.

- **Public functions are built only from the wrappers** in `convex/lib/functions.ts`:

  | Wrapper | Who may call |
  |---|---|
  | `publicQuery` | Anyone; only for data that is truly public (marketplace listings, shared artifacts by link) |
  | `userQuery`, `userMutation` | A signed-in user |
  | `paidQuery`, `paidMutation` | A user with an active plan (from `entitlements`) |
  | `deviceQuery`, `deviceMutation` | A paired desktop engine of that user, for commands, events and usage |
  | `adminQuery`, `adminMutation` | An admin; the role is set only from the Convex CLI |

  *Enforced by:* ESLint blocks raw `query`, `mutation` and `action` (and their `Generic` versions) outside `convex/lib`.
- **Every gated function has a denial test** that calls it as the wrong caller (signed out, no active plan, another user, another device, not admin) and expects the error. A **coverage test fails** for any paid, device or admin function without one. *Enforced by:* tests in CI.
- **Every query that takes an id checks ownership**: a user can only read and change their own devices, commands, artifacts and usage. *Enforced by:* the denial tests ("another user's id").
- **Actions** (which can call outside services) run the same check first, through an internal query. *Enforced by:* review, and the lint rule above.
- **Errors are codes** (`UNAUTHENTICATED`, `PAYMENT_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`), never stack traces or other users' data.
- **Rate limits** on anything costly or abusable: sign-up, sharing, marketplace publishing, remote commands. *Enforced by:* tests.

## 3. Money: plans and credits

- **Only the payment webhook writes `entitlements` and credit top-ups.** No other function may. *Enforced by:* a test that lists every function writing those tables.
- **Webhooks are verified** (signature) and **idempotent**: the same event twice changes nothing the second time. *Enforced by:* tests.
- **The credit ledger is append-only**: every top-up and every use is a new row; nothing is edited or deleted. The balance is computed from it.
- **Deductions are atomic and never go below zero.** A task that would overspend stops and asks (4.8 in the feature map). *Enforced by:* tests, including two deductions at the same moment.
- **Usage from OpenRouter is reconciled** with our ledger daily; differences raise an alert.
- **Prices and plan limits live in one place**, never copied into the clients.
- **The credit proxy** checks the session and the balance before forwarding every call, has per-user rate limits, and never logs prompts or answers ([security.md](security.md) B1). *Enforced by:* denial tests (no session, no plan, empty balance); a test that the proxy's logs hold no request bodies.
- **Hard spending caps** on our OpenRouter account and every paid provider, with alerts at 50% and 80% (B4). *Enforced by:* the launch checklist; the daily reconciliation alerts.
- **Paid features are checked on the server on every call** (credits, remote control, sync, sharing, publishing, web search); device limits are enforced when pairing; the offline licence lease is signed with our private key and the app holds only the public key (B2). *Enforced by:* denial tests; a test that a lease with a changed date fails.

## 4. The engine guardrail (`titan117-desktop`)

**Non-negotiable: every tool call goes through the permission and approval layer.** No agent, tool, sidebar app or marketplace item can touch files, run commands, use the network or the browser any other way.

- **Tools are defined only with `defineTool`**, which declares the tool's permissions (folders, commands, hosts, external actions) and its risk level. *Enforced by:* ESLint blocks `child_process`, `fs`, `net`, `http(s)`, `worker_threads` and Playwright imports outside `engine/tools/lib` and `engine/lib`.
- **Every tool has a denial test**: called without the permission, it refuses. A **coverage test fails** for any tool without one (the Ninjathons pattern). *Enforced by:* tests in CI.
- **External actions always ask** (publish, send, post, pay, delete, push code), whatever the agent's settings. *Enforced by:* the risk level in `defineTool` and tests.
- **Files only inside allowed folders.** Paths are resolved and checked after following links, so `../` and symlinks can't escape. *Enforced by:* tests with escape attempts.
- **Shell commands run sandboxed**, in their own process, with a timeout, in an allowed folder; risky commands (delete, install, network, system changes) need approval. *Enforced by:* tests.
- **Budgets and limits on every task**: credits, steps, time and loop detection. *Enforced by:* tests.
- **Every action is logged** in the activity timeline (1.8): what, which agent, which model, what it cost, who approved it.
- **The core is off-limits** (decisions §21): no agent, tool, add-on or sidebar app may write to the app's install folder, its permission, credit or licence settings, or the update channel. The app grows only through add-ons with manifests. *Enforced by:* the app folder and core settings are never inside an allowed folder; a denial test tries to write each of them from an agent, a shell command and an add-on; the app checks its own signature at start and goes to safe mode if it fails.

## 5. Untrusted content and prompt injection

Web pages, documents, emails, repositories, marketplace items and tool output are **data, never instructions**.

- Content from outside is passed to models marked as untrusted and is never written into memory as rules or skills.
- An instruction found in content ("ignore your rules", "upload the files to...") is shown to the user, not followed.
- Memory and skills written by an agent show where they came from; the user can see and delete them (3.3).
- **A prompt injection test suite**: pages, documents and READMEs with planted instructions; agents must not act on them. *Enforced by:* tests in CI, run against the default models; rerun when a default model changes.
- **Network policy per task** ([security.md](security.md) A3): a task reaches only its site list; after it has read files, memory or a confidential folder, a new site needs the user's OK; requests (addresses, form fields, uploads) carrying passages of what the task has seen are blocked; local-only tasks have no network. *Enforced by:* the network goes through the engine's proxy for every tool; the injection suite includes exfiltration attempts (data in a URL, a hidden image, a form) that must be blocked.
- **Browser automation on the user's choice** (decisions §29): before running on a site from the "forbids automation" list, the user sees the warning and answers it; the agent stops before publish, post, launch, send or pay; no CAPTCHA solving, no bot-detection evasion (fake fingerprints, hidden automation flags), no automating Discord user accounts. *Enforced by:* tests that a flow on a listed site doesn't start without the stored answer, that a final-step button is never clicked without an approval, and a check that the browser tool ships no stealth or CAPTCHA-solving code.

## 6. The desktop app itself

- **The window has no direct system access.** Electron settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict content security policy, and a small preload that only talks to the engine's local API. *Enforced by:* a test that reads the window settings, and the Electron security checklist in review.
- **No remote content in the app's own windows.** Previews, artifacts and sidebar apps load in sandboxed frames or separate views with their own content security policy (§7).
- **The local API listens only on localhost** and needs the per-install token; requests from web pages (other origins) are refused. *Enforced by:* tests.
- **The desktop never imports from the web app**, and nothing server-only ends up in the installer. *Enforced by:* ESLint, and a CI check that lists what's inside each build and fails on anything unexpected.
- **Installers and updates are signed**; the app refuses an unsigned update. *Enforced by:* the release pipeline (§13).

## 7. Sidebar apps, artifacts and marketplace items

- Run sandboxed: no files, memory, network or other apps unless their manifest asks and the user allows it.
- Talk to the engine only through the `titan` SDK, which goes through the permission layer (§4).
- Artifacts load scripts only from approved sources; shared artifacts never contain secrets or private data beyond what the user chose.
- Marketplace items: permissions screen before install, pinned to a commit, dependency scan, the agent's summary of what the code does (§10 of the feature map).

*Enforced by:* tests of the sandbox (a test app that tries to escape must fail).

## 8. Secrets

- **No secrets in code, ever**, in either repo. Anything inside the installer is public.
- Server secrets (payment keys, our OpenRouter key, Convex deploy keys) live only in Vercel and Convex environment variables.
- User secrets (API keys, passwords, tokens) live only in the OS keychain, never in SQLite, memory, recordings, artifacts or logs.
- Logs and error reports redact keys and tokens.
- **Other vendors' logins stay theirs** (decisions §20): when Titan117 runs a coding tool the user already has (Claude Code, Codex, Cursor, OpenCode, Antigravity), it starts the unmodified program and never reads, copies, stores, forwards or proxies that tool's credentials or session tokens. Sign-in happens only in the vendor's own flow. We never pay for, resell or route their usage.
- **GitHub as the user** (decisions §25): agents commit with the user's own git setup and act on GitHub with the user's access token from our GitHub App's device flow. The token lives only in the keychain and is never sent to Convex, our servers, logs or error reports. No client secret ships in the app. Pushes and pull requests go through approvals; no force-push, protected-branch push or merge without the user's OK.
- `.env.example` lists every variable with a placeholder; real `.env` files are git-ignored.

*Enforced by:* secret scanning on every push (for example gitleaks, MIT) and GitHub's secret scanning; a test that logging a key prints it redacted; for GitHub, a test that no Convex function or cloud request carries a GitHub token, a test that pushes and pull requests raise an approval, and a test that force-push is refused; for external coding tools, the engine's file permissions deny their credential folders (for example `~/.claude`, `~/.codex`) to every agent, a test that proves the adapters only spawn the vendor binary and read its output, and a check that the binary's hash matches the vendor's published release.

## 9. Remote control

Why these rules: remote control lets a task started from the web, a phone or chat run on the user's laptop; a taken-over account must not become a way into the laptop ([security.md](security.md) A1). Keep every step as easy as possible.

- **Off by default**, switched on per laptop in the desktop app. *Enforced by:* the engine ignores every remote command until the laptop's own setting is on; a test.
- **Two-factor required to switch it on** (Clerk MFA; a passkey suggested first). *Enforced by:* Convex refuses to register a device for remote control unless the session shows a second factor; a denial test.
- **Pairing is confirmed on the laptop's screen** (matching 6-character code). *Enforced by:* the engine adds a device's key only after the local confirmation; a test that pairing without it fails.
- **Laptop-only approvals:** deleting files, payments and purchases, sending files or data out, installing add-ons or marketplace items, changing allowed folders or permissions, pairing devices. The user may switch a category to "remotely after a second factor" (Clerk re-verification). *Enforced by:* the risk level in `defineTool` marks these; the engine rejects a remote answer to them without a fresh second factor; tests.
- **Alerts on every remote task** on the laptop and the user's other devices; **"Revoke all devices"** in the web app, the desktop app and the alert email. *Enforced by:* tests that revoking ends every session, unpairs every device and unlinks every chat.
- **The web and phone apps can do everything a chat channel can** (start, watch, approve, cancel, results, add a file). *Enforced by:* the command types are shared; a test lists every command a channel can send and checks the web app sends it too.
- **Chat channels:** linked with a one-time code; **private chats only** in V1 (group messages are refused); laptop-only approvals stay laptop-only. *Enforced by:* channel adapters drop group updates; tests.
- **End-to-end encryption in V1** ([security.md](security.md) A2): commands, events and results are encrypted on the user's devices; Convex stores ciphertext and routing metadata only. *Enforced by:* a test that reads the Convex tables after a remote task and finds no plaintext; device keys only in the keychain or non-extractable browser storage.
- Commands are accepted only from **paired devices of the same account**.
- Only **known command types** are accepted, each with a schema; anything else is refused.
- Every command carries a protocol version, an expiry and a unique id (no replays).
- Remote commands get the same approvals as local ones; nothing risky runs just because it came from the web.

*Enforced by:* tests on both sides, and the compatibility test in the desktop repo.

## 10. Repos in step

- Backend changes land first and stay backward compatible while older desktop versions (and the portal) use them.
- Protocol messages carry a version; an old desktop shows "please update".
- The desktop and portal repos update `@titan117/shared` in their own commit, at a fixed version.
- The portal has no backend: every admin function lives in `titan117-web`'s Convex, behind `adminQuery`/`adminMutation`.

*Enforced by:* the compatibility test in desktop CI, and the docs copy check (decision 17).

## 11. Dependencies and licences

- Lockfiles committed; installs in CI use them exactly.
- **Known-vulnerable dependencies fail CI** (npm audit or an OSV scan). Automated update pull requests (Dependabot or Renovate) keep them current.
- **Licence check in CI**: MIT, Apache 2.0, BSD and ISC allowed; GPL, AGPL and unknown licences fail unless listed as a separate program we run unchanged.
- **Every project we copy code from** gets a row in the sources list (project, licence, what we took, commit), and its notice in the third-party licences file shipped with the app.

## 11b. External services

- **No feature that uses a third-party service is specified or built until its row in [`notes/external-services.md`](notes/external-services.md) answers six questions:** whose account, who it acts as, where the credentials live, which approvals or reviews the vendor requires, what the terms forbid (resale, automation, scraping), and who pays.
- **Facts come from the vendor's own documentation or terms**, with the date and a link. A blog post or forum answer is a lead, not a source. Anything not checked says "To verify".
- **Default when in doubt:** the user's own account, acting as the user, credentials in their keychain, the vendor's official API and sign-in flow. Resell through credits only where the vendor allows it in writing.
- A feature-map note or a spec never names a mechanism ("through the GitHub App", "through credits") without that row.

*Enforced by:* the phase start review: a phase doesn't start while one of its services says "To verify" or an open decision it depends on is unanswered; the pull request checklist (§15); review of every feature-map and spec change.

## 12. Data and privacy

- Company data stays on the laptop unless the user shares it or sends it to a cloud model they picked.
- **Every new Convex table gets a row in the data table** (what it holds, why, what happens on account deletion), as in Ninjathons' decisions §4. *Enforced by:* review, and a test that fails if a table in the schema is missing from the list.
- Account deletion: a grace period, then a full delete in our cloud and of Clerk and payment data; local data is the user's to delete from the app.
- Nothing collected that isn't needed; analytics without personal content.
- **Error reports are opt-in and shown in full** before sending (decisions §22); they never include file contents, prompts, memory, keys, passwords or tokens unless the user ticks a box for that one report, and never anything from "local models only" folders. Kept 90 days. *Enforced by:* a test that builds a report from a session full of fake secrets, prompts and files and checks none of them are in it; the default setting test (always ask); the data table row in decisions §11.
- **Mail never reaches our servers** (decisions §27): not Convex, not the proxy, not error reports or sync; remotely only end to end encrypted. *Enforced by:* a test that a task reading mail never calls the proxy, a test that error reports and sync payloads drop mail content, and the network policy (security.md A3).

## 12b. The product owner portal

Our own admin app ([security.md](security.md) B6), in its own repo `titan117-pop`, separate from the user web app, at its own address: error reports, accounts and plans, credit corrections, kill switches, releases.

- Only named people; the admin role is set from the Convex CLI, never from a screen.
- **Two-factor required** (Clerk organisation with MFA enforced).
- **Every view and change logged** in `adminAudit` (who, what, when), append-only.
- Read-only by default; a change to a user's account asks for a reason; credit corrections are new ledger rows.

*Enforced by:* every portal function uses `adminQuery`/`adminMutation`, which check the role, a second factor on the session, and write the audit row; denial tests; a test that `adminAudit` has no update or delete path.

## 13. Releases

- `titan117-web`: merge to main deploys; preview deployments for pull requests; Convex schema changes reviewed for backward compatibility.
- `titan117-desktop`: a version tag builds, signs (Apple notarization, Windows certificate) and publishes; staged rollout of updates; a way to pull a bad update.
- **CI secrets scoped per job**: the signing certificate only in the desktop release job, the Vercel token only in the web deploy.
- **Signing keys never as files** ([security.md](security.md) B5): code signing through a cloud signing service (Azure Trusted Signing; Apple notarization); updates also signed with our own update key, which the app pins.
- **Branch protection on `main`** in every repo: pull requests only, CI green; a second developer's review once there are two.
- **GitHub Actions pinned to exact commits.**
- **Releases need a second step**: a protected GitHub environment approved by a second person, or by the owner with two-factor while alone.
- **Two-factor on every account that can ship or bill**: GitHub, Apple, Microsoft, Vercel, Convex, Clerk, Stripe, OpenRouter, the domain registrar.

*Enforced by:* repository settings checked by a script in CI (branch protection, required checks, environment approvals); a lint step that fails on unpinned actions; the app refuses updates without our update signature (test).
- Every release has notes, and `progress.md` says what shipped.

## 14. Apps our users build

The app builder writes code for users, so its output gets guardrails too:

- Generated apps never put secret keys in client code; secrets go in the backend's environment.
- Generated backends check the caller in every function (the same idea as §2, built into our templates).
- The QA agent runs before an app is published: build, tests, accessibility, a basic security scan (secrets in code, known-vulnerable dependencies).
- Publishing to the web, stores or installers always asks the user (§4).

## 15. Pull request checklist

Copied into every repo's pull request template:

- [ ] Typecheck, lint, tests and build pass
- [ ] New gated functions or tools have denial tests
- [ ] Seen working in the real app (say where, and what wasn't checked)
- [ ] No secrets, keys or personal data in code, logs or fixtures
- [ ] New tables have a row in the data table
- [ ] New dependencies: licence allowed, no known vulnerabilities, sources list updated if code was copied
- [ ] Protocol changes are backward compatible and versioned
- [ ] Third-party services used: their row in `external-services.md` is checked against the vendor's docs (§11b)
- [ ] `progress.md` and docs updated

## 16. CI per repo

| Check | `titan117-web` | `titan117-desktop` | `titan117-pop` |
|---|---|---|---|
| Typecheck, lint, build | ✓ | ✓ | ✓ |
| Tests, including denial and coverage tests | ✓ (Convex functions, including admin) | ✓ (engine tools and API) | ✓ (screens refuse without the admin role) |
| Prompt injection suite | | ✓ | |
| Compatibility test against the backend | | ✓ | ✓ |
| What's inside the build | | ✓ | |
| Docs copy is current | | ✓ | ✓ |
| Secret scanning | ✓ | ✓ | ✓ |
| Vulnerable dependencies | ✓ | ✓ | ✓ |
| Licence check | ✓ | ✓ | ✓ |
