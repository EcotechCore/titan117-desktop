# Progress

Where the build stands against the phases in the [roadmap](01-launch-roadmap-v1.md). Update this file in the same commit as the work: change the phase table when a phase starts or finishes, and add a log entry, newest first.

**Now:** phase 1, Engine core, is done (14 Nov 2026). **Next step:** phase 2, Accounts and money (desktop sign-in through the browser, licence lease and lock screen). Phase 1 is merged.

## Phases

| # | Phase | Status | Started | Finished |
|---|---|---|---|---|
| 0 | Setup | Done | 9 Nov 2026 | 14 Nov 2026 |
| 1 | Engine core | Done | 14 Nov 2026 | 14 Nov 2026 |
| 2 | Accounts and money | Not started | | |
| 3 | Titan and memory | Not started | | |
| 4 | Web search and artifacts | Not started | | |
| 5 | Install and setup | Not started | | |
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
