# Titan117 architecture

Draft, 15 Oct 2026. How the web app, the desktop app and our small cloud fit together. The features are in [notes/brainstorming-feature-map.md](notes/brainstorming-feature-map.md); feature numbers like (4.5) point there. Where this file says "open", the choice isn't made yet (see [Open decisions](#13-open-decisions)).

## 1. The big picture

Three pieces: a **thin cloud**, a **local engine** on the user's laptop, and two windows onto that engine, the **desktop app** and the **web app**. The web app and the desktop app come first.

```
┌──────────────────────── Our cloud (small) ────────────────────────┐
│  Web app (Next.js on Vercel)        Convex                Clerk   │
│  · marketing, sign-up, billing      · users, plans        · auth  │
│  · credits, devices                 · credit ledger               │
│  · remote control                   · devices + command queue     │
│  · shared artifacts, marketplace    · shared artifacts, market    │
└───────────────▲──────────────────────────────▲────────────────────┘
                │ realtime (outgoing only)     │ model calls
┌───────────────┴──────── User's laptop ───────┴────────────────────┐
│  Desktop app (window) ◄──local API──► Titan engine (background)   │
│  · chat, agents, sidebar,            · agent runtime + approvals  │
│    artifacts, builder UI             · model router               │
│                                      · memory + documents index   │
│                                      · scheduler + checkpoints    │
│                                      · tools: browser, shell,     │
│                                        files, MCP, search         │
│                                      · coding engine (OpenCode)   │
│                                      · components manager         │
│                                      · local models (llama.cpp)   │
└───────────────────────────────────────────────────────────────────┘
```

**The rule behind it:** the work happens on the laptop; the cloud only does what must be shared or paid for (accounts, plans, credits, devices, remote commands, things the user chooses to share). Company data stays on the laptop unless the user shares it or sends it to a cloud model they picked.

## 2. Repositories

Decided 15 Oct 2026 (feature map, decision 16); `titan117-pop` added 7 Nov 2026. All three belong to the **EcotechCore** GitHub organisation (decisions §6).

| Repository | Contains | Deploys |
|---|---|---|
| `titan117-web` | Next.js web app; **the Convex backend** (schema, functions, guardrails); the shared package `@titan117/shared` | Web app to Vercel on every merge; Convex functions; the shared package to a private registry (GitHub Packages) |
| `titan117-desktop` | Electron shell; the Titan engine; built-in agents and tools; the `titan` SDK for sidebar apps | Signed installers for Windows and macOS when a version is tagged; auto-updates |
| `titan117-pop` | The product owner portal: a Next.js app for the owner and employees; installs `@titan117/shared`; no backend of its own (its admin functions live in `titan117-web`'s Convex) | Its own Vercel project at its own address (for example `admin.titan117.com`), on every merge |

### The shared package `@titan117/shared`

- The **command protocol** between the web app, Convex and the engine (message types, each with a version number).
- Shared TypeScript types and validation schemas.
- The generated Convex client (function names and argument types; no server code).
- Maybe later: shared UI components, here or in `@titan117/ui`.

### Rules that keep the repos in step

1. Backend changes land first and stay backward compatible: add fields and functions, don't change or remove old ones while desktop versions still use them.
2. Every protocol message carries a version; an outdated desktop app shows "please update" instead of failing.
3. A compatibility test in the desktop repo runs against the latest backend in CI.
4. Updating `@titan117/shared` in the desktop and portal repos is a deliberate commit at a fixed version. It is published to GitHub Packages as `@ecotechcore/titan117-shared` and installed under its own name with an npm alias (decisions §35).
5. Docs: shared product docs are edited in `titan117-web` and copied to the desktop and portal repos (`scripts/sync-docs.py`); a CI check fails if a copy is out of date (decision 17).

## 3. The desktop app

Two processes: a **window** (the interface) and the **Titan engine** (the work). The window talks to the engine through a local API.

### Why the window and the engine are separate

- Closing the window doesn't stop agents: the engine keeps running from the system tray while the laptop is on.
- Remote control is the same as local control: the web app and the desktop window are two clients of the same engine.
- A crashing tool or agent doesn't take the interface down.
- The shell can change later (Electron or Tauri) without rewriting the engine.

### The shell: Electron (decided, decisions §12)

| | Electron | Tauri |
|---|---|---|
| Size | ~150 MB | Small |
| Rendering | The same Chromium on Windows and macOS | The system's web view: Chromium-based on Windows, Safari-based on macOS |
| Fit with our stack | Node built in; Playwright, OpenCode and the video tools are Node or TypeScript | Needs a Node or Bun sidecar anyway |
| Track record | VS Code, Cursor and Claude Desktop | Good, younger |

We render a lot of web content (artifacts, previews, sidebar apps), so identical rendering matters more than installer size. Tauri stays the template for desktop apps that users build (6.4).

### The Titan engine

A background process in TypeScript (Node or Bun). Its parts:

| Part | Job | Built on |
|---|---|---|
| Local API | How the window talks to the engine | HTTP and WebSocket on localhost only, with a per-install token |
| Agent runtime | Runs agents from their definition files (4.1): the loop, tools, sub-agents, budgets | Our code |
| Permission and approval layer | Every tool call passes through it; risky ones wait for the user (4.5) | Our code; no agent can skip it |
| Model router | Sends each call to the right model and source (§5) | Our code |
| Memory | Facts, preferences, skills, scoped per company and agent (3.2–3.5) | SQLite, full-text search (FTS5), vector search (sqlite-vec) |
| Documents index | Watched folders, parsing, OCR, search (§7) | Same store; parsers like Docling or MarkItDown |
| Scheduler and job queue | Scheduled and long tasks with checkpoints, resume after sleep (1.5, 1.6, 8.1) | SQLite |
| Tools | Browser (Playwright), sandboxed shell, files, code, MCP client, web search | Each in its own process where possible |
| Coding engine | All code work: the code builder and the app builder (§13, §6) | OpenCode in headless server mode, as a child process, pinned behind our adapter (decisions §12). Works on GitHub as the user: their git setup, and a GitHub user access token from our GitHub App's device flow, kept in the keychain (decisions §25) |
| Your own coding tools | Hands a coding task to a tool the user already has (feature 13.14, decisions §20) | One adapter per tool that starts the vendor's unmodified CLI as a child process through the sandboxed shell, in the task's folder; reads its output stream; maps its permission prompts to our approvals. Never reads, copies or forwards the tool's credentials |
| Mail | One inbox for the user's mail accounts (3.6, decisions §27) | Gmail and Outlook through their own sign-in, others over IMAP and SMTP; mail stored and indexed only on the laptop; cloud models reach it only directly (local, own key, or a per-user capped OpenRouter key), never through our proxy |
| Local models | Running models on the laptop | llama.cpp (MIT), built in |
| Components manager | Downloads, updates and removes heavy parts (1.13) | Our code |
| Requirements checker | "You need this first" cards before a task starts (1.16–1.19) | Our code |
| Cloud bridge | Sign-in, credits, devices, remote commands, sharing | Convex client, outgoing connections only |

### Local storage

| Data | Where on the laptop |
|---|---|
| Memory, documents index, chats, job queue, settings | SQLite files in the app's data folder |
| Sidebar app data | One database per app (6.12) |
| Artifacts and their versions | Files plus an index in SQLite |
| Downloaded models, browsers, emulators, VM images | The components folder, shown with sizes |
| API keys, passwords, tokens (including the user's GitHub token, decisions §25) | **The OS keychain only** (Electron `safeStorage` or the system keychain) |

## 4. The web app and our cloud

### Web app (`titan117-web`)

Next.js on Vercel, built on the Ninjathons patterns (guardrail wrappers, entitlements, phases and progress docs).

- Marketing pages (moved in from `homepage-grid/` in phase 2, following its design.md), sign-up and sign-in.
- Account, plan, credits and invoices.
- Devices: pair, see online or offline, unpair (9.2).
- Remote control: start and watch agents, answer approvals (9.3, 9.4).
- Shared artifacts viewer with comments (17.13, 17.14).
- Marketplace browsing (§10).

The web app holds no company data and runs no agents. **Everything a chat channel can do, the web app can do too** (start, watch, approve, cancel, results, add a file).

### Product owner portal

A separate Next.js app, in its own repo (`titan117-pop`), at its own address (for example `admin.titan117.com`) for us: error reports (§22 of the decisions), accounts and plans, credit corrections, kill switches for add-ons and coding-tool adapters, releases. It has no backend of its own: it calls admin-only Convex functions that live in `titan117-web`. A separate Clerk application for staff with MFA required, so staff and customer accounts never mix (decisions §36), `adminQuery`/`adminMutation` only, every view and change written to `adminAudit` ([security.md](security.md) B6).

### End-to-end encryption of remote control

- **Keys:** each device (laptop, browser, phone) makes its own X25519 key pair; private keys stay in the OS keychain or as a non-extractable browser key. Convex stores public keys per device.
- **Pairing:** the new device scans the laptop's QR; both show the same 6-character code derived from the two public keys; the user confirms on the laptop, which then trusts that key.
- **Messages:** commands are sealed to the target laptop's key; events and results to every paired device of the account (libsodium, XChaCha20-Poly1305). Convex keeps ciphertext plus routing metadata: device, command type, time, size, status.
- **Revoking:** the removed device's key is deleted, and the laptop rotates its own key and re-shares it with the remaining devices; "Revoke all devices" resets every pairing.
- **Chat channels are not end-to-end** (the platform sees the message); the app says so when a channel is linked.

### Convex

| Area | Tables (first sketch) |
|---|---|
| Accounts | `users`, `entitlements` (written only by the payments webhook) |
| Credits | `creditLedger` (every top-up and every use, atomic), `usage` |
| Devices | `devices` (paired engines, last seen, version) |
| Remote control | `commands`, `commandEvents` (results and progress streamed back) |
| Sharing | `sharedArtifacts`, `artifactComments`, file storage |
| Marketplace | `marketItems`, `marketInstalls`, `marketReports` |

Every function checks who is calling and what they may do; the server is the security boundary, whatever the client.

### Clerk

Sign-in for both apps. The desktop app signs in through the system browser and a deep link back to the app (no password typed into the desktop app); the engine keeps a refreshable session token in the keychain.

### Payments

Subscriptions first, credits to top up. **Stripe directly** (decided 16 Oct 2026, decisions §12): regional prices, one-time credit purchases and EU VAT. Only the payment webhook writes `entitlements` and credit top-ups. Credits pay only for OpenRouter (models and search); every other paid service is the user's own account (decisions §31).

## 5. How model calls flow

| Source | Path | Our servers see the prompt? |
|---|---|---|
| Local model | Engine → llama.cpp on the laptop | No |
| User's OpenRouter key | Engine → OpenRouter | No |
| User's Anthropic, OpenAI or Google key | Engine → provider | No |
| Our credits, option A: proxy | Engine → our proxy (edge function) → OpenRouter; Convex keeps the ledger | Passes through |
| Our credits, option B: a key per user | Engine → OpenRouter with a per-user key whose spending limit we set from the user's credits; usage synced into the ledger | No |

**Decided 17 Oct 2026: option A, our proxy** ([decisions §12](notes/decisions.md#12-tech-stack)): one secret OpenRouter key on our server, a streaming route on Vercel, credits deducted in Convex. The same proxy carries OpenRouter's web search; every other paid service is the user's own account (decisions §31). Users' own keys go direct from the engine. Option B (a capped per-user key) is used only for tasks that read mail, so mail never passes through our proxy (decisions §27).

The router also handles: model per agent and per step (2.3), escalation from cheap to strong models (6.10), provider filters by data policy (no training, US or EU hosts) for company data, and costs shown before a task (2.5). Web search through credits (16.2) follows the same path as model calls.

## 6. Key flows, step by step

### Signing in on the desktop

1. The user clicks Sign in; the system browser opens Clerk.
2. After sign-in, a deep link returns to the app with a one-time code.
3. The engine exchanges it for a session, stores it in the keychain, and registers the device in Convex.

### A chat message with a tool call

1. The window sends the message to the engine (local API).
2. The agent runtime builds the prompt from memory and the agent's definition; the router picks the model.
3. The model asks for a tool (for example, run a command).
4. The permission layer checks it: allowed, refused, or "ask the user". If asked, an approval card appears in the window, the web app and chat channels.
5. The tool runs in its own process; the result goes back to the model; the answer streams to the window.
6. Credits used are recorded in the ledger.

### Remote control from the web app

1. The user picks a device and a task on the web.
2. The web app writes a command to Convex (with a protocol version).
3. The engine, subscribed to its device's commands over an outgoing connection, picks it up, checks it's from the paired account, and runs it.
4. Progress and results go to `commandEvents`; the web page updates in real time.
5. If the device is offline, the command waits or expires, and the web shows it.

### Building an app

1. The user picks web, mobile or desktop (6.1–6.4); the app builder loads that target kit.
2. Plan (strong model), approved by the user.
3. The coding engine writes the code; sub-agents use cheaper models.
4. The preview runs on the laptop; checks run in local browsers, emulators or a VM (6.20–6.30).
5. Errors go back to the agents until the checks pass or the budget runs out.
6. A new version is saved; optionally the app is added to the sidebar (6.2).

### Sending an error report

1. A crash (Electron's crash reporter) or an error in the engine, an agent or a tool is caught and written to the local log, with keys and tokens redacted.
2. The window shows "Something went wrong" with the full report; nothing is sent until the user says so (or has chosen "send automatically").
3. The engine sends it through the cloud bridge to Convex (`errorReports`); offline, it waits in the offline queue.
4. Convex groups it by signature (`errorGroups`) and returns a reference ID; the product owner portal (`titan117-pop`) shows groups, counts, versions and alerts.
5. When a release fixes a group, the app shows "Fixed in 1.4, update now?" to users who reported it.

### Building an add-on on request

1. The user asks Titan for something we don't have; Titan proposes the add-on (an agent and skills, a tool, or a sidebar app) and the permissions it needs.
2. After the user's OK, the agent builder, the coding engine or the app builder creates it as a package with a `titan.json` manifest.
3. It installs through the same permissions screen and sandbox as a marketplace item, with a version to roll back to.
4. The core (engine, permission layer, credits, licence, updates) is outside every agent's allowed folders, so nothing can modify it.

### Sharing an artifact

1. The user clicks Share; the artifact (only that one) is uploaded to Convex storage.
2. Convex returns a private link; the user picks who can see it.
3. Comments come back to the desktop, where an agent can answer or apply them.

## 7. Sidebar apps and artifacts

- Both run in **sandboxed frames** with a strict content security policy: no access to files, memory, the network or other apps unless granted.
- Sidebar apps talk to the engine only through the `titan` SDK (db, ai, auth, agent), and only with the permissions their manifest declares.
- Artifacts load scripts only from approved sources and never contain secrets when shared.

## 8. Third-party building blocks

Code we copy and adapt (MIT, Apache 2.0, BSD), tracked in a sources list:

| Area | Projects |
|---|---|
| Coding engine | OpenCode (MIT, decided) |
| Browser and testing | Playwright, axe-core, Lighthouse, Unlighthouse |
| Local models | llama.cpp |
| Search and reading | ddgs, open-webSearch (to check), Mozilla Readability, Trafilatura, Crawl4AI (to check) |
| SEO | SEOnaut, SiteOne Crawler, SerpBear |
| Artifacts and exports | Mermaid, docx, pptxgenjs, ExcelJS, reveal.js or Marp |
| Video | Revideo or Motion Canvas, FFmpeg as a separate LGPL build (decisions §15) |

GPL and AGPL projects (Postiz, Listmonk, Mautic, Firecrawl, Open Interpreter, Pandoc) are ideas only, never copied in.

## 9. Security checklist

The full rules, each with what enforces it, are in [guardrails.md](guardrails.md).

- **No secrets in code**, in either repo. Anything inside the installer is public.
- Server secrets (payment keys, OpenRouter master key, Convex deploy keys) only in Vercel and Convex environment variables.
- CI secrets scoped per job: the signing certificate only in the desktop release job, the Vercel token only in the web deploy.
- Every Convex function checks the caller and their rights.
- The local API listens only on localhost and needs a per-install token.
- Every tool call goes through the permission and approval layer.
- Shell and coding tasks run in separate processes, limited to allowed folders.
- Web content is data, never instructions; agents can't write it into memory as rules (4.9).
- Secrets only in the OS keychain, never in memory, recordings or logs.
- Remote commands only from paired devices of the same account; **end-to-end encryption in V1** (9.5, design below); remote control off by default, two-factor to switch it on, laptop-only approvals for the riskiest actions ([security.md](security.md) A1).
- A network policy per task: site lists, asking before new sites after private data, blocking requests that carry private content (A3).
- The product owner portal: named people, two-factor, every view logged (B6).
- The threat model, accepted risks, vulnerability reporting and the incident checklist: [security.md](security.md).
- Signed installers and signed updates.
- Marketplace items: permissions screen, sandbox, dependency scan, pinned commits (§10).

## 10. Building and releasing

| | `titan117-web` | `titan117-desktop` | `titan117-pop` |
|---|---|---|---|
| CI on every pull request | Typecheck, lint, tests, Convex function checks | Typecheck, lint, tests, compatibility test against the backend, docs copy check, a check of what's inside the build | Typecheck, lint, tests, docs copy check |
| Release | Merge to main deploys Vercel and Convex | A version tag builds, signs and publishes installers; the app auto-updates | Merge to main deploys its Vercel project |
| Signing | n/a | Apple developer account (notarization) and a Windows code-signing certificate | n/a |

## 11. What gets built first

Superseded by the [roadmap](01-launch-roadmap-v1.md) (16 Oct 2026), which splits the whole V1 into 19 phases. The first steps are the same:

1. **Setup:** the repos, Convex, Clerk, CI, signed desktop builds, the shared package.
2. **Accounts and money:** web sign-up, plans, the credit ledger, payments.
3. **Desktop and engine core:** Electron shell, engine, local API, chat with local and OpenRouter models, the model router, the components manager, setup cards.
4. **Memory and tools:** memory, files, browser, shell, web search, approvals.
5. **Remote control:** device pairing, the command queue, approvals from the web.
6. **Then the agents**, one at a time, starting with the app builder (web target).

The full phase plan, with a check that marks each phase done, belongs in the roadmap (`01`), as in Ninjathons.

## 12. Not in this architecture

- Servers that run agents for users around the clock. The engine runs on the laptop only.
- Signing in with chat subscriptions (Claude, ChatGPT) to run agents (decision 15).

## 13. Open decisions

Decided 16 Oct 2026 ([decisions §12](notes/decisions.md#12-tech-stack)): **Electron**, the engine on **Node**, **Stripe directly**, **OpenCode** pinned behind our adapter.

Also decided: credits through **our proxy** with one secret OpenRouter key (§5, option A); capped per-user keys only for mail tasks (decisions §27).

Also decided: shared UI in its own package, `@titan117/ui` ([decisions §14](notes/decisions.md#14-product-defaults)).
