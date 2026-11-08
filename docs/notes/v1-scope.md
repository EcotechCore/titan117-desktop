# V1 scope and implementation phases

16 Oct 2026. **Decided: V1 is everything in [the feature map](brainstorming-feature-map.md)** (decision 18). Titan117 launches only when the whole product works well. Only the "Not doing" list stays out: agents hosted around the clock, sign-in with chat subscriptions, bypassing CAPTCHAs or site terms.

The work is split into phases instead. Each phase builds on the ones before it and ends with a **check that marks it done**, as in Ninjathons. The phase list was approved on 16 Oct 2026 and is now the [roadmap](../01-launch-roadmap-v1.md), which has the detail per phase. Feature numbers like (5.4) point to the feature map.

## Phases, side by side

| # | Phase | What it builds | Done when |
|---|---|---|---|
| 0 | **Setup** | Both repos, CI, Convex, Clerk, Stripe test mode, OpenRouter, signing accounts, docs (`01`, `decisions.md`, `progress.md`, `CLAUDE.md`), guardrail wrappers and lint rules | Both repos build in CI; an empty app builds and runs locally on Windows |
| 1 | **Engine core** | Electron shell, Titan engine, local API, permission and approval layer, local database, model router with llama.cpp and OpenRouter (1.1, 1.7, 2.1–2.3, 4.5, 4.8, 4.9); error capture and a redacted local log (19.1) | A chat with a local and an OpenRouter model works; a tool call waits for approval; denial tests pass |
| 2 | **Accounts and money** | Web app basics, sign-in on desktop, plans, credit ledger, metering, top-ups, your own keys, licence lease and lock screen (9.1, 11.1–11.5, 2.5, 2.9, 1.23) | A test purchase adds credits; a task deducts them; a key in the keychain works |
| 3 | **Titan and memory** | General assistant with files, sandboxed shell, browser, code execution, MCP connectors, memory and scopes, skills (3.1–3.12); network policy per task | Titan finishes 10 scripted everyday tasks; prompt-injection suite passes |
| 4 | **Web search and artifacts** | Search sources, page and site reading, deep research; artifact panel, all artifact types, downloads, versions, sharing and comments (§16, §17) | A research task produces a sourced report that downloads as PDF, Word and Excel |
| 5 | **Install and setup** | Plug-and-play installer, setup wizard, components manager, requirement cards, health check, auto-update, checkpoints, offline mode and queue (1.2–1.24); error reports end to end with the product owner portal (§19) | A fresh Windows and Mac go from download to first task with no manual installs |
| 6 | **Folder agent** | Watched folders, parsing, OCR, local search, citations, spreadsheet calculations, local-only folders (§7) | Answers on a test set of real documents cite the right file and page |
| 7 | **Coding engine and code builder** | OpenCode inside the app: repos, plan and act, diffs, tests, git, pull requests, sub-agents, code review (§13) | The code builder fixes a set of real issues in a sample repo and opens a pull request |
| 8 | **App builder: web** | Build loop, templates, model roles, local preview, browser tests, versions, export, publish web, visual edit, SEO built in (6.1, 6.5–6.10, 6.13–6.15, 6.18–6.21, 6.28, 6.29, 14.1) | Five sample web apps build, pass their tests and publish |
| 9 | **App builder: mobile and desktop** | Expo, Android emulator, iOS Simulator, Expo Go, desktop apps with Tauri, clean VMs, containers, store and installer publishing, cloud devices (6.3, 6.4, 6.16, 6.17, 6.22–6.27, 6.30) | A sample app runs on the emulator and a phone; a desktop app installs on a clean VM |
| 10 | **Sidebar apps** | Add to sidebar, `titan` SDK, shared data layer, local database with sync, agents that maintain apps (6.2, 6.6, 6.11, 6.12) | A CRM and an inventory app share data and Titan answers across both |
| 11 | **Agent builder** | Create and edit agents in a form, agents working together, shared memory and message bus, model comparison (4.1–4.4, 4.6, 4.7, 2.4, 2.7, 2.8); agents and skills on request (18.1, 18.2) | A user creates an agent from the form and a manager agent splits a task between two agents |
| 12 | **QA and SEO agents** | QA reports and tests (5.2); SEO audit, fixes, Search Console, ranks, keywords, content, competitors, languages, local SEO, AI visibility (§14) | Both run end to end on a real site and their reports download |
| 13 | **Automation** | Scheduler, web watcher, recorder and replay, computer use in a VM and on your desktop (5.5, 5.6, §8) | A recorded task replays on a schedule; the law watcher reports a real change |
| 14 | **Marketing and video** | Brand kit, promo video, social posts, calendar, ready to post with reminders, newsletters, landing pages, analytics, reports, leads, sequences, ads, monitoring (5.1, 5.9, §15) | A website turns into a promo video and a month of ready-to-post posts, published from reminders on two platforms |
| 15 | **Remote and channels** | Devices, remote tasks and approvals from the web, chat channels, end-to-end encryption, phone app (9.2–9.7); safe remote control (off by default, two-factor, laptop-only approvals, revoke all), web parity with chat | A task started from the phone runs on the laptop and is approved from chat |
| 16 | **Marketplace** | Manifests, GitHub index, install and updates, permissions, sandbox, licences, verified items, other hosts, install any project (§10); add-ons on request, safe mode, core off-limits (18.3–18.8) | A community agent and an app template install safely from GitHub |
| 17 | **Teams and plans** | Teams, roles, audit log, agency and white-label plan (11.6, 11.7) | A team of three shares agents and apps with roles enforced |
| 18 | **Beta and launch** | Private alpha, closed beta, fixes, performance, security review, legal pages, launch; the error-report fix loop (18.9); release protections and an external penetration test | Beta issues fixed; the launch checklist passes |

**Order logic:** phases 1–5 are the foundation every agent needs. Phases 6–8 deliver the first agents people can use internally. After that, phases can partly overlap, since most are new agents and tools on the same engine. The rule from the guardrails still holds: a phase is done only when its check passes.

## Decide before phase 0

| # | Decision | Status |
|---|---|---|
| 1 | Approve this phase list | Decided: the [roadmap](../01-launch-roadmap-v1.md) |
| 2 | Electron or Tauri for our app | Decided: Electron (decisions §12) |
| 3 | Stripe directly or Clerk Billing | Decided: Stripe directly (§12) |
| 4 | Credits path | Decided: our proxy with one secret OpenRouter key (§12) |
| 5 | Node or Bun for the engine | Decided: Node, inside Electron (§12) |
| 6 | Coding engine | Decided: OpenCode, pinned behind our adapter (§12) |
| 7 | Default web search | Decided: OpenRouter search through the proxy (§14) |
| 8 | Plan names, prices, credits, rollover | Decided: [pricing](pricing.md) (§13) |
| 9 | First customer and OS order | Decided: small companies; Windows and macOS together (§14) |
| 10 | Name and logo | Logo decided: the angry eyes and TITAN117 (§9); **open:** trademark check and our own restyle before beta |
| 11 | Legal basics | **Open:** privacy policy and terms (phase 2), GDPR deletion plan, licence audit (§11) |
| 12 | GitHub organisation | Decided: EcotechCore owns all three repos, including the new `titan117-pop` (decisions §6) |
| 13 | Shell sandbox and risky commands | **Open:** decide during phase 0, needed for phase 1 |

## Set up before phase 0

- **Accounts with two-factor** (security.md B5): GitHub, Convex, Clerk, Stripe, Vercel, OpenRouter (Ecotechcore's existing accounts, decisions §16) and the domain registrar.
- **A hard monthly spending cap and alerts** on the OpenRouter account; the `security@titan117.com` mailbox.
- **The three repos under the EcotechCore organisation:** `titan117-web` (Next.js scaffold in `apps/web`) and `titan117-desktop` (Electron with React) move there; `titan117-pop` is new (a local folder with the docs is ready to push). Branch protection on `main`, and the shared docs in sync.
- **Open-source references folder** `D:\Officials\titan117-references`, next to the repos (a local folder, never pushed): clone only what the next phase's references list, starting with phase 1.
- **Start now, long lead times:** the Apple Developer Program and Windows code signing in Ecotechcore's name (needed before the first external testers; check whether Ecotechcore qualifies for Azure Trusted Signing); the trademark check. Meta business verification only when automatic social publishing is planned (after V1, decisions §24).
