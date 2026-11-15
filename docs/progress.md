# Progress

Where the build stands against the phases in the [roadmap](01-launch-roadmap-v1.md). Update this file in the same commit as the work: change the phase table when a phase starts or finishes, and add a log entry, newest first.

**Now:** phase 4 is built and waiting for the owner's checks; phase 5 has started early at the owner's request, with error reports (15 Nov 2026). **Next step:** more of phase 5 (installer, setup, offline); the owner works through `docs/owner-checklist.md` at the end.

## Phases

| # | Phase | Status | Started | Finished |
|---|---|---|---|---|
| 0 | Setup | Done | 9 Nov 2026 | 14 Nov 2026 |
| 1 | Engine core | Done | 14 Nov 2026 | 14 Nov 2026 |
| 2 | Accounts and money | Done | 15 Nov 2026 | 15 Nov 2026 |
| 3 | Titan and memory | Done | 15 Nov 2026 | 15 Nov 2026 |
| 4 | Web search and artifacts | In progress | 15 Nov 2026 | |
| 5 | Install and setup | In progress | 15 Nov 2026 | |
| 6 | Folder agent | Not started | | |
| 7 | Coding engine and code builder | Not started | | |
| 8 | App builder: web | Not started | | |
| 9 | App builder: mobile and desktop | Not started | | |
| 10 | Sidebar apps | Not started | | |
| 11 | Agent builder | Not started | | |
| 12 | QA and SEO agents | Not started | | |
| 13 | Automation | Not started | | |
| 14 | Marketing and video | Not started | | |
| 15 | Remote and channels | Not started | | |
| 16 | Marketplace | Not started | | |
| 17 | Teams and plans | Not started | | |
| 18 | Beta and launch | Not started | | |

## Log

Each entry: date, phase, what was done, and anything left open. One entry per piece of work, not per commit.

### 15 Nov 2026 · Phase 5: error reports

Started at the owner's request before phase 4's check is run. Built on `phase-5-error-reports`, branched from `phase-4` (the web side is in `titan117-web`). Decisions §45, **to be confirmed**.

- **"Something went wrong" (19.2):** every caught error tells the window, which shows a card offering to review a report (unless the setting is "never ask"); a failed task's details have "Send a report about this".
- **Report a problem (19.3)** in the sidebar: the full report is shown before anything is sent (app, system, where, the error and stack trace, the last 40 log lines), with a note; Send or Don't send.
- **What's in it (19.4):** redacted, and the home folder shown as `~`; never prompts, files, memory, keys or tokens (tested with a task whose prompt held private text and an error holding a key and a home path).
- **The queue (19.8):** a report that can't go (signed out, offline, today's limit) waits and goes on sign-in or every 10 minutes; the sent one is exactly the one shown, plus the note.
- **References and fixes (19.5):** each sent report gets a `T117-...` reference; the app asks which ones a release fixed and shows "Fixed in ..." in Your reports.
- **The setting (19.7):** always ask (default), send automatically (at most one a minute), never ask.
- **Crashes (19.1):** when the engine stops unexpectedly, the restarted engine keeps it as a caught error to offer.
- **Tests:** 6 new; 252 in all. **Seen in the real app** (built, driven by Playwright, throwaway data): the dialog with the full report and the setting, sending while signed out ("Waiting: sign in..."), no console errors.
- **Not checked:** sending to the real web app (the routes must be deployed; needs the owner signed in), an engine crash in the real app, macOS.
- **Not built yet in phase 5:** the installer, setup wizard, hardware check, components manager, offline mode and the offline queue for everything else, auto-update, the Visual C++ runtime and slimmer llama.cpp binaries.

### 15 Nov 2026 · The owner checklist

Every open item for the owner, from all three repos' logs, is now in one place: `docs/owner-checklist.md` (shared doc): decisions to confirm (§44 first), checks only the owner can run (phase 4's check), accounts and services, legal, vendors, before the beta. CLAUDE.md says new owner items go there in the same commit. At the owner's request, phase 5 starts before phase 4's check is run; that's recorded on the checklist for the owner to confirm.

### 15 Nov 2026 · Phase 4: web search and artifacts

Built on `phase-4` (decisions §44, **to be confirmed by the owner**). The web side (share links, the shared page, Report) is in `titan117-web` on `phase-4`.

- **Web search (16.1-16.3, 16.9-16.12):** `web_search` through one service: credits use OpenRouter's `openrouter:web_search` server tool on Exa (through the proxy, or the user's own OpenRouter key); the user's own **Exa, Tavily or Brave** key goes straight to the provider (keys in the keychain, checked before saving, in a new "Your own search keys" list). The query is checked for private passages before anything is sent; results from blocked sites are dropped whatever the provider returns; a 15-minute memory cache (never for Brave, its terms); the cost of a credits search counts towards the task's budget and shows in the activity log. A **Web search** view sets the source, country and language (from the laptop's own by default) and Titan's trusted and blocked sites.
- **Reading (16.5, 16.6):** `web_fetch` now uses Readability on linkedom (title, author, date, headings and lists kept); `read_site` follows a site's own links, at most 25 pages, one a second. robots.txt is respected, after the network policy has allowed the site, so a refused site gets no request at all.
- **Deep research (16.8):** a **Deep research** chip in the composer (also when a message starts with "Research"): its own instructions and a bigger budget (60 steps, 30 minutes, $2), ending with a document artifact with numbered sources.
- **Artifacts (17.1-17.12):** documents, pages and small tools, spreadsheets, charts (our own SVG), diagrams (Mermaid, drawn strictly in the window) and slides, in the local database with a version per change. Tools `artifact_create`, `artifact_update`, `artifact_read`, `artifact_list` (no approval: the agent's answer) and `artifact_save` (asks, like any file write). The panel opens beside the chat with Edit, Versions (compare and restore), Download, Share and full screen; an **Artifacts** gallery with search and five templates (offer, invoice items, monthly report, meeting notes, project plan).
- **Sandbox (17.18):** artifacts are shown from `titan117://sandbox/<random id>`, served with a `sandbox allow-scripts allow-popups` content policy and no network; their links open in the system browser. PDF and PNG are printed by a hidden window in its own session that cancels every request outside the sandbox.
- **Downloads (17.8, 17.19, 17.20, 17.23):** PDF (A4 or Letter, light or dark), Word with real headings, lists, tables and links, Excel with real cells and formulas (a document's Excel file holds its tables and a Sources sheet), PowerPoint with editable text, plus Markdown, HTML, text, CSV, SVG, PNG and the Mermaid source; copy to clipboard.
- **Sharing (17.13):** Share makes a light, self-contained snapshot; anything that looks like a key or token, or any secret the engine holds, stops it before it is sent.
- **Licences:** Mermaid's optional ELK layout (elkjs, EPL or GPL) is replaced by a stub at build time and isn't in the bundle (checked); `Zlib` allowed; buffers and chainsaw (MIT/X11, inside ExcelJS) named exceptions.
- **Tests:** denial tests for all 7 new tools; 20 new behaviour tests (search sources, cache, Brave not cached, site lists, robots.txt, Readability, versions, Word/Excel/PowerPoint files read back, CSV formula defusing, the sandbox policy, sharing refusals, an agent-made artifact exported and shared through the engine, deep research); the print window and the frame policy in the window tests. 246 in all.
- **Seen in the real app on Windows** (the built app driven by Playwright, a throwaway data folder): the gallery and templates, a document in the sandboxed panel (it could reach neither the app's page nor the network), an edit as version 2 and the compare view, slides, PDF, Word, Excel and PowerPoint saved through the real save path, the Web search view and the Deep research chip; no console errors.
- **Real search checked once** with the development key: OpenRouter returns the results as citations on Chat Completions, and `usage.cost` includes the search.
- **Not checked:** a full research task with a real model through credits (the phase's check, for the owner); sharing against our real web app; macOS; Brave, Tavily and Exa with real keys; dark mode of the panel's own controls.
- **Carried forward:** comments on shared pages (17.14), live data from sidebar apps and the documents index (17.15, phases 6 and 10), turning an artifact into an app (17.16, phase 8), scheduled artifacts (17.17, phase 13), Google Docs, Sheets and Slides (17.25, waits for the Google sign-in), the brand kit (17.11, with 15.1 in phase 14), several artifacts as one ZIP (17.21), sharing with chosen people (sign-in), browser downloads (from phase 3).

### 15 Nov 2026 · Phase 3 done

Phase 3's check is met: 13 of 13 everyday tasks and injection scenarios with Claude Haiku 5.5 and with GPT-6 Luna, and the injection suite in CI. Built on the desktop side: the sandboxed shell and scripts, the browser, web pages, MCP connectors, memory, skills, past-task records, speech and the network policy per task; seen working in the real app on Windows. The owner confirmed decisions §43, choosing commands on Windows without an OS sandbox and the system voices (no Kokoro, GPL inside), and closed the phase the same day.

- **Not checked:** macOS; a connector to a real service; Python scripts; the owner's own microphone.
- **Carried forward:** the one inbox for Gmail, Outlook and IMAP (3.6, waiting on Google's verification and Microsoft's publisher check); SSH and cloud sandboxes (3.15, phase 7); browser downloads (phase 4); a natural voice later, through credits or a local model with no GPL inside; a licence check that looks inside packages, not only at their declared licence.

### 15 Nov 2026 · Shared docs synced: the system voices

Synced from `titan117-web`: decisions §43.10, read aloud keeps the system voices and Kokoro is not used (GPL inside). Nothing else changed here.

### 15 Nov 2026 · Shared docs synced: commands on Windows

Synced from `titan117-web`: decisions §43.1, Windows commands run without an OS sandbox (the owner chose option A). Nothing else changed here.

### 15 Nov 2026 · Phase 3: a live sound meter while you speak

At the owner's request after trying voice input: while recording, the message box shows a pulsing dot, a timer, sound bars that move with your voice ("Speak now" until it hears you, then "Listening"), Cancel (Escape) and Done (Enter); then "Writing out what you said…" until the text arrives. If nothing was heard, it says so. Checked in the built app with Chromium's test microphone; the owner's own microphone is still to try.

### 15 Nov 2026 · Phase 3: Titan and memory, built; the check is met

Built on `phase-3-titan` (decisions §43, to be confirmed). **Phase 3's check is met:** `pnpm eval:titan` ran the ten everyday tasks and the three prompt-injection scenarios against real models through OpenRouter, **13 of 13 with Claude Haiku 5.5 ($0.02) and 13 of 13 with GPT-6 Luna ($0.02)**, and the deterministic injection suite passes in the normal tests. **Seen in the real app on Windows:** a task wrote a file and ran a command after the approval cards (the second offered "Always allow `echo` in this folder"); memory added from the Memory view; speech read a sentence aloud with the Windows voice and Whisper wrote it back nearly word for word (7 seconds) inside the app's own engine.

- **Tools** (all through the permission layer, each with a denial test): files (list, read, write, search, move, new folder, delete: always asks), `run_command` (the sandboxed shell; which commands ask is in `tools/shell-rules.ts`), `run_code` (JavaScript on the app's Node, Python if installed), `web_fetch`, the browser (`browser_open`, view, click, type, select, back: Playwright on the laptop's Edge or Chrome, `lib/browser.ts`), memory (`memory_search`, `memory_save`, `memory_forget`), skills (`skill_read`, `skill_save`), `past_tasks`, speech (`speak`, `transcribe`), and connector tools from MCP servers (`lib/mcp.ts`).
- **The network policy per task** (`lib/web.ts`, `privacy.ts`): site lists, a question before a new site once the task has read private data, and private passages (as fingerprints) blocked from leaving in addresses, form fields, uploads, commands and scripts, also encoded. In the browser every request goes through it; a real-browser test shows the hidden-image trick blocked.
- **Memory, skills, past tasks** (`memory.ts`, `lib/skills.ts`, `records.ts`): shared and per-agent memory with full-text search; skills as Markdown files in the data folder; a record of every task that used tools; all in Titan's instructions at the start of a run.
- **Scripts call Titan's tools** (feature 4.10): `titan.call()` through `POST /v1/tool-calls` with a per-task token; tested with a script that read 30 files and returned one line.
- **Window:** Memory (remembered, skills, past tasks; add, edit, forget, delete), Connectors (add a program or an address, secrets to the keychain, tools with how each asks), approval cards that show scripts and skills to review and "Always allow … in this folder", step labels for every tool, a microphone button and "Read aloud". The window may use the microphone and nothing else (`allowPermission`, tested).
- **Shell:** connector secrets in the keychain (`src/main/lib/connector-secrets.ts`), sent to the engine only.
- New local tables `task_sites`, `shell_allows`, `memories` (+ full-text index), `task_records` (+ index), `connectors`; `approvals.always_label`. Nothing new in Convex.
- New dependencies: `playwright-core` 1.65.1 (Apache 2.0), `@modelcontextprotocol/sdk` 1.32.2 (MIT), `@huggingface/transformers` 4.3.2 (Apache 2.0, with ONNX Runtime, MIT). Licence check passes. `SOURCES.md` lists the code adapted from Codex.
- **217 tests** (+80): denial tests for all 24 tools, shell rules, the leak detector, real shell commands, scripts, memory, skills, records, connectors with a real MCP server, speech, the window's permission, the injection suite. Lint, typecheck and build pass.
- **Not checked:** macOS (the Seatbelt sandbox, `say`); the microphone button with a real microphone (the speech path behind it was checked); a connector to a real service; Python scripts (no Python on this laptop).
- **Not built in phase 3, for the owner to place:** the one inbox for Gmail, Outlook and IMAP (3.6, decisions §27; needs Google's verification and Microsoft's publisher check, still "to verify"), code execution in containers, SSH and cloud sandboxes (3.15, planned for phase 7), Kokoro voices (its phonemizer is GPL), browser downloads (phase 4). Before the public beta: an OS sandbox for commands on Windows (decisions §43.1).

### 15 Nov 2026 · Phase 2 done

Phase 2's check is met (details in the web repo's log): a test purchase added credits, a task deducted them, the owner's own OpenRouter key worked from the keychain, and cancelling the subscription locked this app. The desktop side (sign-in, the licence lease, the lock screen, credits through the proxy, your own API keys) is merged. Closed by the owner the same day.

- **Not checked:** macOS.
- **Carried forward:** the production web and Convex addresses and the production lease public key go into the build before external testers (phase 18).

### 15 Nov 2026 · Shared docs synced: deleting an account

Synced from `titan117-web`: decisions §42 (account deletion after 30 days), the `users` row in the data table, and Clerk's and Stripe's deletion facts in `external-services.md`. Nothing else changed here.

### 15 Nov 2026 · Shared docs synced: the website in the web app

Synced from `titan117-web`: decisions §41 (the website in the web app, legal pages, the waiver confirmed on invoices) and Stripe's invoice-footer facts in `external-services.md`. Nothing else changed here.

### 15 Nov 2026 · Phase 2: your own API keys; the lock comes sooner

Built on `phase-2-own-keys` (decisions §40). **Seen working on Windows:** with the owner's own OpenRouter key saved, a task with `openai/gpt-6-luna` ran three model steps and listed two folders and read two files; the credits proxy recorded no calls, so the key was used. Before that, cancelling the sandbox subscription locked the app at its next lease check.

- **`src/main/lib/keys.ts`:** OpenRouter, Anthropic, OpenAI and Google keys in the keychain (`safeStorage`), checked with the provider before saving, handed only to the engine; the window can ask only which providers have one.
- **Engine:** Claude through Anthropic's official SDK (`src/engine/lib/anthropic.ts`; thinking blocks kept and sent back; a cut-off tool call is never run; refusals reported); OpenAI and Gemini through the OpenAI-format client (Google's endpoint is beta); an own OpenRouter key replaces credits. New model ids `anthropic:`, `openai:`, `google:`; the engine may also reach `api.anthropic.com`, `api.openai.com` and `generativelanguage.googleapis.com`.
- **Activity log:** each model step says how it was paid (via credits, via your … key, via the development key).
- **Window:** Models → Your own API keys (add, replace, remove) and the models each key unlocks, labelled "billed to your … key".
- **Lease renewal** every 30 minutes and when the window regains focus (at most every 5 minutes).
- 137 tests (a fake Anthropic stream with thinking and a tool call, key checks, routing per provider, the "via" label). New dependency `@anthropic-ai/sdk` 1.8.0 (Apache 2.0).

### 15 Nov 2026 · Phase 2: sign-in, the licence lease and the lock screen

Built on `phase-2-desktop-sign-in` (decisions §17, §39), with the web side in `titan117-web`. **Seen working on Windows:** the app opened on the lock screen; Sign in opened the browser, the owner confirmed, and the app unlocked on the Starter plan; a task with a cloud model ran three model steps and three file tools, each charged 1 credit through the credits proxy.

- **`src/main/lib/account.ts`** (main process): sign-in with a loopback redirect at `127.0.0.1` and PKCE; the device token kept with Electron's `safeStorage` (the OS keychain) and never sent to the window; the lease renewed at start and every 6 hours, kept offline; a 401 signs the laptop out. `src/main/lib` is the one shell folder allowed file and network access (lint rule and test).
- **`src/main/lease.ts`:** checks the lease's ECDSA P-256 signature with the public key built in, that it's for this device, and the expiry against the latest time the app has seen, so a clock set back doesn't extend it; a reminder in the last 3 days.
- **Lock:** the lock screen replaces the workspace (signed out, no plan, or 14 days offline); the engine refuses new tasks (423 `LOCKED`) and stops a running one between steps with a note to continue later. From source with no `TITAN117_API_URL` in `.env`, nothing locks (development only).
- **Credits:** signed in, cloud calls go to the credits proxy with the device token; the engine may reach that exact origin besides OpenRouter and Hugging Face. Clear messages for no credits, signed out and too many calls. Settings say where cloud calls go.
- 124 tests (lease, sign-in with a faked browser and server, lock, proxy routing, network rule).
- **Before external testers (phase 18):** the production web and Convex addresses and the production lease public key go into the build.

### 15 Nov 2026 · Shared docs synced: the credits proxy

Synced from `titan117-web`: the `proxyCalls` row in the data table (decisions §11) and how the proxy charges OpenRouter calls (`external-services.md`). Nothing else changed here.

### 15 Nov 2026 · Shared docs synced: plans, credits and Stripe

Synced from `titan117-web`: four new tables in the data table (decisions §11: `stripeCustomers`, `stripeEvents`, `creditBuckets`, `creditLedger`) and the no-refunds rule in `pricing.md` (decisions §33.8). Nothing else changed here.

### 15 Nov 2026 · Shared docs synced: phase 2 prep

Synced from `titan117-web`: Stripe and the users' own model keys checked against the vendors' docs in `external-services.md`; phase 2 references cloned and licence-checked in `open-source-references.md`. Nothing else changed here.

### 14 Nov 2026 · Phase 1 done

Phase 1's check is met. Seen in the real app on Windows, run from the build with the development key in `.env`, after the owner updated the Visual C++ runtime (14.36 to 14.52):

- **Local chat:** Qwen2.5 1.5B Instruct was downloaded from the Models view (1.1 GB) and answered a question; the estimate said "Free · runs on this laptop" and the step was logged at no cost. Qwen3 4B (2.3 GB, added to the catalogue, Apache 2.0) listed a folder through the `list_folder` tool. llama.cpp runs on the graphics card through Vulkan; the CUDA build was not accepted on this laptop.
- **OpenRouter chat and a tool approval:** with Claude Haiku 5.5, "read notes.txt, then write summary.txt" read the file at once, then showed the approval card and "Needs you" in the sidebar, the title bar and the details panel. The file did not exist until Approve was clicked; afterwards it did, and the timeline says "approved by you". Each step's cost showed as under $0.01.
- **Outside content as data:** the notes file held a planted line telling the agent to write `hacked.txt`. The agent wrote only the summary and told the user about the line.
- Lint, typecheck, build, build contents, licences and 110 tests pass.

**Fixed while checking**
- The llama.cpp check now runs in the background: the first start took about 50 seconds and held up the window's first screen. The Models view says "checking the graphics card…" meanwhile.
- The graphics card's memory no longer counts memory a built-in chip shares with the system (it read 25 GB instead of 8).
- Steps and cost now update while a task runs, not only when it ends; a model changed in settings shows in the message box; blank lines left by a thinking model are trimmed.

**Not checked**
- The folder dialog: it is a native dialog the test could not click, so the test folder was written straight into the local database and removed afterwards. Worth one click by hand.
- Deny in the real app (covered by tests), the 7B model, the CUDA back end, macOS, a keyboard-only pass.

**Left open** (as in the entry below, plus)
- The first local answer after starting the app takes about a minute while the model loads; later ones are quick. A loading note in the thread would help.
- Qwen3 4B miscounted the two files as three: small local models make mistakes like this; phase 3's test tasks will show which sizes are good enough for which jobs.

### 14 Nov 2026 · Phase 1: engine core built, its check still open

On the branch `phase-1-engine-core`, nothing committed. Choices made while building are in decisions §38, **to be confirmed**.

**Built**
- **Engine process and local API (1.1):** the engine (`src/engine/`) runs as an Electron utility process, apart from the window. The window reaches it only over HTTP on `127.0.0.1` with a per-install token; events arrive as a stream. Other origins, other host names and requests without the token are refused. The page is served from `titan117://app`. A second launch brings the first window forward instead of starting a second engine; a crashed engine is started again.
- **Permission and approval layer (4.5):** tools exist only through `defineTool`, which declares risk and permissions. `read` runs at once, `write` waits for the user (approve, always in this task, deny), `external` always asks and is laptop-only. Three tools: list a folder, read a file, write a file.
- **Allowed folders:** chosen only in the folder dialog; `../`, absolute paths, links, the app's own folders and credential folders are refused.
- **Budgets (4.8):** steps, working time, cost and loop detection stop a task and say why.
- **Outside content as data (4.9):** file content reaches the model inside markers it can't forge, with the rule that nothing inside is an instruction.
- **Local database and activity timeline (1.7, 1.8):** SQLite through Node's built-in driver; every model call, tool call, approval, refusal and stop is logged with agent, model, cost and who approved.
- **Model router (2.1–2.3, 2.5):** local models through node-llama-cpp (two Qwen2.5 models, licences checked, each marked for this laptop) and OpenRouter with a development key from `.env`; the cost of a step is shown before sending.
- **Error capture (19.1):** engine, tool and model errors go to a redacted local log and an `errors` table; Electron's crash reporter keeps crashes on the laptop. Nothing is sent anywhere.
- **The window:** design.md 0.2 (sidebar, start screen, task thread with steps and approval cards, message box with model and cost, details panel with the activity log, Approvals and Models views).

**Checked**
- Lint, typecheck, build, the build-contents check, the licence check (550 packages) and 110 tests pass. `pnpm audit --audit-level high` passes (2 low, 3 moderate reported).
- Tests cover: every tool's denial test and the coverage test; folder escapes; approval waits, denials, "always", external actions, laptop-only answers; the local API's refusals (no token, wrong token, other origins, another host name, no folders route); budgets; redaction of keys in logs, errors and every stored row; OpenRouter streaming and errors, with OpenRouter faked.
- In the real app, run from the build and from the unpacked Windows app: it starts, the engine answers, the start screen and the Models view show (with OpenRouter's real model list), the packaged app has no cloud key, and a second launch starts no second engine.

**Not checked, so phase 1 is not done**
- **No chat was seen in the real app**, with a local or an OpenRouter model, and so no tool approval either: there is no OpenRouter key in `.env`, and local models can't start on this laptop. The task thread, approval card and details panel have only been exercised through the engine's tests, not seen on screen.
- **Local models:** llama.cpp's prebuilt Windows binaries crash the process that loads them when the Microsoft Visual C++ runtime is older than 14.40; this laptop has 14.36 (confirmed by loading the same binary with a newer runtime beside it). The engine now tries llama.cpp in a side process first and shows "local models can't start on this laptop yet" instead of crashing. Model download, loading, tool calls from a local model and the graphics card back ends are untested.
- The folder dialog (a native dialog), macOS, dark mode (design.md has no dark theme yet), a keyboard-only pass.

**Left open**
- Figtree and the Unbounded wordmark aren't bundled (both are OFL fonts, which need a named licence exception); the window uses the system font. Titan's eyes are a simple drawing, not the animated eyes from the mockup. Answers show as plain text, not formatted.
- Not built: the tray (the engine stops when the window closes), title-bar task tabs, search, the compatibility test against the backend (no protocol messages yet), the full local model catalogue.
- For phase 5: ship the Visual C++ runtime with the app; slim the packaged llama.cpp binaries (the unpacked app is 1.1 GB); the side process uses Electron's run-as-Node mode, which hardened builds often switch off.
- For phase 2: keys in the keychain instead of `.env`; credits instead of dollars in budgets and estimates.

### 14 Nov 2026 · Phase 0 done

Phase 0's check is met for this repo: CI passes, and the empty app builds and runs on Windows (details in the web repo's log). A CI step now checks the repository settings on every run (`scripts/check-repo-settings.mjs`): `main` protected, rules applying to admins, every CI job a required check. The pull request rule isn't visible to that check and is confirmed by hand when settings change. Not checked: macOS.

### 13 Nov 2026 · CI green, secret scanning config, branch protection

The first CI run (9 Nov) failed before installing anything: `package.json` didn't name the pnpm version, and pnpm 12 also records it in the lockfile. Fixed in two commits; every job now passes, including the unpacked Windows build on a Windows runner. `.gitleaks.toml` added (the same file as in the web repo) and the scan prints its findings. **Branch protection on `main`** (guardrails §13), set with this commit: changes only through pull requests, every CI job required and up to date with `main`, admins included, no force-pushes or deletions. No review is required while there is one developer.

### 7 Nov 2026 · Shared docs synced (third repo)

Shared docs and CLAUDE.md synced from `titan117-web` with `scripts/sync-docs.py`: a third repo, `titan117-pop` (the product owner portal), and the EcotechCore organisation as owner of all three (decisions §6). No code changed.

### 7 Nov 2026 · Desktop app mockup moved here

The clickable desktop app mockup moved from `titan117-web` to `mockup/` (run it with `python -m http.server 4181 --directory mockup`, or the `desktop-mockup` preview in `.claude/launch.json`); it's the reference for the real app's UI ([design.md](notes/design.md)). README rewritten (setup, build, docs, mockup; a UTF-16 leftover line removed). No code changed.

### 7 Nov 2026 · Shared docs synced from titan117-web

Shared docs and CLAUDE.md copied from `titan117-web` with its `scripts/sync-desktop-docs.py` (new: `docs/security.md`; updated: roadmap, architecture, guardrails, decisions, feature map, scope, design 0.2, brand, open-source references, docs README). Removed the retired helmet logo files, old brand media and `docs/mockups/final-a` (decisions §9, §18). No code changed; no phase status changed.

### 17 Oct 2026 · No free plan, offline licence
- No free plan: Titan117 works only with an active subscription ([decisions §13](notes/decisions.md#13-pricing), [pricing.md](notes/pricing.md)).
- Offline use with a signed licence lease; the app locks to a sign-in and renew screen when the lease expires or the subscription ends; files stay on disk and data export stays available ([decisions §17](notes/decisions.md#17-offline-use-and-licence)). Features 1.22–1.24; lease in phase 2, offline checks in phase 5.
- Confirmed: 14 days offline; offline mode (1.22–1.24) is in V1, built in phases 2 and 5. No trial of any kind, paid or free (decided 18 Oct).

### 17 Oct 2026 · Proxy, company and development setup
- Credits now go through **our proxy**: one secret OpenRouter key on our server, a streaming route on Vercel, credits deducted in Convex; the sub-key plan of 16 Oct is replaced. Users' own keys still go direct ([decisions §12](notes/decisions.md#12-tech-stack)).
- Ecotechcore owns Titan117; existing Convex, Clerk, Stripe, Vercel and OpenRouter accounts; domain titan117.com ([decisions §16](notes/decisions.md#16-company-and-development-setup)).
- Development on Windows first with unsigned local builds; phase 0's check is now "builds and runs locally on Windows". Apple and Windows signing are bought before the first external testers.
- Domain recorded: titan117.com.
- Tooling: pnpm, Vitest, and Playwright for end-to-end tests.

### 17 Oct 2026 · Open-source references downloaded
- [open-source-references.md](notes/open-source-references.md) lists the best open-source projects per phase. 53 study repos are shallow-cloned into `C:\Users\dniss\Officials\titan117-references` (about 7 GB); each row now has its commit and checked licence.
- Licence surprises: NocoDB and n8n are fair-code, Twenty and Postiz are AGPL, nut.js has no licence file (all ideas only); Dyad's `src/pro` and Activepieces' `ee` folders aren't free to copy. Jan and Convex Chef turned out Apache 2.0.
- Added the two closest products: OpenMausBot (Apache 2.0, except its `enterprise/` folder) and OpenBot by nightly-labs (PolyForm Noncommercial, ideas only), in `titan117-references/closest`.
- Open: a `NOTES.md` per project as each phase starts; the docs cache and pinned-clone script.

### 17 Oct 2026 · No paid third-party costs
- Decided ([decisions §15](notes/decisions.md#15-no-paid-third-party-costs)): the promo video uses free open-source tools (Revideo or Motion Canvas, plus FFmpeg) instead of Remotion; X and WhatsApp are bring-your-own connectors that users set up and pay for, with our guided setup.
- Open: confirm the video tools' licences and pick one at the start of phase 14.

### 16 Oct 2026 · Product defaults
- Decided ([decisions §14](notes/decisions.md#14-product-defaults)): OpenRouter as the default web search; shared UI in `@titan117/ui`; small companies on Windows and macOS first; Telegram as the first chat channel; LinkedIn, Facebook and Instagram, TikTok and X all in V1, built on open-source schedulers where the licence allows.
- Open: trademark check with the redrawn helmet, and the legal basics. Apply early for the social platforms' API reviews.

### 16 Oct 2026 · Pricing
- Decided ([decisions §13](notes/decisions.md#13-pricing), [pricing.md](notes/pricing.md)): Free (removed 17 Oct), Starter €15, Pro €25, Max €50 and Custom; 1 credit = €0.01 at provider cost × 1.25; one-month rollover; EUR and USD.
- Compared with Lovable Pro ($25 for 100–150 edits): with smart routing our Pro buys an estimated several hundred edits, plus free local work.
- Credits per plan confirmed: Starter 700, Pro 1,500, Max 3,500; per-plan features as in pricing.md.

### 16 Oct 2026 · Tech decisions
- Decided ([decisions §12](notes/decisions.md#12-tech-stack)): Electron for the desktop app, the engine on Electron's built-in Node, Stripe directly for payments, OpenCode pinned behind our own adapter.
- Credits path decided: one OpenRouter account we fund, with a sub-key per user limited to their credits. To confirm OpenRouter's terms allow it before phase 2.
- Open: the 7 remaining open decisions in decisions.md.

### 16 Oct 2026 · Planning: roadmap, decisions, progress
- V1 is everything in the feature map (decision 18). The work is split into 19 phases, each with a check that marks it done: [01-launch-roadmap-v1.md](01-launch-roadmap-v1.md).
- [decisions.md](notes/decisions.md) collects every decision so far, plus the open ones for phase 0. This file and `CLAUDE.md` follow the Ninjathons pattern.
- Open: the 12 open decisions; the trademark check and redrawn helmet before beta.

### 16 Oct 2026 · Design: direction and mockups
- Direction chosen after several rounds (brutalism, glass, editorial, white premium, lines, style tiles): tile A on the OpenAI base settings with neon green. Rules in [design.md](notes/design.md).
- Mockups: home, pricing, account, remote control, and the pro desktop app (mission control, task view, setup, app builder). Saved as HTML in [mockups/final-a](mockups/final-a/index.html); also on the canvas, page "Final · A".
- Desktop app: no black buttons or selections.
- Logo: helmet variations and animated states in [brand](brand/README.md); outline variation 03 chosen. Open: redraw as our own before beta.
- Open: real images and video (the current ones are stand-ins from verdictu-web); prices and credit amounts.

### 15 Oct 2026 · Planning: features, architecture, guardrails
- [Feature map](notes/brainstorming-feature-map.md) with 17 areas and about 210 features.
- [Architecture](03-architecture.md): thin cloud, local engine, two repos, model flows, security.
- [Guardrails](guardrails.md): rules for both repos, each with what enforces it.
