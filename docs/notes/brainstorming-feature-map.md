# Feature map

Draft, 15 Oct 2026. Every feature discussed so far, grouped by area. The build order is in the [roadmap](../01-launch-roadmap-v1.md); decisions in [decisions.md](decisions.md). How it all fits together is in [the architecture](../03-architecture.md). **Decided 16 Oct 2026: everything here is V1.** Titan117 launches only as a complete product; the work is split into implementation phases instead (see [v1-scope.md](v1-scope.md)). The Stage column is kept for reference.

## The product in one line

An AI team for small companies that runs on your own laptop: a general assistant that can do almost any computer task, plus specialist agents that make videos, test your website, build your web, mobile and desktop apps, read your documents and watch the web for you. They share one memory, and you pick the model, local or from OpenRouter. It does what general agents like OpenClaw do, with safe defaults a company can trust.

## Ground rules (decided)

- **Agents run on the user's laptop.** No rented servers running agents around the clock. When the laptop is off, agents stop; scheduled work runs while the app is open or catches up on the next launch.
- **Two model sources:** local models (free, private, offline) and OpenRouter (the strongest models). The user picks per agent, and can override per step.
- **Two ways to pay for OpenRouter:** our credits (through our proxy, with a margin) or the user's own OpenRouter key (BYOK). Both need a subscription.
- **Subscription first, then credits** to top up, following Lovable's model.
- **Convex and Clerk** for accounts, subscriptions, credits and sync. Our cloud stays small.
- **Plug and play.** Download, install, sign in, and it works: nothing to install first, heavy parts download when a feature needs them (1.11 to 1.15).
- **Open-source projects are our inspiration and our starting code, adapted to our needs.** We study them, and copy and change their code where the licence allows:
  - **MIT, Apache 2.0, BSD:** copy and adapt freely; keep their copyright notices and list them in a third-party licences file.
  - **GPL, AGPL:** don't copy their code into Titan117, or the whole app would fall under their licence. Use them for ideas and rewrite the feature ourselves, or run them unchanged as a separate program the user installs.
  - **No licence or non-commercial:** ideas only.
  - Every project we take code from gets a row in a sources list (project, licence, what we took, commit).

---

## 1. Desktop app (the local runtime)

| # | Feature | Stage | Notes |
|---|---|---|---|
| 1.1 | Desktop shell for Windows and macOS | V1 | Electron (decisions §12) |
| 1.2 | Sign in with the Titan117 account | V1 | Clerk |
| 1.3 | Sidebar: agents, apps, chats, marketplace | V1 | Built apps live here too (§6) |
| 1.4 | Hardware check at first launch | V1 | RAM and GPU decide which local models to suggest |
| 1.5 | Keep awake while a task runs | V1 | Asks the OS to block sleep, only during work |
| 1.6 | Checkpoints and resume | V1 | A task picks up after sleep or a crash, not from the start |
| 1.7 | Local data store | V1 | SQLite for app data, memory and settings |
| 1.8 | Activity timeline | V1 | What each agent did, why, which model, what it cost |
| 1.9 | Notifications | V1 | Done, failed, needs approval |
| 1.10 | Auto-update | V1 | |
| 1.11 | **Plug and play install** | V1 | One signed installer for Windows and macOS (no "unknown publisher" warnings); everything the core needs is inside: the app, its runtimes (Node or Bun), the coding engine, the browser tool, SQLite and a small local model for search and embeddings. No Python, Node, Docker or Ollama for the user to install first |
| 1.12 | Setup wizard on first launch | V1 | Sign in, hardware check (1.4), then "what do you want to do?" (chat, build web or mobile apps, documents, marketing...); downloads only what those need |
| 1.13 | Components manager | V1 | Heavy parts download on demand with progress, and can be removed: local models, extra browsers, Android emulator, VM images, container runtime. Shows disk space used |
| 1.14 | Steps the user must do themselves, guided | V1 | Some things the OS or a vendor makes the user do: accept the Android SDK licence, install Xcode from the App Store (Mac), turn on virtualization (sometimes in the BIOS), restart after enabling WSL2 or Hyper-V. The wizard explains each with screenshots and checks it worked |
| 1.15 | Bundled tools over separate installs | V1 | Prefer tools we can ship inside the app: llama.cpp (MIT) instead of asking for Ollama, Podman instead of Docker Desktop (paid for larger companies), TypeScript or Rust tools over Python ones; where Python is needed, a private copy inside the app |
| 1.16 | **Always points the way: requirements per feature** | V1 | Every feature and agent lists what it needs: components (1.13), OS permissions, accounts (Apple or Google developer, GitHub), API keys, hardware. Checked before it starts, never failing halfway |
| 1.17 | "You need this first" cards | V1 | When something is missing, a card says what, why, how big and how long: "To test on Android you need the Android emulator (about 4 GB, 5 minutes). Install now?" One click for what we can install, a guided step (1.14) for what only the user can do; the task continues on its own once it's ready |
| 1.18 | Alternatives when it can't be done here | V1 | If the laptop can't do it, say so and offer another way: no iOS Simulator on Windows, so test on your iPhone with Expo Go; too weak for a local model, so use an OpenRouter model for about N credits |
| 1.19 | Agents ask too | V1 | Mid-task, an agent that hits a missing piece pauses and shows the same card instead of failing; the request also reaches the web app and chat channels (§9) |
| 1.20 | Setup checklist | V1 | One page with what is ready, what is missing for the features you use, and what is suggested next ("connect Google Search Console to see your search traffic"), each with its button |
| 1.21 | Health check | V1 | Finds what broke (an expired API key, a removed emulator, low disk space, an outdated component) and offers the fix |
| 1.22 | Offline mode | V1 | Local models, tools and data work without internet; online-only features show "Needs internet" cards; a cloud task can switch to a local model (decisions §17) |
| 1.23 | Licence lease and lock screen | V1 | Signed offline licence (14 days); warnings before expiry; the app locks to a sign-in and renew screen when it expires or the subscription ends; tasks pause at a checkpoint; "Export my data" stays available |
| 1.25 | **Free first: the user's instructions on paid services** | V1 | Agents follow what the user says about cost, like any coding agent does: "no paid services" means they use local models, open-source tools, free tiers that allow commercial use, or build it themselves, and say plainly when something truly can't be done for free and what that costs. The default is free first anyway: a paid service is only suggested, with a free alternative next to it, and only connected after the user agrees. A workspace setting ("Avoid paid services") makes it permanent; per task the user can say it in words (decisions §31) |
| 1.24 | Offline queue | V1 | Usage reports, sync, remote results and notifications wait and send when the connection is back |

## 2. Models

| # | Feature | Stage | Notes |
|---|---|---|---|
| 2.1 | Local models with one-click download | V1 | llama.cpp built in (1.15). A full catalogue from tiny (under 1B) to the largest the laptop can run, each marked "runs well", "runs slowly" or "too big" from the hardware check (1.4); downloaded completely, so they work with no internet (1.22). Only models whose licence we've checked (decisions §33) |
| 2.2 | OpenRouter models | V1 | Through our credit proxy or BYOK |
| 2.3 | Model per agent, override per step | V1 | Sensible defaults for beginners |
| 2.4 | Smart routing | V1 | Strong model plans, cheaper model does bulk edits |
| 2.5 | Cost shown before a task runs | V1 | Estimated credits; local runs cost nothing |
| 2.6 | "Too heavy for this laptop" fallback | V1 | Suggests the OpenRouter model and its cost |
| 2.7 | Image, voice and video providers | V1 | Through OpenRouter and our credits: text, images and **video** (OpenRouter's video API since April 2026: Sora 2, Veo 3.1, Seedance, Wan). Free on the laptop: open models such as Wan 2.2 (Apache 2.0) on a strong graphics card; after V1, HunyuanVideo only in countries its licence covers (not the EU, UK or South Korea). Anything else on the user's own account (decisions §31, §33) |
| 2.8 | Compare models side by side | V1 | Same prompt, several models |
| 2.9 | Your own key from a model provider | V1 | Anthropic, OpenAI or Google API keys, used directly next to OpenRouter; kept in the OS keychain |
| 2.10 | No sign-in with chat subscriptions | Decided | Claude Pro or Max, ChatGPT Plus or Pro and similar plans are not used to run our agents (see Not doing). Different from 13.14, where your own installed coding tool runs under its own sign-in |

## 3. Chat and the memory agent

| # | Feature | Stage | Notes |
|---|---|---|---|
| 3.1 | Chat with any model | V1 | |
| 3.2 | Persistent memory | V1 | Facts, preferences, company profile; like Hermes Agent |
| 3.3 | Memory you can see, edit and delete | V1 | "Forget this"; needed for trust and GDPR |
| 3.4 | Memory scopes | V1 | Per company, per agent; the QA agent can't read finance notes |
| 3.5 | Learns how you work: writes its own skills | V1 | After doing a task once, saves how as a skill and reuses it; skills are files you can read, edit and delete |
| 3.6 | Tools through MCP | V1 | Gmail, Calendar, Slack, Notion, Stripe, GitHub, CRMs and so on, each connected as the user through the service's own sign-in. One inbox for Gmail, Outlook, Yahoo, iCloud and company mail, kept on the laptop and never through our servers, so it costs us nothing (decisions §27) |
| 3.7 | **General assistant (Titan)** | V1 | The default agent: has every tool below plus shared memory, does one-off tasks without a dedicated agent, and hands big jobs to the specialists (4.6) |
| 3.8 | Shell and terminal | V1 | Any command; sandboxed. Risky commands ask first, with "allow once" or "always allow this command in this project". A short list always asks, even when allowed before: deleting outside the allowed folders, admin or sudo, formatting disks, touching saved logins (decisions §33) |
| 3.9 | File system | V1 | Read, write, organize, rename and search files, inside the folders you allow |
| 3.10 | Browser control | V1 | Research, forms, downloads, checking sites; the same tool the QA agent, watcher and recorder use. **A core strength:** self-correcting (acts, checks, recovers), on any site or app the user chooses, their own apps included; warnings where a site forbids automation; stops before publish, send or pay (decisions §29) |
| 3.11 | Code execution | V1 | Writes and runs small scripts for one-off jobs (clean data, build an Excel report, edit PDFs) |
| 3.12 | Strong model for long tasks | V1 | Multi-step work with many tools suggests an OpenRouter model; local models are fine for simple tasks |
| 3.13 | **Remembers how it solved things** | V1 | Every finished task keeps a short local record: the goal, the steps, what failed, what worked, the files and sites involved. Agents search these records before starting something similar and reuse what worked; repeated ones become skills (3.5). The user can browse, search and delete them; kept on the laptop only (decisions §32, §34) |
| 3.14 | **Speech** | V1 | Reading text aloud and voice input, as a tool every agent can use. Local first (for example whisper.cpp, MIT, for speech to text, and Kokoro, Apache 2.0, for text to speech; licences checked at phase start); OpenRouter voices through credits as an option (decisions §34) |
| 3.15 | **Run on other machines** | V1 | Besides the laptop's sandbox, containers (6.27) and virtual machines (8.7): **the user's own servers over SSH** (keys in the keychain, the same approvals and always-ask list as 3.8) and **cloud sandboxes** such as Modal, on the user's own account (decisions §31). Each task shows where it runs (decisions §34) |

Example tasks for Titan: sort the downloads folder; build an Excel report from a folder of invoices; reply to supplier emails about delays; find 20 local restaurants without a website and add them to the CRM; convert a folder of videos to MP4.

## 4. Agents and the agent builder

| # | Feature | Stage | Notes |
|---|---|---|---|
| 4.1 | Agent definition file | V1 | Role, models, tools, memory scopes, triggers, approvals |
| 4.2 | Built-in agents (the flagship ones, §5) | V1 | |
| 4.3 | Clone and edit an agent | V1 | |
| 4.4 | Agent builder screen | V1 | A form over the definition file |
| 4.5 | Approvals before anything external | V1 | Publish, send, post, delete always ask |
| 4.6 | Agents working together | V1 | A manager agent hands parts of a task to others |
| 4.7 | Shared memory and a message bus between agents | V1 | |
| 4.8 | Budgets and limits | V1 | Credit cap per task, step limits, loop detection |
| 4.9 | Web content treated as data, never instructions | V1 | Against prompt injection and memory poisoning |
| 4.10 | **Scripts that call Titan's tools** | V1 | For bulk work (500 invoices, 200 pages), the agent writes one script that calls Titan's tools directly (files, browser, search, connectors) through a local tool API, and only the summary returns to the model: faster and much cheaper. The script runs in the sandbox with the same permissions and approvals as the agent; built-in Python (1.15) or Node (decisions §34) |

## 5. Flagship agents

| # | Agent | Stage | How it works |
|---|---|---|---|
| 5.1 | **Website → promo video** | V1 | Reads the site (text, logo, colours, screenshots, a screen recording), writes a script, adds a voiceover (local or cloud TTS), assembles with an open-source video engine (Revideo or Motion Canvas, plus FFmpeg); AI video clips optional (local GPU, or the user's own fal.ai or Replicate account, decisions §31) |
| 5.2 | **Website or app → QA report and tests** | V1 | Explores with Playwright, writes Playwright tests that then run without AI; accessibility (axe-core) and performance (Lighthouse); fixes broken tests with your OK |
| 5.3 | **Prompt → app** | V1 | A web, mobile or desktop app, optionally added to the sidebar; see §6 |
| 5.4 | **Folder agent** | V1 | Questions about your documents, with sources (§7) |
| 5.5 | **Web watcher** | V1 | Checks sources on a schedule, finds what changed, tells you what matters to your company (example: Romanian environmental law) |
| 5.6 | **Recorder** | V1 | Record browser steps, replay them on a schedule (§8) |
| 5.7 | **Code builder** | V1 | A coding agent like OpenCode or Cline, for developers: works in any repo on the laptop, plans, edits, runs tests, commits; see §13 |
| 5.8 | **SEO agent** | V1 | Audits a site, fixes what it can, tracks rankings and writes content; see §14 |
| 5.9 | **Marketing agent** | V1 | Social posts, newsletters, campaigns and a content calendar from the brand kit; see §15 |

## 6. App builder

**One builder, three targets; the user picks one.** Web, desktop and mobile apps share about 80% of the work (understanding the request, planning, writing React and TypeScript, the backend, fixing errors), so there is one App builder agent on the shared coding engine (§13), not three separate agents. When starting a project the user picks **what** to build: a web app, a mobile app or a desktop app, and only that is built. Each target brings a **target kit**: its starter template, preview, checks, rules and publishing steps, plus specialist sub-agents for the parts only that target has. Adding a second target later is optional (6.6).

### How a build runs (Lovable's loop, done locally)

1. **Plan:** a strong model turns the prompt into a plan, pages, data model and tasks; you see and can change the plan.
2. **Build:** sub-agents write the code, each with its own context; cheaper models take the simple work.
3. **Run:** the preview runs on the laptop, so previews cost us nothing (Lovable and Bolt pay for cloud sandboxes).
4. **Check:** typecheck, build, the app's tests, and the QA agent (5.2) clicking through the app in local browsers, emulators or a virtual machine (see "Testing on the laptop").
5. **Fix:** errors and logs go back to the agents until the checks pass or the budget (4.8) runs out.
6. **Hand over:** a summary of what changed, a new version (6.13), and the preview.

### Target kits

| # | Feature | Stage | Notes |
|---|---|---|---|
| 6.1 | **Web**: websites and web apps | V1 | React, TypeScript, Tailwind, shadcn/ui; the backend in the **user's own** Convex account (connected with a guided setup), or a local database for apps that stay on the laptop; local dev server for the preview (decisions §32) |
| 6.2 | **Option: add to the Titan117 sidebar** (internal apps: CRM, inventory, invoices) | V1 | Off by default; a choice when creating a web app, or later. Adds the `titan` SDK (db, ai, auth, agent), runs sandboxed, and joins the shared data layer (6.11); otherwise the app is a normal standalone project |
| 6.3 | **Mobile**: iOS and Android | V1 | React Native and Expo; preview in the browser (react-native-web), on a phone by QR code in Expo Go, or in a simulator (iOS only on a Mac) |
| 6.4 | **Desktop**: Windows and macOS apps | V1 | Tauri template; runs locally as its preview; builds installers |
| 6.5 | Target specialists | V1 | Sub-agents per target: mobile (native modules, permissions, store rules), desktop (packaging, auto-update, signing), web (SEO §14, deploy) |
| 6.6 | Option: add another target later | V1 | Only if the user asks, for example a mobile app next to an existing web admin panel; both share one backend and their logic, each has its own UI |

### Builder features

| # | Feature | Stage | Notes |
|---|---|---|---|
| 6.7 | Plan you approve before building | V1 | |
| 6.8 | Templates and a design system per project | V1 | Starting points per target and per business type; the brand kit (15.1) applied |
| 6.9 | Visual edit | V1 | Click an element in the preview and describe the change |
| 6.10 | Model roles and escalation | V1 | See "Models in the builder" below |
| 6.11 | One shared data layer for sidebar apps | V1 | Only for apps added to the sidebar (6.2); lets the agent answer across them |
| 6.12 | Local database per app, optional sync | V1 | Sync between the user's own devices and team members goes through our cloud **end to end encrypted**, so we can't read it (decisions §32) |
| 6.13 | Versions and one-click rollback | V1 | |
| 6.14 | Agents maintain and fix apps | V1 | |
| 6.15 | Publish web | V1 | One-click deploy and custom domain, to the user's own Vercel, Netlify or Cloudflare account, connected as the user with a guided setup; they own and pay for their hosting (decisions §30) |
| 6.16 | Publish mobile | V1 | Expo EAS builds in the user's own Expo account, and store submission; the user needs their own Apple and Google developer accounts; Android builds can also run locally, iOS builds need a Mac or EAS |
| 6.17 | Publish desktop | V1 | Signed installers and auto-update; signing needs the user's Apple developer account and a Windows certificate |
| 6.18 | Export code to GitHub | V1 | No lock-in; to the user's own GitHub, as the user (decisions §25) |
| 6.19 | Built on open-source builders | V1 | Code work by the shared engine (§13); bolt.diy, Dyad, open-lovable and Convex Chef to study for the builder screens, templates and loop; check each licence |

### Testing on the laptop

Apps are tested on the user's own machine, in real browsers, emulators and virtual machines. Cloud device farms (BrowserStack, Sauce Labs) charge per minute; here testing is free and the app's data never leaves the laptop. The QA agent (5.2) drives all of it.

| # | Feature | Stage | Notes |
|---|---|---|---|
| 6.20 | Web: three browser engines | V1 | Chromium, Firefox and WebKit (close to Safari, also on Windows) through Playwright |
| 6.21 | Web: screen sizes and conditions | V1 | Phone, tablet and desktop sizes; slow network, offline, dark mode, another language |
| 6.22 | Mobile: Android emulator | V1 | On Windows, macOS and Linux; needs hardware virtualization and several GB of disk |
| 6.23 | Mobile: iOS Simulator | V1 | macOS only (Xcode); on Windows, iOS is tested on a real iPhone through Expo Go |
| 6.24 | Mobile: real phone | V1 | Expo Go by QR code, on the same Wi-Fi |
| 6.25 | Mobile: automated taps and checks | V1 | Tests that tap through the app in the emulator (for example with Maestro or Appium, licences to check) |
| 6.26 | Desktop: a clean virtual machine | V1 | Install and run the app on a fresh Windows or macOS (Windows Sandbox or Hyper-V on Windows; UTM or Tart on Mac) to catch "works only on my machine" problems |
| 6.27 | Backend in containers | V1 | Databases and services the app needs, started locally (Docker or Podman) and thrown away after the test |
| 6.28 | One-click setup | V1 | Titan117 downloads and sets up emulators and tools on first use, after the hardware check (1.4) says the laptop can run them |
| 6.29 | Test report | V1 | Screenshots per device, failures with steps to repeat them, fixed automatically when you agree |
| 6.30 | Cloud devices as a fallback | V1 | Real iPhones and other devices through a device farm, for users whose laptop can't run emulators; in the user's own device-farm account, since farms' terms forbid reselling access ([external services](external-services.md)) |

### Models in the builder

Like Lovable, the builder uses several models, each for the job it does best; lighter work goes to faster, cheaper models.

| Role | What it does | Default kind of model |
|---|---|---|
| Planner | Plan, data model, architecture | Strongest available |
| Coder | Writes most of the code | Strong and cheap: Qwen Coder, DeepSeek, GLM, Kimi, MiniMax |
| Quick edits | Small changes, applying diffs | Small and fast, or local |
| Fixer | Debugs when checks fail | Strong; called only on failure |
| Checker | Looks at screenshots of the preview | A vision model |
| Chat and summaries | Talks to you, names things, summarizes | Cheap or local |

- **Escalation:** start with the cheap model; after repeated failures on a task, move up to a stronger one.
- **Chosen by our own tests:** a fixed set of app prompts per target, run against candidate models, decides the defaults (public benchmarks aren't enough). Rerun when new models come out.
- **Users can override** any role (2.3).
- **Chinese open models** (Qwen, DeepSeek, GLM, Kimi, MiniMax) cost a fraction of the top Western models per token, which lets us charge less than Lovable or keep a better margin. Rules: pick OpenRouter providers by data policy (US or EU hosts, no training on data) where company data is involved; let companies turn these models off; check their tool use on long tasks in our tests before making them a default.

## 7. Documents (folder agent)

| # | Feature | Stage | Notes |
|---|---|---|---|
| 7.1 | Watched folders, one or more per company | V1 | New and changed files picked up automatically |
| 7.2 | Reads PDF, Word, Excel, PowerPoint, email | V1 | Docling or MarkItDown |
| 7.3 | OCR for scans | V1 | |
| 7.4 | Local search: vectors plus keywords | V1 | Multilingual embeddings (Romanian and English), sqlite-vec or LanceDB |
| 7.5 | Answers with file, page and passage | V1 | |
| 7.6 | Real calculations on spreadsheets | V1 | Computed, not guessed |
| 7.7 | "Local models only" folders | V1 | For confidential files |
| 7.8 | Read-only by default | V1 | |

## 8. Automation

| # | Feature | Stage | Notes |
|---|---|---|---|
| 8.1 | Scheduler | V1 | Runs while the app is open, catches up on launch |
| 8.2 | Record browser actions | V1 | Built on Playwright's recorder |
| 8.3 | Edit steps and add variables | V1 | |
| 8.4 | AI fixes a broken step, with your OK | V1 | |
| 8.5 | Logins from the OS keychain, pause for 2FA | V1 | Never stored in the recording |
| 8.6 | Recording in other desktop apps | V1 | Much harder than the browser |
| 8.7 | Computer use inside a virtual machine | V1 | The agent sees the screen and uses mouse and keyboard, but in a VM or emulator, not on your desktop: it works in the background, you keep using your computer, and a mistake can't touch your files. First use: testing desktop apps we build (6.26) and apps without an API. Reads the accessibility tree first (Windows UI Automation, macOS Accessibility), screenshots when that isn't enough |
| 8.8 | Computer use on your own desktop | V1 | Any desktop app (Excel, accounting software). Only when you start it, for one task at a time, limited to the apps you allow; a visible "agent is in control" bar, a hotkey that stops it at once, approvals for anything risky; needs the OS permissions (Accessibility and Screen Recording on macOS). Your mouse and keyboard are taken while it works |
| 8.9 | Building blocks for computer use | V1 | Vision models through OpenRouter or local; UI-TARS (ByteDance, open model and desktop agent, licence to check) and nut.js (Apache 2.0) to study; Open Interpreter is AGPL, so ideas only |
| 8.10 | **Schedules in plain words** | V1 | "Every weekday at 8, brief me on new emails and the law watcher" becomes a schedule the user sees and edits (time, what runs, where the result goes: laptop, phone, chat). Runs unattended while the app is open and catches up on the next launch (8.1); reports, backups and briefings as ready-made examples (decisions §34) |

## 9. Web app and remote control

| # | Feature | Stage | Notes |
|---|---|---|---|
| 9.1 | Account, subscription and credits pages | V1 | |
| 9.2 | Device list, paired by code or QR | V1 | Online or offline status |
| 9.3 | Start and watch agents from the browser | V1 | Commands through Convex; the desktop only connects out |
| 9.4 | Approvals from the web | V1 | |
| 9.5 | End-to-end encryption of commands and results | V1 | Our servers pass along what they can't read. Device keys made on each device, pairing confirmed by a matching code on the laptop, keys rotated when a device is removed (architecture, security.md A2) |
| 9.6 | Mobile app on the same mechanism | V1 | |
| 9.7 | Chat channels: Telegram, WhatsApp, Discord, Slack | V1 | Message Titan from your phone and the laptop does the work while it's on; channels linked to an account, approvals work there too. Telegram first (decisions §14); WhatsApp is bring-your-own through the official Cloud API (decisions §15). Linked with a one-time code; private chats only in V1. The user's own bot, made in a minute with a guided card and connected straight from the laptop; nothing passes through our servers (decisions §28) |
| 9.8 | **Safe remote control, easily** | V1 | Off by default; switched on per laptop in the desktop app; two-factor required to switch it on (a passkey suggested first, part of the setup checklist); pairing confirmed on the laptop (decisions §23) |
| 9.9 | Laptop-only approvals | V1 | Deleting, payments, sending files or data out, installing add-ons, changing permissions and pairing are approved on the laptop, or remotely after a second factor if the user chooses |
| 9.10 | Alerts and revoke all | V1 | A quiet alert on every device when a remote task starts; "Revoke all devices" from the web app, the desktop app or the alert email |
| 9.11 | The web and phone apps do everything chat does | V1 | Start, watch, approve, cancel, read results, add a file: chat channels are a convenience, never the only way |

## 10. Marketplace (free, built on GitHub)

| # | Feature | Stage | Notes |
|---|---|---|---|
| 10.1 | `titan.json` manifest in a repo | V1 | Type, entry point, permissions |
| 10.2 | Item types | V1 | Agents, workflows, app templates, MCP tools, prompts and skills |
| 10.3 | Index found through a GitHub topic | V1 | Stars, licence, last update, installs, ratings; code stays on GitHub |
| 10.4 | Install pinned to a commit, updates with a changelog | V1 | |
| 10.5 | Install any open-source project | V1 | The agent reads the repo and proposes setup steps for your OK |
| 10.6 | Fork and publish back to your GitHub | V1 | As the user: Sign in with GitHub (our GitHub App's device flow, user access token in the keychain); shows as the user's own fork and pull request (decisions §25) |
| 10.7 | Permissions screen before install | V1 | |
| 10.8 | Sandbox, dependency scan, agent code summary | V1 | |
| 10.9 | Licence shown and warned about | V1 | MIT and Apache fine; GPL and AGPL warn; none or non-commercial warn strongly |
| 10.10 | Verified badge, reports, takedown | V1 | |
| 10.11 | GitLab, Codeberg, Gitea; Hugging Face for models | V1 | |

## 11. Accounts, plans and credits (our cloud)

| # | Feature | Stage | Notes |
|---|---|---|---|
| 11.1 | Sign-in | V1 | Clerk |
| 11.2 | Subscription plans | V1 | Starter €15, Pro €25, Max €50, Custom; no free plan ([pricing](pricing.md), decisions §13) |
| 11.3 | Credit ledger and top-ups | V1 | In Convex, atomic deductions |
| 11.4 | OpenRouter proxy with metering | V1 | A streaming route on Vercel holds our one secret key; Convex keeps the ledger and the rules (decisions §12). OpenRouter confirmed this model is allowed (8 Nov 2026) |
| 11.5 | BYOK | V1 | Key kept on the device, in the OS keychain |
| 11.6 | Teams, roles, audit log | V1 | Agents, apps and data shared between team members' laptops go through our cloud end to end encrypted to each member's devices; we see who is in the team, never what they share (decisions §32) |
| 11.7 | Agency and white-label plan | V1 | |
| 11.8 | **Product owner portal** | V1 | Our own admin app in its own repo (`titan117-pop`) at its own address, for the owner and employees: error reports (§19), accounts and plans, credit corrections, kill switches, releases; two-factor required; every view logged (decisions §23) |

## 12. Trust and security (across everything)

- Safe defaults where general agents like OpenClaw are risky: a sandboxed shell with approval for risky commands (3.8), file access only to allowed folders (3.9), and checked skills and marketplace items (10.7, 10.8) instead of installing strangers' skills blindly.
- Approvals before external actions (4.5), budgets (4.8), web content as data (4.9).
- Messages from chat channels count as the user only from linked accounts (9.7).
- Permissions for apps and marketplace items (6.2, 10.7), sandboxing (10.8).
- Memory you control (3.3), memory scopes (3.4), "local models only" folders (7.7).
- Secrets in the OS keychain, never in files, recordings or memory (8.5, 11.5).
- Account deletion and GDPR: to write up, like Ninjathons' decisions §4.
- A network policy per task: site lists, asking before a new site once private data was read, blocking requests that carry private content (security.md A3).
- The full threat model, in two parts (protecting users, protecting us), accepted risks, vulnerability reporting and the incident checklist: [security.md](../security.md).

## 13. Code builder and the shared coding engine

One coding engine runs inside the desktop app and powers every agent that writes code: the code builder (5.7), the app builder (§6), web, mobile and desktop apps (6.1, 6.3, 6.4), and Titan's one-off scripts (3.11). That engine is **OpenCode** (MIT), pinned and behind our own adapter (decisions §12).

| # | Feature | Stage | Notes |
|---|---|---|---|
| 13.1 | Open any local repo or folder | V1 | |
| 13.2 | Plan mode, then act mode | V1 | Shows the plan and the files it will touch before editing |
| 13.3 | Edits as diffs you can review, accept or reject | V1 | |
| 13.4 | Runs commands, tests and the dev server | V1 | Through the sandboxed shell (3.8) |
| 13.5 | Approvals routed to Titan117's approval screen | V1 | The engine's permission prompts become our approvals (4.5), also from the web and chat channels |
| 13.6 | Any model: local or OpenRouter | V1 | Same model choice as everywhere else (§2) |
| 13.7 | Git: branches, commits, pull requests | V1 | As the user: their own git setup for commits (with a `Co-authored-by` Titan117 trailer), their GitHub sign-in (10.6) for pull requests; pushes and pull requests need approval (decisions §25) |
| 13.8 | Project memory | V1 | Conventions and decisions per repo, in the shared memory (3.4) |
| 13.9 | Sub-agents for big tasks | V1 | Orchestrator splits work: plan, code, test, review |
| 13.10 | Code review agent | V1 | Reviews a diff or pull request for bugs |
| 13.11 | Live preview next to the code | V1 | For web apps; shared with the app builder |
| 13.12 | Open in the user's editor | V1 | VS Code, Cursor, JetBrains |
| 13.13 | Start and watch coding tasks remotely | V1 | Web app (§9) and chat channels (9.7) |
| 13.14 | **Use the coding tools you already have** | V1 | An option the user picks per project or task ("Titan117's engine" or one of their tools), like T3 Code: no keys resold, no quota caps, switch models mid-conversation. If Claude Code, Codex, Cursor (its agent or SDK), OpenCode, Grok CLI or Antigravity is installed and signed in on the laptop, the code builder and app builder can hand a coding task to it instead of our engine. Titan117 starts the vendor's own, unmodified program; you sign in through the vendor's own flow; usage stays on your plan. Rules in decisions §20 |

## 14. SEO

Our advantage: we build the sites (§6), so they come with SEO built in, and the SEO agent can fix issues itself instead of only listing them. For any other site it audits and suggests.

| # | Feature | Stage | Notes |
|---|---|---|---|
| 14.1 | Built into every site we generate | V1 | Titles, meta descriptions, headings, sitemap, robots.txt, canonical links, Open Graph images, structured data (schema.org), alt text, fast pages |
| 14.2 | Site audit | V1 | Crawl: broken links, redirects and loops, missing or duplicate meta tags, heading order, thin pages, missing alt text; issues by severity. Ideas from SEOnaut, SiteOne Crawler, LibreCrawl (all MIT) |
| 14.3 | Speed and Core Web Vitals across the whole site | V1 | Lighthouse on every page, like Unlighthouse (MIT); shared with the QA agent (5.2) |
| 14.4b | SEO skill for code | V1 | The code builder audits a codebase for SEO and fixes it in the code (titles, meta tags, sitemap, structured data, speed), as a skill the user can call, like skills in Claude Code (decisions §33) |
| 14.4 | Fix it for me | V1 | On our sites the agent makes the fix through the coding engine (§13); on other repos it opens a pull request |
| 14.5 | Google Search Console | V1 | Free, official data: queries, clicks, impressions, indexing problems; needs our Google sign-in app verified ([external services](external-services.md)) |
| 14.6 | Rank tracking | V1 | Ideas from SerpBear (MIT); positions from Search Console for free, or a SERP API on the user's own account (decisions §31) |
| 14.7 | Keyword research | V1 | Needs paid data (no open keyword database exists): a provider like DataForSEO, on the user's own account with a guided setup (decisions §31) |
| 14.8 | SEO content writing | V1 | Pages and blog posts from keywords and the brand kit, with internal links; you approve before publishing |
| 14.9 | Competitor check | V1 | Crawls competitors' public pages: topics, structure, gaps |
| 14.10 | Several languages | V1 | Romanian and English versions with hreflang |
| 14.11 | Local SEO | V1 | Google Business Profile, local listings, reviews. The Business Profile API is allowlist-only (an application to Google); until approved, a guided checklist ([external services](external-services.md)) |
| 14.12 | AI search visibility | V1 | Whether ChatGPT, Perplexity and Google's AI answers mention the company, checked through the providers' APIs, never their websites; llms.txt |
| 14.13 | Scheduled re-audits with a report | V1 | Weekly, through the scheduler (8.1) |

Out of reach with open source: backlink databases, competitors' traffic estimates and ranking history (Ahrefs, Semrush). If needed, they come from a paid API on the user's own account.

## 15. Marketing

| # | Feature | Stage | Notes |
|---|---|---|---|
| 15.1 | Brand kit in memory | V1 | Logo, colours, fonts, tone of voice, products, audience; read from the website and edited by you; every marketing agent uses it |
| 15.2 | Social posts | V1 | Text, images and video for LinkedIn, Facebook, Instagram, X, TikTok, published by the user in a click (15.4); ideas from Postiz (AGPL, so ideas only). No platform posting APIs in V1 (decisions §24) |
| 15.3 | Content calendar | V1 | A month of posts planned from goals, launches and holidays |
| 15.4 | **Ready to post** (no platform approvals needed) | V1 | each post comes as a ready-to-post package (text, hashtags, images or video sized for the platform); **Copy and open** copies the text and opens the platform's own post screen (LinkedIn and X pre-fill the text); **Time to post** reminders from the content calendar on the laptop and phone, where one tap opens the phone's share sheet with the media attached (Instagram, TikTok, Facebook); export the calendar (.ics) and a CSV for the platforms' own free schedulers such as Meta Business Suite. Nothing posts automatically. As the user's choice, the agent can also fill in the platform's website after a warning that its terms forbid automation, stopping before Post (decisions §29) |
| 15.4b | Automatic scheduled publishing through the platforms' APIs | After V1 | Needs each platform's app review (Meta for Facebook and Instagram, TikTok, LinkedIn) and X's paid API; start Meta business verification and the legal pages early (decisions §24) |
| 15.5 | Newsletters | V1 | Ideas from Listmonk (AGPL, ideas only); sent through the user's own email provider account (Brevo, Amazon SES, Mailgun, Postmark), which also handles scheduled sends; checks SPF, DKIM, DMARC and one-click unsubscribe before the first send (Gmail and Yahoo require them); GDPR consent per list |
| 15.6 | Email sequences and lead scoring | V1 | Ideas from Mautic (GPL, ideas only) |
| 15.7 | Landing pages | V1 | Built by the app builder (§6), with SEO (§14) and a form that feeds the CRM |
| 15.8 | Images for posts and ads | V1 | Image models through OpenRouter or local, on the brand kit |
| 15.9 | Videos | V1 | The promo video agent (5.1), cut to each platform's format |
| 15.10 | Website analytics | V1 | Privacy-friendly analytics built into sites we generate (ideas from Umami, MIT; Plausible is AGPL), stored in the site's own backend in the user's account, never in our cloud; reads Google Analytics for other sites, as the user (decisions §32) |
| 15.11 | Campaign reports | V1 | What was posted and sent, and what it brought: clicks, sign-ups, leads |
| 15.12 | Lead finding | V1 | Web research into a list in the CRM, for example local businesses without a website; respects site terms and privacy law (GDPR) |
| 15.13 | Ad drafts | V1 | Google and Meta ads written, with images and targeting; you launch them and set the budget. Ready-to-use ads plus a bulk-upload file for Google's and Meta's import tools; or the user's own developer access; or, as the user's choice after a warning, the agent fills in Ads Manager and stops before Launch (decisions §28, §29) |
| 15.14 | Review and mention monitoring | V1 | Through the web watcher (5.5) |
| 15.15 | **Video studio** | V1 | Our own studio for AI video: text and image to video, camera-motion presets, effects, and a timeline editor, in our own design and names (the same kinds of tools as Higgsfield, not a copy of it). Models through credits (OpenRouter video) or locally (Wan 2.2); the editor built on OpenCut (MIT), animated graphics on Revideo or Motion Canvas (MIT) (decisions §33) |

Everything that publishes, sends or spends money needs your approval (4.5). In V1 the user publishes social posts themselves in a click (15.4), so no platform has to approve our app; automatic publishing comes after V1 (decisions §24). WhatsApp, as a chat channel, stays bring-your-own (decisions §15).

## 16. Web search

One web search tool that every agent can call during a task. Searching finds links; a second step reads the pages. The user picks where search comes from, like with models.

| # | Feature | Stage | Notes |
|---|---|---|---|
| 16.1 | Search tool for all agents | V1 | The model decides when to search, how often, and what to read next |
| 16.2 | **Default** search source: a paid search API through our credits | V1 | OpenRouter's web search server tool (native search for some models, Exa for the rest, about 2 cents a search), or Brave Search's API. Its old `:online` suffix and web plugin are deprecated |
| 16.3 | Search source: the user's own key | V1 | Brave Search, Tavily, Exa, Serper |
| 16.4 | Search in the browser, on the user's request | V1 | Replaces the old free mode (no background scraping of search engines). When the user asks, the browser agent searches in a visible browser at a human pace, like a person would; search engines are on the "forbids automation" warning list; a CAPTCHA stops it and hands over to the user (decisions §29, §30) |
| 16.5 | Read a page | V1 | Fetch it and turn it into clean text: Mozilla Readability and Trafilatura (both Apache 2.0) for most pages; our browser tool (3.10) for pages that need JavaScript |
| 16.6 | Read a whole site | V1 | Crawl a site into clean text; ideas and maybe code from Crawl4AI (to check: Apache 2.0); Firecrawl is AGPL, so ideas only |
| 16.7 | Answers with sources | V1 | Every fact from the web shows its link |
| 16.8 | Deep research mode | V1 | Many searches, reading, cross-checking, then a report with sources; ideas from Perplexica (licence to check) |
| 16.9 | Trusted source lists | V1 | Pin or block sites per agent, for example only official legal sources for the law watcher (5.5) |
| 16.10 | Search in the user's language and country | V1 | Romanian results for Romanian questions |
| 16.11 | Cache | V1 | The same search or page within a short time isn't fetched or paid for twice |
| 16.12 | Cost shown, budget respected | V1 | Searches through credits count towards the task budget (4.8) |

Rules: web pages are data, never instructions (4.9); respect robots.txt and site terms; no CAPTCHA bypassing; no scraping Google's results pages directly.

## 17. Artifacts: what agents make for you to see and share

Like Claude's artifacts: when an agent produces something to look at, use or share, it opens as a live page next to the chat instead of a wall of text. Reports from other agents (QA 6.29, SEO 14.13, deep research 16.8, campaign reports 15.11, folder answers §7) are artifacts too. One consistent way to show results across the whole app. Typical asks: "make an offer for this client", "a report on last month's sales", "a presentation for Monday": ready in your brand, exportable or shareable in one click.

| # | Feature | Stage | Notes |
|---|---|---|---|
| 17.1 | Artifact panel next to the chat | V1 | Opens beside the conversation; full screen; a gallery of all artifacts per company and project |
| 17.2 | Documents | V1 | Reports, proposals, offers, contract drafts, SOPs, one-pagers; rich text with headings, tables and images |
| 17.3 | Web pages and small interactive tools | V1 | HTML, CSS and JavaScript: calculators, forms, checklists, dashboards, prototypes; run sandboxed |
| 17.4 | Charts and dashboards from data | V1 | From a spreadsheet, a sidebar app's data or an agent's results; live, not pictures |
| 17.5 | Diagrams | V1 | Flowcharts, org charts, timelines, architecture; Mermaid (MIT) |
| 17.6 | Slides | V1 | Decks for clients or the team; reveal.js or Marp (both MIT) to study |
| 17.7 | Spreadsheets | V1 | Tables you can sort, filter and edit; download as Excel |
| 17.8 | **Download in any format** | V1 | A Download button on every artifact with every format that makes sense for its type (table below); see "Downloads" |
| 17.9 | Edit by asking or by hand | V1 | "Make the intro shorter" or type into it yourself; the agent sees your edits |
| 17.10 | Versions | V1 | Every change is a version; compare and restore |
| 17.11 | Brand kit applied | V1 | Logo, colours and fonts from 15.1 on documents, slides and pages |
| 17.12 | Templates | V1 | Offer, invoice, monthly report, meeting notes, project plan; shareable in the marketplace (§10) |
| 17.13 | Share with a link | V1 | Optional: publish to our cloud as a private link (we host it, so an abuse report button and a takedown process, as the EU Digital Services Act expects), then share with chosen people or anyone with the link; storage counts towards the plan; off by default, everything stays local until you share |
| 17.14 | Comments | V1 | People you share with can comment; an agent can answer or apply a comment |
| 17.15 | Live data | V1 | An artifact can read from a sidebar app or the documents index (with your permission), so a dashboard stays up to date |
| 17.16 | Turn an artifact into an app | V1 | A useful tool or dashboard becomes a real project in the app builder (§6), optionally in the sidebar |
| 17.17 | Scheduled artifacts | V1 | "Every Monday, update the sales report" through the scheduler (8.1) |
| 17.18 | Safety | V1 | Runs in a sandbox with no access to files, memory or the network unless allowed; scripts only from approved sources; shared pages never contain secrets |

### Downloads

Every artifact can be downloaded in the formats that fit it, from a Download button that's always there, unlike Claude Code today.

| Artifact type | Formats |
|---|---|
| Document | PDF, Word (.docx), Google Docs, Markdown, HTML, plain text |
| Web page or small tool | A single self-contained HTML file that works offline, PDF (a snapshot), PNG, a ZIP of the source code |
| Chart or dashboard | PNG, SVG, PDF, the data as Excel or CSV |
| Diagram | SVG, PNG, PDF, the Mermaid source |
| Slides | PowerPoint (.pptx), PDF, Google Slides, images per slide |
| Spreadsheet | Excel (.xlsx), CSV, Google Sheets, PDF |
| Any | Copy to clipboard; save straight into a folder (for example the company's folder in §7) |

| # | Feature | Stage | Notes |
|---|---|---|---|
| 17.19 | Real, editable files | V1 | Word files with real headings, styles and tables; PowerPoint with editable text boxes, not pictures of slides; Excel with real cells and formulas |
| 17.20 | Download options | V1 | Page size (A4 or Letter), margins, light or dark, include comments or not, file name from the title |
| 17.21 | Several at once | V1 | Pick artifacts in the gallery and download them as one ZIP |
| 17.22 | Batch versions | V1 | Download an older version, or the same artifact in several formats in one go |
| 17.23 | Conversion runs locally | V1 | No upload needed: PDF through the built-in browser's print (Playwright), Word through docx (MIT), PowerPoint through pptxgenjs (MIT), Excel through ExcelJS (MIT), diagrams through Mermaid (MIT). Pandoc is GPL, so not built in |
| 17.24 | Agents can save files too | V1 | "Save the offer as PDF in the Client X folder" works as a task, with no clicks |
| 17.25 | Google Docs, Sheets and Slides | V1 | Through the user's Google account (MCP, 3.6) |

## 18. Growing the app (it evolves without touching its core)

Titan117 is built like an operating system: a **fixed core** we sign and update (the engine, the permission and approval layer, model routing, credits, licence, sync) and **everything above it** that users and Titan can add to, change and remove (agents, skills, tools, sidebar apps, automations). When someone needs something we didn't build, Titan builds it on top, as an add-on. No agent ever edits the core (decisions §21).

| # | Feature | Stage | Notes |
|---|---|---|---|
| 18.1 | **Ask Titan for what's missing** | V1 | "I need an agent that…", "connect to our invoicing software", "a screen to track X": Titan plans the add-on, shows what it will create and what it may access, and builds it after your OK |
| 18.2 | Agents and skills on request | V1 | Titan writes a new agent definition (4.1) and the skills it needs (3.5); it appears in the sidebar under a team you pick |
| 18.3 | Tools on request | V1 | A small connector (an MCP tool, 3.6) for software we don't support, written by the coding engine (§13), with declared permissions |
| 18.4 | Sidebar apps on request | V1 | A screen built by the app builder and added to the sidebar with the `titan` SDK (6.2) |
| 18.5 | Add-ons are sandboxed packages | V1 | Every add-on has a `titan.json` manifest (10.1) listing its permissions; it runs in the sandbox (10.8) and goes through the same permissions screen as a marketplace item (10.7); versions and one-click rollback |
| 18.6 | Share what you built | V1 | Publish an add-on to the marketplace (10.6); other companies install it with the same checks |
| 18.7 | **Safe mode** | V1 | If the app fails to start or keeps failing after an add-on changed, it starts with add-ons off and offers to roll back or remove the one that broke it |
| 18.8 | The core is off-limits | V1 | Agents and add-ons can't write to the app's own files, its settings for permissions, credits or licence, or its update channel (guardrails §4) |
| 18.9 | Core fixes come from us | V1 | When the problem is in the core, Titan writes up what went wrong, and optionally a suggested fix, for an error report (19.6); we review it and ship the fix to everyone through auto-update (1.10) |

## 19. Error reports

When something breaks, the user can send us a report in one click, and we see it, grouped, in our product owner portal. Opt-in, shown in full before sending, never with the user's files, prompts or keys (decisions §22).

| # | Feature | Stage | Notes |
|---|---|---|---|
| 19.1 | Catch every error | V1 | App crashes (Electron's crash reporter), engine and agent errors, add-on errors, failed tasks; written to a local, redacted log |
| 19.2 | "Something went wrong" card | V1 | After a crash or failed task: what happened in plain words, "Send a report?", and **the full report shown before it leaves the laptop** |
| 19.3 | Report a problem | V1 | A Help menu button for things that aren't crashes ("the app builder got stuck"), with a note and an optional screenshot |
| 19.4 | What a report holds | V1 | App and component versions, OS, the agent or feature, the error and stack trace, the last log lines (redacted), the user's note. **Never** file contents, prompts, memory, keys, passwords or tokens; prompts and files only if the user ticks a box for that one report; nothing from "local models only" folders |
| 19.5 | Reference ID and follow-up | V1 | Each report gets an ID (for example `T117-4F2A`); the app later shows "Fixed in 1.4, update now?" for errors linked to a release |
| 19.6 | Suggested fix | V1 | Optionally attached by Titan with the user's consent (18.9) |
| 19.7 | Setting | V1 | Always ask (default), send automatically, or never; changeable any time |
| 19.8 | Offline | V1 | Reports wait in the offline queue (1.24) and send when the connection is back |
| 19.9 | Product owner portal | V1 | For us: errors grouped by signature with counts, versions, OS and first/last seen; open a report; link a group to an issue and the release that fixes it; alerts on new or spiking errors |
| 19.10 | Add-ons' errors | V1 | Go to the user, not to us, unless the add-on's author opts in through the marketplace |
| 19.11 | Retention | V1 | Reports kept 90 days, deleted with the account (decisions §11) |

## Not doing

- Hosted agents that keep running when the laptop is closed. A paid cloud runner could come much later, but it isn't the product.
- Bypassing CAPTCHAs, paywalls, logins or bot detection anywhere. Where a site's terms forbid automation, the user decides after a warning (decisions §29).
- Agents changing the app's own code or core settings on the user's computer (18.8). The app grows through add-ons; the core changes only through our signed updates.
- Hidden telemetry. Error reports are opt-in and shown in full before sending (§19).
- Signing in with chat subscriptions (Claude Pro or Max, ChatGPT Plus or Pro, Gemini plans) to run our agents. Anthropic's terms have banned this outside its own apps since February 2026 and it blocks such tools, and users' accounts can be banned. OpenAI's position is unclear. Users bring an API key instead (2.9). Revisit only if a provider officially allows it for third-party apps. This is not the same as 13.14: there, Titan117 starts the vendor's own unmodified tool that you installed and signed into yourself, and never sees your login.

## Open decisions

Settled decisions live in [decisions.md](decisions.md) (Electron, Node, Stripe directly, OpenCode, our credit proxy, OpenRouter search, prices, small companies first on Windows and macOS, Telegram first, all of this map in V1, three repos, shared docs, GitHub as the user). Still open, with the phase that needs the answer:

| # | Open decision | Needed by | Leaning |
|---|---|---|---|
| 1 | ~~Shell commands~~ | Decided | Any command, sandboxed; risky ones ask with "allow once" or "always"; a short list always asks (decisions §33) |
| 2 | ~~Local models~~ | Decided | A full catalogue by hardware, tiny to large, all downloadable for offline use; licences checked (decisions §33) |
| 3 | ~~GitHub owner~~ | Decided | The EcotechCore organisation owns `titan117-web`, `titan117-desktop` and `titan117-pop` (decisions §6) |
| 4 | ~~Open-source bases~~ | Decided | Compare the best candidates at each phase start and take the best MIT, Apache or BSD code (decisions §33) |
| 5 | ~~SEO data~~ | Decided | Free and open-source first (Search Console, our own crawler); paid data only on the user's account; an SEO skill for code (decisions §33) |
| 6 | ~~Video provider~~ | Decided | OpenRouter video through credits; Wan 2.2 locally; a video studio of our own (decisions §33) |
| 7 | ~~Running other coding tools~~ | Decided | The T3 Code model as a user option; a quick terms confirmation per tool in phase 7 (decisions §33) |
| 8 | ~~Trademark~~ | Decided | Keep "Titan117 by EcotechCore"; no "Titan117" mark exists, but "Titan" is crowded in software, so file our own EU trademark before launch (decisions §33) |
| 9 | ~~Legal pages~~ | Decided | Drafted comprehensively in phase 2, reviewed once by a Romanian lawyer before launch (decisions §33) |
| 10 | ~~OpenRouter's OK for our credits~~ | Decided | Confirmed by OpenRouter on 8 Nov 2026 (decisions §12) |
| 11 | ~~One resale rule~~ | Decided | Only OpenRouter goes through credits; every other paid service is the user's own account, with a guided setup (decisions §31) |
| 12 | ~~Chat channels: whose bot~~ | Decided | The user's own bot with a guided setup, connected straight from the laptop (decisions §28) |
| 13 | ~~Gmail and the yearly security assessment~~ | Decided | Mail stays on the laptop; IMAP fallback (decisions §27) |
| 14 | ~~Ads as drafts~~ | Decided | Import files by default; the user's own developer access as an option (decisions §28) |
| 15 | ~~Free web search mode~~ | Decided | Dropped; search through credits, the user's own key, or the browser on the user's request (decisions §30) |
| 16 | ~~Whose hosting for published sites~~ | Decided | The user's own hosting account; share links stay ours with a report button and takedown process (decisions §30) |

---

## All features in short

**1. Desktop app**
- Plug and play: one signed installer with everything the core needs; a setup wizard; heavy parts (models, emulators, VMs) download on demand
- Always points the way: before anything runs it checks what is needed and shows "you need this first" cards with one-click installs, guided steps or another way; a setup checklist and a health check
- Windows and macOS app, signed in with the Titan117 account
- Sidebar with agents, apps, chats and the marketplace
- Hardware check that suggests which local models fit
- Stays awake while a task runs; resumes after sleep or a crash
- Local database, activity timeline, notifications, auto-update

**2. Models**
- Local models with one-click download, or OpenRouter models
- Pay with our credits, your own OpenRouter key, or your own Anthropic, OpenAI or Google API key
- No sign-in with Claude or ChatGPT subscriptions (banned by Anthropic, unclear at OpenAI)
- Model per agent, override per step; smart routing between strong and cheap models
- Cost shown before a task; a cloud model suggested when the laptop is too weak
- Image, voice and video providers; side-by-side model comparison

**3. Chat, memory and the general assistant**
- Chat with any model
- Persistent memory you can see, edit and delete, scoped per company and agent
- Learns how you work and writes its own reusable skills
- Titan, the general assistant: shell, files, browser, code and MCP tools for almost any computer task
- Sandboxed shell where risky commands need your OK

**4. Agents and the agent builder**
- Agents defined as files: role, models, tools, memory, triggers, approvals
- Built-in agents you can clone and edit; an agent builder screen
- Approvals before anything external; budgets, step limits and loop detection
- Agents working together through shared memory and a manager agent
- Web content treated as data, never instructions

**5. Flagship agents**
- Promo video from a website
- QA report and Playwright tests for a website or app
- Web, mobile or desktop app from a prompt
- Folder agent for questions about your documents
- Web watcher, for example for changes in Romanian environmental law
- Recorder that replays browser steps on a schedule
- Code builder, like OpenCode or Cline
- SEO agent
- Marketing agent

**6. App builder**
- One builder; the user picks what to build: a web, mobile (React Native and Expo) or desktop (Tauri) app, each with its own kit and specialist sub-agents; another target only if asked
- Option, off by default: add an app to the Titan117 sidebar as an internal app (CRM, inventory, invoices)
- Lovable's loop done locally: plan, build, run, check, fix; free previews on the laptop
- Free local testing: Chromium, Firefox and WebKit; Android emulator, iOS Simulator (Mac) and real phones; clean virtual machines for desktop apps; backends in containers
- Several models per build: strong planner, cheap coder (Chinese open models), fast edits, fixer, vision checker; escalate on failure
- Templates, visual edit, versions and rollback; agents maintain and fix apps
- Publish to the web, the app stores and desktop installers; export code to GitHub

**7. Documents**
- Watched folders per company; reads PDF, Word, Excel, PowerPoint, email and scans
- Local search in Romanian and English, answers with file, page and passage
- Real calculations on spreadsheets
- Read-only by default; "local models only" folders for confidential files

**8. Automation**
- Scheduler that runs while the app is open and catches up on launch
- Record browser actions, edit steps, add variables, replay on a schedule
- AI fixes broken steps with your OK; logins from the OS keychain
- Computer use inside a virtual machine (background, safe) and on your own desktop, only when you start it, with a stop hotkey

**9. Web app and remote control**
- Account, subscription and credits pages
- Paired devices; start, watch and approve agents from the browser
- Chat channels: Telegram, WhatsApp, Discord, Slack
- End-to-end encryption and a phone app

**10. Marketplace (free, on GitHub)**
- Agents, workflows, app templates, MCP tools, prompts and skills, each with a `titan.json` manifest
- Found through a GitHub topic; installs pinned to a commit, with changelogs
- Fork and publish back to your GitHub
- Permissions screen, sandbox, dependency scan, licence warnings, verified badge
- Install any open-source project; GitLab, Codeberg and Hugging Face

**11. Accounts, plans and credits**
- Clerk sign-in; Lovable-style subscription plans with credit top-ups
- Credit ledger and OpenRouter proxy in Convex; bring your own key
- Teams, roles, audit log and an agency plan

**12. Trust and security**
- Safe defaults where general agents are risky: sandboxed shell, folder limits, checked skills
- Approvals, budgets, memory you control, secrets in the OS keychain
- Account deletion and GDPR to write up

**13. Code builder and the coding engine**
- One coding engine (OpenCode, pinned behind our adapter) behind every agent that writes code
- Plan then act; diffs you accept or reject; runs commands, tests and the dev server
- Any model; git, commits and pull requests; project memory
- Sub-agents and a code review agent; live preview; open in your editor; remote tasks

**14. SEO**
- SEO built into every site we generate
- Site audit and speed checks on every page; fixes made for you
- Google Search Console, rank tracking, keyword research (paid data on your own account)
- SEO content writing, competitor checks, several languages
- Local SEO, AI search visibility, weekly re-audits

**15. Marketing**
- Brand kit in memory, used by every marketing agent
- Social posts and a content calendar, ready to post in a click with reminders (automatic publishing after V1)
- Newsletters through your email provider; email sequences and lead scoring
- Landing pages, images, videos, analytics and campaign reports
- Lead finding into the CRM; ad drafts and review monitoring

**16. Web search**
- One search tool for every agent
- Default: OpenRouter's search through credits; your own key, or the browser on your request, as options
- No background scraping of search engines (the old free mode is dropped)
- Reads pages and whole sites into clean text; answers with sources
- Deep research mode, trusted source lists, results in your language, a cache, costs within the task budget

**17. Artifacts**
- Live pages next to the chat for anything an agent makes: documents, web pages and small tools, charts, diagrams, slides, spreadsheets
- Every report from the other agents is an artifact
- Edit by asking or by hand; versions; brand kit applied; templates
- A Download button on every artifact, in every format that fits: PDF, Word, PowerPoint, Excel, CSV, Markdown, offline HTML, PNG, SVG, ZIP of the code; real editable files, converted on the laptop; several at once as a ZIP; agents can save files to a folder
- Optional sharing by private link, with comments; local until you share
- Live data from sidebar apps, scheduled updates, and turning an artifact into a real app

**18. Growing the app**
- Ask Titan for an agent, skill, tool or sidebar app we don't have; it builds it as a sandboxed add-on after your OK
- Add-ons have manifests, permissions, versions and rollback; share them on the marketplace
- Safe mode starts the app with add-ons off when something breaks
- The core (engine, permissions, credits, licence, updates) is never changed by an agent; core fixes come from us through auto-update

**19. Error reports**
- Crashes and failed tasks caught and logged locally, redacted
- "Send a report?" with the full report shown first; a Report a problem button; always ask, send automatically, or never
- Never files, prompts, memory or keys unless you tick a box; reference IDs and "fixed in" follow-ups
- A product owner portal for us (its own repo, `titan117-pop`) with grouped errors, versions and alerts; reports kept 90 days
