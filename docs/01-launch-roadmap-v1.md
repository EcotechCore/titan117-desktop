# Launch roadmap V1

16 Oct 2026. How Titan117 gets from zero to launch. V1 is the whole product in [the feature map](notes/brainstorming-feature-map.md) (decisions §1); the work is split into 19 phases (0 to 18). Each phase has a **check that marks it done**; the next phase starts only when it passes. Status lives in [progress.md](progress.md). Where this file and [decisions.md](notes/decisions.md) disagree, decisions.md wins.

Related: [architecture](03-architecture.md) · [guardrails](guardrails.md) · [design](notes/design.md).

---

## Goal and quality bar

- **Launch when the whole product works well,** not earlier. No public release before phase 18.
- **Local-first:** agents run on the user's laptop; our cloud only does accounts, plans, credits, devices and what users choose to share.
- **Every phase meets the guardrails:** typecheck, lint, tests and build pass; refusals are tested; it was seen working in the real app; `progress.md` is updated.
- **Repos** (EcotechCore organisation): `titan117-web` (web app, Convex, shared package), `titan117-desktop` (Electron shell, engine, agents) and `titan117-pop` (the product owner portal). A phase names which repo it touches.

## Phases

| # | Phase | Repo | Depends on | Done when |
|---|---|---|---|---|
| 0 | Setup | all | — | Every repo builds in CI; an empty app builds and runs locally on Windows; the portal's empty app deploys behind two-factor |
| 1 | Engine core | desktop | 0 | Chat with a local and an OpenRouter model works; a tool call waits for approval; denial tests pass |
| 2 | Accounts and money | web, desktop | 0 | A test purchase adds credits; a task deducts them; an API key in the keychain works; an ended subscription locks the app |
| 3 | Titan and memory | desktop | 1 | Titan finishes 10 scripted everyday tasks; the prompt-injection suite passes |
| 4 | Web search and artifacts | desktop, web | 3 | A research task produces a sourced report that downloads as PDF, Word and Excel, and shares by link |
| 5 | Install and setup | desktop, web, pop | 1 | A fresh Windows and Mac go from download to first task with no manual installs; with the network off, local work runs for 14 days, then the app locks; a forced crash produces a report the user reviews before sending, and it shows up grouped in the product owner portal with nothing secret in it |
| 6 | Folder agent | desktop | 3 | Answers on a real test set of documents cite the right file and page |
| 7 | Coding engine and code builder | desktop | 3 | The code builder fixes a set of real issues in a sample repo and opens a pull request |
| 8 | App builder: web | desktop | 7 | Five sample web apps build, pass their tests and publish |
| 9 | App builder: mobile and desktop | desktop | 8 | A sample app runs on the Android emulator and a phone; a desktop app installs on a clean VM |
| 10 | Sidebar apps | desktop | 8 | A CRM and an inventory app share data, and Titan answers across both |
| 11 | Agent builder | desktop | 3 | A user creates an agent in the form; a manager agent splits a task between two agents; Titan builds a new agent and its skills from a request |
| 12 | QA and SEO agents | desktop | 8 | Both run end to end on a real site, and their reports download |
| 13 | Automation | desktop | 3 | A recorded task replays on a schedule; the law watcher reports a real change |
| 14 | Marketing and video | desktop | 4, 12 | A website turns into a promo video and a month of ready-to-post posts; on two platforms a post is published from its reminder with Copy and open (desktop) and the share sheet (phone) |
| 15 | Remote and channels | web, desktop | 2, 3 | A task started from the phone runs on the laptop and is approved from chat; remote control is off until switched on with two-factor, the laptop confirms pairing, a laptop-only approval can't be answered from the web, and Convex holds no readable command or result |
| 16 | Marketplace | web, desktop | 11 | A community agent and an app template install safely from GitHub; Titan builds a tool and a sidebar app on request as sandboxed add-ons; a broken add-on triggers safe mode and rolls back; no agent or add-on can write to the core |
| 17 | Teams and plans | web, desktop | 2 | A team of three shares agents and apps with roles enforced |
| 18 | Beta and launch | both | all | Beta issues fixed; the launch checklist passes; the external penetration test's critical and high findings are fixed |

**Order logic:** 1–5 are the foundation every agent needs. 6–8 give the first agents we can use ourselves (internal dogfooding starts after 8). From 9 on, phases can overlap where their dependencies allow, since most are new agents and tools on the same engine.

---

## What each phase builds

Feature numbers point to the feature map.

### 0 · Setup
- The three repos under EcotechCore, CI per [guardrails §16](guardrails.md), lint rules (Convex wrappers, `defineTool`, no desktop-to-web imports), secret scanning, licence check.
- Convex dev deployment, Clerk dev instance, Stripe test mode, OpenRouter account.
- Empty Electron app that builds and runs locally on Windows (unsigned during development). Signing, notarization and the auto-update channel come before the first external testers (decisions §16).
- `@titan117/shared` package published privately; docs copy check.
- Repository protections (security.md B5): branch protection, pinned GitHub Actions, two-factor on every account that can ship or bill; `security.txt` on the website.

### 1 · Engine core
- Electron shell and the engine process, local API with token (1.1).
- Permission and approval layer, budgets, web content as data (4.5, 4.8, 4.9).
- Local database, activity timeline basics (1.7, 1.8).
- Model router: llama.cpp built in, OpenRouter, model per agent (2.1–2.3), cost shown first (2.5).
- Error capture: every engine, agent and tool error is caught, written to a local log with keys and tokens redacted, and kept for an error report (19.1).

### 2 · Accounts and money
- Web: sign-up, plans, credits pages, invoices, download (9.1); desktop sign-in through the browser (1.2).
- The website moves into the web app: the pages of `homepage-grid/` (home, agents, industries, pricing, FAQ, Learn) rebuilt in Next.js from typed content, following `homepage-grid/design.md`; privacy policy and terms online; `security.txt` (decisions §18).
- Payments, credit ledger, top-ups, metering (11.1–11.4); your own OpenRouter, Anthropic, OpenAI and Google keys (11.5, 2.9).
- Signed licence lease, lock screen and subscription checks on the desktop (1.23, decisions §17).

### 3 · Titan and memory
- Titan with files, sandboxed shell, browser, code execution, MCP connectors (3.6–3.12).
- Memory you can see and edit, scopes, learned skills (3.1–3.5).
- Prompt-injection test suite, including exfiltration attempts.
- Network policy per task: site lists, ask before new sites after private data, block requests carrying private content (security.md A3).

### 4 · Web search and artifacts
- Search sources (credits, own key, the browser on the user's request), page and site reading, deep research, trusted sources, cache (§16).
- Artifact panel, all types, edit, versions, brand kit, downloads in every format, sharing, comments, live data, templates (§17).

### 5 · Install and setup
- Plug-and-play installer, setup wizard, hardware check, components manager, requirement cards, alternatives, setup checklist, health check, keep awake, checkpoints, notifications, auto-update (1.3–1.6, 1.9–1.21).
- Offline mode and the offline queue (1.22, 1.24): every feature checked with the network off.
- Error reports end to end (§19, decisions §22): crash reporter, "Something went wrong" card with the full report shown first, Report a problem, the always-ask setting, offline queue, reference IDs; in `titan117-web` the `errorReports` and `errorGroups` tables and their admin functions; in `titan117-pop` the error screens with grouping and alerts.

### 6 · Folder agent
- Watched folders, all document types, OCR, local search, citations, spreadsheet calculations, local-only folders, read-only (§7, 5.4).

### 7 · Coding engine and code builder
- OpenCode in headless mode inside the engine; approvals routed to ours; repos, plan and act, diffs, tests, git, pull requests, project memory, sub-agents, code review, open in editor, remote coding tasks (§13, 5.7).
- Your own coding tools (13.14): detect installed, signed-in Claude Code, Codex, Cursor's agent, OpenCode and Antigravity; run the unmodified program through the sandboxed shell and our approvals; show its output as a task; fall back to our engine when it's missing or signed out (decisions §20).

### 8 · App builder: web
- Build loop, plan approval, templates, model roles and escalation, local preview, Chromium, Firefox and WebKit tests, screen sizes, test report, versions, export, publish web, visual edit, SEO built in (5.3, 6.1, 6.5, 6.7–6.10, 6.13–6.15, 6.18–6.21, 6.28, 6.29, 14.1).

### 9 · App builder: mobile and desktop
- Expo, Android emulator, iOS Simulator, Expo Go, automated taps; desktop apps with Tauri, clean VMs, containers; store and installer publishing; cloud devices (6.3, 6.4, 6.16, 6.17, 6.22–6.27, 6.30).

### 10 · Sidebar apps
- Add to sidebar, `titan` SDK, shared data layer, local database with sync, another target per project, agents that maintain apps (6.2, 6.6, 6.11, 6.12, 6.14).

### 11 · Agent builder
- Agent definition files, built-in agents, clone and edit, the create-agent form and full builder, agents working together, shared memory and message bus, smart routing, model comparison, media providers (4.1–4.4, 4.6, 4.7, 2.4, 2.7, 2.8).
- Agents and skills on request: ask Titan for an agent we don't have and it builds the definition and skills (18.1, 18.2).

### 12 · QA and SEO agents
- QA tester (5.2); SEO agent with audit, speed, fixes, Search Console, ranks, keywords, content, competitors, languages, local SEO, AI visibility, re-audits (5.8, §14).

### 13 · Automation
- Scheduler, web watcher, recorder and replay, logins from the keychain, computer use in a VM and on the user's desktop, recording other desktop apps (5.5, 5.6, §8).

### 14 · Marketing and video
- Brand kit, promo video, social posts, content calendar, ready to post with reminders (15.4, no platform APIs, decisions §24), newsletters, sequences, landing pages, images, analytics, reports, lead finding, ad drafts, monitoring (5.1, 5.9, §15). Video on Revideo or Motion Canvas plus FFmpeg; X is a bring-your-own connector with guided setup (decisions §15). Apply for the LinkedIn, Meta and TikTok app reviews early.

### 15 · Remote and channels
- Device pairing, remote tasks and approvals from the web, chat channels, end-to-end encryption, phone app (9.2–9.7). Telegram first; WhatsApp as a bring-your-own connector on the official Cloud API, with guided setup (decisions §14, §15).
- Safe remote control (9.8–9.11, decisions §23): off by default, two-factor to switch it on, pairing confirmed on the laptop, laptop-only approvals, alerts, revoke all; private chats only; the web and phone apps do everything chat does; end-to-end encryption with device keys and rotation.

### 16 · Marketplace
- `titan.json`, GitHub index, install and updates, fork and publish, permissions, sandbox, dependency scan, licences, verified items, other hosts, install any open-source project (§10).
- Growing the app: tools and sidebar apps built on request as add-on packages with manifests, versions and rollback; share to the marketplace; safe mode; the core-is-off-limits checks (18.3–18.8, decisions §21).

### 17 · Teams and plans
- Teams, roles, audit log, agency and white-label plan (11.6, 11.7).

### 18 · Beta and launch
- Code signing and notarization for Windows and macOS, the auto-update channel, production deployments, private alpha (friends), closed beta (small companies), performance and security review, legal pages, launch checklist.
- Release protections in place before the first external testers: cloud code signing, our own update signature pinned in the app, a second approval to publish (security.md B5).
- **External penetration test** of the desktop app, remote control and pairing, the Convex functions, the credit proxy and the product owner portal; critical and high findings fixed before the closed beta. Incident checklist rehearsed once.
- The fix loop: triage error reports from alpha and beta in the product owner portal, link groups to issues and releases, review suggested fixes (18.9), ship them through auto-update, and show "Fixed in" in the app.

---

## Risks and open decisions

| Risk | Mitigation |
|---|---|
| Scope: everything in V1 is a very large build | Strict phase checks; internal use from phase 8 on to find problems early; cut-or-delay decisions recorded in decisions.md |
| Local models too weak on ordinary laptops | Hardware check, OpenRouter fallback with cost shown, test sets per agent |
| Coding engine (OpenCode) API changes | Pin versions, wrap it behind our own interface, compatibility tests |
| Platform rules: app stores, social APIs, Google | Social posting in V1 needs no API reviews (ready to post, decisions §24); app store accounts and signing bought early |
| Signing and notarization delays | Buy the Apple and Windows signing accounts well before the first external testers (decisions §16) |
| Trademark: "Titan117" and the eyes logo | Trademark check now; our own restyle of the eyes before beta |
| Prompt injection and unsafe actions | Guardrails §4–§5, approval layer, injection suite in CI |

Open decisions, each with the phase that needs it, are listed in the [feature map](notes/brainstorming-feature-map.md#open-decisions); the ones for phase 0 also in [decisions.md](notes/decisions.md#open-decisions).
