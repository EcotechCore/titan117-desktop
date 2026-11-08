# Decisions

Every decision taken so far, newest at the bottom of the table. Where this file and another doc disagree, **this file wins**. New decisions get a row here and a section below, in the same commit as the work.

| Date | Decision | Section |
|---|---|---|
| 15 Oct 2026 | Agents run on the user's laptop; no hosted agents running around the clock | [2](#2-local-first) |
| 15 Oct 2026 | Models: local or OpenRouter; pay with our credits or your own key; subscription first, credits to top up | [3](#3-models-and-payment) |
| 15 Oct 2026 | No sign-in with Claude, ChatGPT or other chat subscriptions | [3](#3-models-and-payment) |
| 15 Oct 2026 | Open-source projects are our starting code, reused only as their licence allows | [4](#4-open-source-reuse) |
| 15 Oct 2026 | Web search: paid API through credits by default, own key optional, ~~free mode opt-in only~~ (dropped 8 Nov, §30) | [5](#5-web-search) |
| 15 Oct 2026 | Two repositories, `titan117-web` and `titan117-desktop`, with a shared versioned package (a third, `titan117-pop`, added 7 Nov) | [6](#6-repositories-and-docs) |
| 15 Oct 2026 | Docs in every repo: shared docs edited in the web repo and copied | [6](#6-repositories-and-docs) |
| 15 Oct 2026 | App builder: one target per project (web, mobile or desktop); the sidebar is an option | [7](#7-app-builder) |
| 15 Oct 2026 | One coding engine for all code work: OpenCode (decided 16 Oct, §12) | [7](#7-app-builder) |
| 16 Oct 2026 | V1 is everything in the feature map; launch only when it all works | [1](#1-scope) |
| 16 Oct 2026 | ~~Design: style tile A on the OpenAI base settings, neon green as the one accent~~ (replaced 7 Nov by tomato and the current style) | [8](#8-design) |
| 16 Oct 2026 | Desktop app: no black buttons or selections; pro desktop layout | [8](#8-design) |
| 16 Oct 2026 | ~~Logo: outline helmet (variation 03), to be redrawn as our own before beta~~ (replaced 18 Oct by the hexagon avatar) | [9](#9-brand) |
| 16 Oct 2026 | Build plan: 19 phases with a check that marks each one done | [10](#10-build-plan) |
| 16 Oct 2026 | Electron for the desktop app; the engine runs on Electron's built-in Node | [12](#12-tech-stack) |
| 16 Oct 2026 | Payments through Stripe directly, not Clerk Billing | [12](#12-tech-stack) |
| 16 Oct 2026 | Coding engine: OpenCode, pinned and wrapped behind our own adapter | [12](#12-tech-stack) |
| 16 Oct 2026 | ~~Credits: one funded OpenRouter account, a sub-key per user~~ (replaced 17 Oct by the proxy) | [12](#12-tech-stack) |
| 16 Oct 2026 | Pricing: Starter €15, Pro €25, Max €50, Custom; 1 credit = €0.01 at cost × 1.25; one-month rollover; EUR and USD | [13](#13-pricing) |
| 16 Oct 2026 | Web search default: OpenRouter search, billed through our credit proxy (corrected 7 Nov; the sub-key plan was replaced on 17 Oct) | [14](#14-product-defaults) |
| 16 Oct 2026 | Shared UI in its own package, `@titan117/ui` | [14](#14-product-defaults) |
| 16 Oct 2026 | First customer: small companies; Windows and macOS at the same launch | [14](#14-product-defaults) |
| 16 Oct 2026 | Chat channels: Telegram first | [14](#14-product-defaults) |
| 16 Oct 2026 | Social platforms: LinkedIn, Facebook and Instagram, TikTok and X, all in V1 (since 7 Nov: as ready-to-post, without the platforms' posting APIs, §24) | [14](#14-product-defaults) |
| 17 Oct 2026 | Promo video on free open-source tools (Revideo or Motion Canvas, plus FFmpeg); no Remotion | [15](#15-no-paid-third-party-costs) |
| 17 Oct 2026 | Paid third-party APIs (X, WhatsApp) are bring-your-own: users set up and pay for their own access, we provide the shell and guidance | [15](#15-no-paid-third-party-costs) |
| 17 Oct 2026 | Credits through our proxy: one secret OpenRouter key on our server; users' own keys go direct | [12](#12-tech-stack) |
| 17 Oct 2026 | Owner: Ecotechcore (ecotechcore.com); domain titan117.com | [16](#16-company-and-development-setup) |
| 17 Oct 2026 | Develop on Windows first; unsigned local builds until external testers | [16](#16-company-and-development-setup) |
| 17 Oct 2026 | Tooling: pnpm as the package manager, Vitest for tests, Playwright for end-to-end tests | [16](#16-company-and-development-setup) |
| 17 Oct 2026 | No free plan and no trial (trial ruled out 18 Oct): the app works only with an active subscription | [13](#13-pricing) |
| 17 Oct 2026 | Signed licence lease for offline use (14 days, offline mode in V1); the app locks when it expires or the subscription ends | [17](#17-offline-use-and-licence) |
| 18 Oct 2026 | Logo: an agent avatar (bloub engine) with an angry face; ~~a neon hexagon whose eyes follow the cursor~~ (since 7 Nov: the angry eyes beside TITAN117, ink at rest, tomato on hover); old helmet files, mockups and stand-in media deleted | [9](#9-brand) |
| 8 Nov 2026 | Paid services: only OpenRouter (models and search) goes through our credits; every other paid service (AI video, SEO data, device farms, hosting, email sending, ads) is the user's own account, which they create and pay for, with our guided setup | [31](#31-paid-services) |
| 8 Nov 2026 | Search: credits, the user's own key, or the browser on the user's request; free background mode dropped. Published sites go to the user's own hosting account; share links stay ours with a report and takedown process | [30](#30-search-and-hosting) |
| 8 Nov 2026 | Browser automation is the user's choice on any site, their own apps included: the agent prepares everything, warns where a site's terms forbid automation, never bypasses CAPTCHAs or bot detection, and stops before publish, launch or pay for the user to click. A self-correcting browser agent is a core strength | [29](#29-the-users-choice-browser-automation) |
| 8 Nov 2026 | Users connect their own accounts, the OpenClaw way: their own chat bots, developer access and providers, with guided setup; our web and phone apps are the exception (ours, end-to-end encrypted) | [28](#28-connect-your-own) |
| 8 Nov 2026 | Email at no cost: mail stays on the laptop and never passes through our servers; Gmail through Google's free verification (IMAP with an app password if Google asks for the paid assessment); cloud models read mail only directly from the laptop (local, own key, or a per-user capped OpenRouter key) | [27](#27-email-at-no-cost) |
| 8 Nov 2026 | OpenRouter confirmed our credits model is allowed (one funded account, key only on our server, per-user limits) | [12](#12-tech-stack) |
| 8 Nov 2026 | Every third-party service gets a row in `external-services.md`, checked against the vendor's own docs, before its feature is specified or built (guardrails §11b) | [26](#26-external-services) |
| 8 Nov 2026 | Agents work on GitHub **as the user**, never as a bot of ours: local git uses the user's own git setup; GitHub actions (pull requests, forks, publishing) use a token the user grants through our GitHub App's device flow, kept in the laptop's keychain only. Pull requests show the user as author | [25](#25-github-identity) |
| 7 Nov 2026 | Website: the framed-grid homepage (`homepage-grid/`, after the Atomist template) is the one design we keep; tomato accent, Titan's angry eyes with the TITAN117 wordmark; all other mockups removed | [18](#18-website-design) |
| 7 Nov 2026 | Desktop app follows the current style: tomato `#ff6347` replaces neon green; light-gray sidebar, white workspace, black only for text, done marks and the activity log; agent eyes in their own colours; reference: `mockup/` in the desktop repo, rules in design.md 0.2 | [19](#19-desktop-app-style) |
| 7 Nov 2026 | Your own coding tools (13.14): the code builder can hand work to Claude Code, Codex, Cursor's agent, OpenCode or Antigravity already installed and signed in on the laptop, run unmodified, under the user's own plan; we never touch their logins | [20](#20-your-own-coding-tools) |
| 7 Nov 2026 | The app grows through add-ons Titan builds on request (agents, skills, tools, sidebar apps); agents never modify the core; safe mode and rollback; core fixes ship through our updates. In V1 | [21](#21-how-the-app-evolves) |
| 7 Nov 2026 | Error reports: opt-in, shown in full before sending, no files, prompts or keys by default; grouped in the product owner portal; kept 90 days. In V1 | [22](#22-error-reports) |
| 7 Nov 2026 | Error reports are stored in our own Convex tables in V1 (was leaning) | [22](#22-error-reports) |
| 7 Nov 2026 | Repos owned by the **EcotechCore** GitHub organisation; a third repo, **`titan117-pop`**, for the product owner portal | [6](#6-repositories-and-docs) |
| 7 Nov 2026 | The website moves into the Next.js web app (`apps/web`) in phase 2, built from the same content; `homepage-grid/` stays the design reference until then | [18](#18-website-design) |
| 7 Nov 2026 | Social posting in V1 without platform approvals: ready-to-post packages, Copy and open, Time to post reminders with the phone's share sheet, calendar and CSV export; automatic publishing through the platforms' APIs after V1 | [24](#24-social-posting-in-v1) |
| 7 Nov 2026 | Security model in two parts (protecting users, protecting us), in `docs/security.md`: remote control off by default with two-factor and laptop-only approvals, end-to-end encryption in V1, a network policy per task, private chats only with web parity, a product owner portal, release protections, a pen test before beta | [23](#23-security-model) |

---

## 1. Scope

- **V1 is everything in the [feature map](brainstorming-feature-map.md)** (feature map decision 18). No public launch until the whole product works well.
- **Not doing:** agents hosted around the clock on our servers; sign-in with chat subscriptions; bypassing CAPTCHAs, paywalls, logins or bot detection. Our own background features (search, crawling) respect site terms; where the user points an agent at a site, it's their choice, with a warning (§29).
- The work is split into phases ([§10](#10-build-plan)), not into releases.

## 2. Local-first

- The Titan engine runs on the user's laptop: agents, tools, memory, documents, app data. When the laptop is off, agents stop; scheduled work catches up on the next launch.
- Our cloud is small: accounts, plans, credits, devices, remote commands, and what users choose to share.
- Company data never reaches our servers unless the user shares it or sends it to a cloud model they picked.

## 3. Models and payment

- **Model sources:** local models (llama.cpp, built in), OpenRouter, and the user's own Anthropic, OpenAI or Google key.
- **Paying for cloud models:** our credits, or the user's own key. Both need a subscription.
- **Subscription first, then credits** to top up (Lovable's model). Plans, prices and credits are decided in [§13](#13-pricing).
- **No sign-in with chat subscriptions** (Claude Pro or Max, ChatGPT Plus or Pro, Gemini plans): Anthropic's terms ban it outside its own apps and it blocks such tools; OpenAI's position is unclear. Revisit only if a provider officially allows it. Not to be confused with [§20](#20-your-own-coding-tools): running the vendor's own tool that the user signed into themselves.

## 4. Open-source reuse

- MIT, Apache 2.0, BSD: copy and adapt, keep notices, list them in the third-party licences file.
- GPL, AGPL: ideas only, or run unchanged as a separate program.
- No licence or non-commercial: ideas only.
- Every project we take code from gets a row in a sources list (project, licence, what we took, commit).

## 5. Web search

- Default: a paid search API through credits: **OpenRouter's search tool**, through our credit proxy (decided in §14 and §12).
- Option: the user's own key (Brave, Tavily, Exa, Serper).
- ~~Free mode, opt-in only, built on ddgs or open-webSearch~~ Dropped 8 Nov 2026: it scraped other search engines in the background. Replaced by **search in the browser on the user's request** (§30).

## 6. Repositories and docs

- `titan117-web`: Next.js web app, the Convex backend, and `@titan117/shared` (protocol, types, generated Convex client), published privately with versions.
- `titan117-desktop`: Electron shell, the engine, agents and tools; installs `@titan117/shared` at a fixed version.
- Backend changes stay backward compatible; protocol messages carry a version; a compatibility test runs in desktop CI.
- `titan117-pop` (added 7 Nov 2026): the **product owner portal**, a Next.js app for the owner and employees (error reports, accounts, credit corrections, kill switches, releases), deployed on its own address (for example `admin.titan117.com`). It's a client of the same Convex backend: its admin-only functions (`adminQuery`, `adminMutation`) live in `titan117-web`'s `convex/` with the rest of the backend, and the portal installs `@titan117/shared` at a fixed version, like the desktop app. Separate repo so the staff tool, its access and its deploys are kept apart from the public web app.
- **Owner (7 Nov 2026):** all three repos belong to the **EcotechCore** GitHub organisation (two-factor required for members), not a personal account.
- Docs in every repo: shared docs (everything in `docs/` but `progress.md`, plus `CLAUDE.md`) are edited in `titan117-web` and copied to `titan117-desktop` and `titan117-pop` with `scripts/sync-docs.py`; a CI check fails if a copy is stale. Each repo keeps its own `progress.md`.

## 7. App builder

- One builder agent with a kit per target. The user picks **one** target per project: web, mobile (React Native and Expo) or desktop (Tauri). Another target only if asked.
- Adding an app to the Titan117 sidebar is an **option**, off by default.
- Apps are tested locally: real browsers, emulators, simulators, clean virtual machines.
- One coding engine powers the app builder, the code builder and Titan's scripts. **OpenCode** (MIT, headless server, TypeScript SDK), pinned behind our own adapter (decided 16 Oct, §12).
- Several models per build (planner, coder, quick edits, fixer, checker), escalating on failure; Chinese open models are allowed with provider rules for company data and a switch to turn them off.

## 8. Design

- **Direction:** style tile **A · Quiet** on the OpenAI base settings (system fonts, 8px grid, 5px radius, flat, 400ms ease), white, black and gray with **neon green `#c4f012`** as the one accent. Full rules: [design.md](design.md). All mockups were deleted on 18 Oct.
- **Desktop app:** no black buttons or selections. ~~Primary actions are neon; selected items are white with a neon edge; dark panels became light tints.~~ Since 7 Nov: primary actions are tomato, selected items are white with a hairline, approvals use a tomato tint ([§19](#19-desktop-app-style)).
- **Superseded 7 Nov 2026:** the neon-green accent and style tile A. The website follows §18, the desktop app §19; the rules are in [`homepage-grid/design.md`](../../homepage-grid/design.md) and [design.md](design.md) 0.2.
- **Desktop layout:** the pro version (title bar with task tabs, icon rail, sidebar, run inspector, status bar) is the direction for the desktop app.

## 9. Brand

- **Logo (7 Nov 2026):** Titan's angry eyes (bloub engine, `colere`) beside **TITAN117** in Unbounded 600; ink at rest, looking around on their own, tomato on hover. Agents get the same eyes in their own colours (§19). This replaces the neon hexagon below.
- ~~**Logo (18 Oct 2026):** Titan's avatar, a neon `#c4f012` hexagon with the angry expression~~, drawn live by the bloub engine (MIT, see [open-source-references](open-source-references.md#website-and-brand)). Its eyes follow the cursor, and its animation states (thinking, needs you, done, offline) show what Titan is doing. The other agents get their own bloub avatars (shape, colour or gradient, mood).
- **Deleted on 18 Oct:** the helmet logo files and states, all mockups and the stand-in images and video from verdictu-web. New media will be made for Titan117.
- bloub's author describes it as a recreation of the x.ai bot avatar, so the shapes and eyes **must be restyled as our own and trademark-checked (with the name "Titan117") before beta.**
- ~~16 Oct: the outline helmet (variation 03) with neon eyes.~~ Replaced by the avatar above.

## 10. Build plan

- 19 phases (0 to 18) in the [roadmap](../01-launch-roadmap-v1.md), each with a check that marks it done. Status and a dated log in [progress.md](../progress.md).
- A phase is done only when its check passes and the [guardrails](../guardrails.md) "done means done" list is met.

## 12. Tech stack

Decided 16 Oct 2026.

- **Desktop shell: Electron.** The same Chromium on Windows and macOS, so artifacts, previews and sidebar apps look the same everywhere. Tauri stays the template for desktop apps that users build (feature 6.4).
- **Engine runtime: Node**, the one inside Electron (a utility process), so there's no second runtime to ship. Playwright and our other tools target Node.
- **Payments: Stripe directly**, not Clerk Billing. Clerk Billing is in beta and today is USD only, with no VAT handling, no 3D Secure (needed for many EU cards) and no usage-based credits. With Stripe: subscriptions, one-time credit top-ups, Stripe Tax for EU VAT, any currency. Only the payment webhook writes plans and credits (guardrails §3). Stripe Tax or a merchant of record is decided before beta.
- **Coding engine: OpenCode** (MIT), in headless server mode inside the engine. It releases very often and sometimes regresses, so we **pin a version**, put it behind **our own adapter interface** (so it can be swapped), and run **contract tests** on every upgrade. Its permission prompts become our approvals.
- **Credits path: our proxy** (decided 17 Oct 2026, replacing the sub-key plan of 16 Oct).
  - **One OpenRouter account**, funded by Ecotechcore (starting balance about €1,000, auto-top-up and a low-balance alert). **One secret key**, kept only in our server's environment variables, never in the desktop app.
  - The desktop engine calls **our endpoint** with the user's sign-in token. The endpoint checks the user and their credits, forwards the request to OpenRouter with our key, **streams** the answer back, then **deducts the credits** in the Convex ledger.
  - The endpoint is a small **streaming route on Vercel** (long streams don't suit Convex actions); Convex keeps the ledger and the rules.
  - **Prompts pass through but are never stored**; the privacy policy says so. Documents and memory stay on the laptop.
  - **Credits running out mid-request:** a minimum balance is checked before a request starts; a small overdraft is allowed and settled by the next credits.
  - The same proxy carries OpenRouter's web search. ~~AI video and image providers (fal.ai or Replicate)~~ Changed 8 Nov 2026: every paid service other than OpenRouter is the user's own account (§31).
  - **Rate limits and abuse checks** live in the proxy (guardrails §2, §3).
  - **Confirmed by OpenRouter, 8 Nov 2026:** one funded account whose credits subscribers use through our backend is allowed, with the key kept on our server, caps on the account and per-user limits ([their answer](vendor-answers/openrouter-2026-11-08.md)).
  - **Own keys stay direct:** a user's own OpenRouter, Anthropic, OpenAI or Google key is stored in their OS keychain and the engine calls the provider directly, with no proxy and no credits. They pay us only the subscription (own keys need a paid plan, decisions §13).
  - **Later, optional:** per-user OpenRouter sub-keys with spending limits, if traffic grows enough that carrying every stream becomes costly.
  - **In development:** one OpenRouter key in the local `.env` file (never committed) until the proxy is built in phase 2.

## 13. Pricing

Decided 16 Oct 2026. Details and numbers: [pricing.md](pricing.md).

- **Plans:** **Starter €15**, **Pro €25**, **Max €50** (heavy users), **Custom** (teams, agencies). Monthly or yearly (2 months free). **No free plan** (decided 17 Oct 2026): Titan117 works only with an active subscription. **No trial** either, free or paid (decided 18 Oct 2026).
- **Credit:** 1 credit = €0.01 (or $0.01) of cloud usage at our price; a task costs provider cost × 1.25. Local models, previews, tests, documents and own keys are free.
- **Rollover:** monthly credits roll over one month, capped at one allowance; top-ups last 12 months while a paid plan is active.
- **Currencies:** EUR and USD at launch; regional prices later.
- **Credits a month:** Starter 700, Pro 1,500, Max 3,500, Custom by agreement. Per-plan features as in pricing.md (confirmed 16 Oct 2026).

## 14. Product defaults

Decided 16 Oct 2026.

- **Web search default: OpenRouter search**, billed through our credit proxy like model calls (§12), so there's no extra key or billing. The user's own Brave, Tavily, Exa or Serper key and the browser on the user's request are the options (§5, §30).
- **Shared UI: a separate package, `@titan117/ui`**, next to `@titan117/shared`. The engine uses only `@titan117/shared`, so it never pulls in React or styles.
- **First customer: small companies** (owners and small teams without developers). **Windows and macOS** installers at the same launch.
- **Chat channels: Telegram first** (free, open bot API, no business verification). WhatsApp, Slack and Discord follow in the same phase (15).
- **Social platforms: all four in V1:** LinkedIn, Facebook and Instagram, TikTok, and X, **as ready-to-post packages the user publishes in a click** (changed 7 Nov 2026, [§24](#24-social-posting-in-v1)). ~~Each needs its own API app review, so apply early; X's API cost goes into credits.~~
  - Build on open-source social schedulers under the reuse rule (§4) for the calendar and formats: Postiz is AGPL, so ideas only; prefer MIT or Apache projects for code. The shortlist is made at the start of phase 14.

## 15. No paid third-party costs

Decided 17 Oct 2026. Titan117 avoids licences and APIs that charge us per seat or per use, beyond the cloud services the business runs on and the credits users buy.

### Promo video engine
- **Remotion is out** (paid company licence for teams over about 3 people, and a separate licence to build it into a product).
- **Use free open-source tools instead:** **Revideo** (a Motion Canvas fork built for rendering videos from code in apps, with an API, server-side rendering, audio and templates) or **Motion Canvas** itself, and **FFmpeg** for encoding and cutting formats.
- Licences to confirm from each repo's LICENSE file before we copy code (believed MIT for Revideo, Motion Canvas and Editly). FFmpeg is LGPL or GPL depending on the build, so we ship an **LGPL build, unchanged, as a separate program** (§4).
- Study Editly (simple JSON-to-video edits) for ideas. Pick the engine at the start of phase 14.

### Bring-your-own connectors for paid APIs
- **X** and **WhatsApp** are offered as **bring-your-own connectors**: the user creates their own developer access, pays the platform directly, and pastes their keys. Titan117 provides the best shell and guidance:
  - a **step-by-step setup guide** in the app (where to sign up, what to choose, screenshots), using the "you need this first" cards (1.17);
  - a **connection test** and clear errors;
  - the platform's **limits and costs shown** before a task uses them;
  - keys stored in the **OS keychain** only (guardrails §8).
- **X:** the user's own X developer app and API plan.
- **WhatsApp:** the user's own Meta Business account and the official WhatsApp Business Platform (Cloud API); Meta bills them per conversation. **Only the official API:** unofficial WhatsApp libraries break WhatsApp's terms and can get the user's number banned.
- The same pattern applies to any future paid API: we don't resell it; the user brings their own access.
- X posting is no longer needed in V1 (§24); X becomes a bring-your-own connector when automatic publishing arrives after V1. Telegram needs no review. Meta, TikTok and LinkedIn app reviews are needed only for automatic publishing, after V1 (§24).

## 16. Company and development setup

Decided 17 Oct 2026.

- **Owner:** Titan117 is a product of **Ecotechcore** (ecotechcore.com). Stripe, the domain, and later the Apple Developer Program and Windows code signing are in the company's name.
- **Domain:** **titan117.com** (owned).
- **Accounts:** the existing Ecotechcore accounts for Convex, Clerk, Stripe, Vercel and OpenRouter.
- **Development on Windows first.** A Mac is available and comes in when macOS is tested.
- **Unsigned local builds during development.** Windows shows a SmartScreen warning and macOS asks to confirm the first launch; that's fine on our own machines. **Apple Developer Program and Windows code signing are bought before the first external testers** (phase 18 at the latest).
- **Tooling:** **pnpm** as the package manager in every repo (workspaces for the app, Convex, `@titan117/shared` and `@titan117/ui` in the web repo; the shell, engine and interface in the desktop repo). **Vitest** for unit and guardrail tests (with `convex-test` for Convex functions, as in Ninjathons). **Playwright** for end-to-end tests of the web and desktop apps.

## 17. Offline use and licence

Decided 17 Oct 2026.

- **Subscription required.** Every use of the app needs an active plan; there's no free mode.
- **Signed licence lease.** When online, our server issues a licence signed with our private key: the user, the device, the plan, what it includes, and an expiry. The app checks the signature with the public key built into it, and renews the lease quietly in the background whenever it's online.
- **Offline:** the app works with local models, local tools and local data until the lease expires. The offline period is **14 days** (confirmed 17 Oct 2026). Offline mode is part of V1 (features 1.22–1.24). A warning shows from 3 days before expiry: "Connect to the internet to keep using Titan117".
- **When the lease expires, the subscription ends or payment finally fails, the app locks:** a full-screen sign-in and renew screen replaces the workspace. No agents run.
  - **Running tasks** are paused at a checkpoint, never killed halfway.
  - **The user's own files** (documents, exported artifacts, project folders, generated app code) stay on disk and are theirs; the app never deletes or encrypts them.
  - **"Export my data"** stays available on the lock screen (chats, memory, artifacts), for GDPR and trust.
- **Payment failures:** Stripe retries for a few days (dunning) before the subscription ends; the app warns during that time.
- **Clock tricks:** the app stores the latest time it has seen and the server time from the lease; setting the clock back doesn't extend the lease.
- **First sign-in needs internet**, once; then the session stays in the OS keychain.
- **Online-only features** (cloud models, own keys, web search, remote control, publishing, sharing, sync, buying credits, downloading components) show "Needs internet" cards offline; usage reports, sync and notifications queue until the connection is back.
- **Honest limit:** a desktop app can be tampered with by a determined person. That's acceptable: the paid value that costs us money lives on our server.

## 18. Website design

- **7 Nov 2026:** the website follows `homepage-grid/`: a white framed grid with hairline borders (after the Atomist Next.js/shadcn template's layout), Figtree for text, a **tomato `#ff6347`** accent (`--accent` in `styles.css`), light and dark themes. For the website this replaces the neon-green direction in [§8](#8-design) and [design.md](design.md); the desktop app's rules in §8 are unchanged.
- **Logo on the website:** Titan's angry eyes, drawn by the bloub engine (`homepage-grid/assets/bot.js`), next to "TITAN117" in Unbounded 600. Ink at rest, looking around on their own, tomato on hover. The restyle and trademark check in [§9](#9-brand) still apply before beta.
- **Design system and pages (7 Nov):** the website's rules are written in [`homepage-grid/design.md`](../../homepage-grid/design.md). Pages: home, agents (overview and one page per agent), industries (overview and one per industry), pricing, FAQ and Learn (guides with a video and step-by-step text per lesson); Agents and Industries are hover dropdowns in the nav. Sub-pages are generated by `homepage-grid/src/build.py` from `src/content.py`.
- **Into the web app (7 Nov 2026):** in phase 2 the site is rebuilt as part of the Next.js web app (`apps/web`) at titan117.com, from the same content (`src/content.py` becomes typed data) and the same styles; `homepage-grid/` stays the design reference until then, and `.well-known/security.txt` moves with it.
- **Removed on 7 Nov:** every other mockup (`mockup/`, `new-mockups/`, the root `index.html`, which stay in git history; `gemini-mockups/` and `homepage-concept/`, which were never committed and went to the Recycle Bin).

## 19. Desktop app style

- **7 Nov 2026:** the desktop app follows the same style as the website's app window, worked out in the clickable mockup in the desktop repo (`titan117-desktop/mockup/`, moved there from the web repo on 7 Nov 2026). Rules: [design.md](design.md) 0.2.
- **Colour:** tomato `#ff6347` is the one accent and replaces neon green `#c4f012` everywhere (actions, the running step, counts that need you, focus ring). Light gray `#f4f4f5` for the sidebar and title bar, white for the workspace, `#fafafa` for the task details panel.
- **Black** only for text, done marks, progress bars and the activity log. Still **no black buttons or selections**: primary actions are tomato with white text; selected rows are white with a hairline.
- **Agents** show Titan's eyes in their own colour (Titan tomato, Folder agent blue, Recorder teal, Web watcher violet, App builder amber, Code builder cyan, QA green, Marketing pink, SEO purple, Promo video red): gray at rest, animated while working or waiting for you.
- **Layout:** title bar with one tab per task; sidebar with the workspace switcher, New task, search, the views (Tasks, Approvals, Automations, Memory), Titan and the teams (Operations, Build, Growth), automations, credits and the user; the workspace; a task details panel with the activity log.
- **Type:** Figtree for the app, Unbounded only for the TITAN117 wordmark.
- The logo restyle and trademark check in §9 still apply.

## 20. Your own coding tools

- **7 Nov 2026 (feature 13.14):** the code builder and the app builder can hand a coding task to a coding tool the user already has on the laptop: **Claude Code, Codex, Cursor's agent, OpenCode or Antigravity**. Titan117 starts it, feeds it the task, shows its steps and routes its approvals; the user keeps their own plan. Our own engine (OpenCode with local or OpenRouter models) stays the default and the fallback. Like T3 Code (MIT, ideas only for now), which "orchestrates" these tools with the credentials users already have.
- **Why it's allowed (Anthropic, checked 7 Nov 2026):** Anthropic's Claude Code legal page lets products run Claude Code if the binary is **unmodified** with its sign-in methods intact, **each user authenticates with their own** subscription or API key, and nobody **pays for, resells or intermediates** their usage; it adds that its rules don't prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". What it forbids: offering Claude sign-in inside our own app, routing requests through users' subscriptions, collecting or storing Claude credentials or session tokens, and Agent-SDK products on subscription logins (they must use API keys). Source: https://code.claude.com/docs/en/legal-and-compliance
- **Rules we follow for every tool:**
  1. Run the vendor's **own, unmodified** CLI or official SDK, installed by the user (or downloaded from the vendor with their OK). No patched binaries, no spoofed headers, no reimplementation of their client.
  2. **Sign-in only through the vendor's own flow** (`claude auth login`, `codex login`, and so on), started by the user. We never read, copy, store, forward or proxy their tokens; their credential folders are off-limits to our agents (guardrails §8).
  3. **No reselling or paying** for their usage; it stays on the user's plan. Credits are never charged for it.
  4. It runs **inside our sandbox and approval layer**: only the task's folder, risky commands and pushes wait for the user.
  5. **Names in plain text only:** we may say Titan117 "runs Claude Code"; never the vendor's names or logos in our product, feature or plan names, or anything suggesting a partnership.
  6. Accept Anthropic's **Commercial Terms** for running Claude Code in our product, and check each vendor's terms before launch.
- **Still to check before launch:** OpenAI (Codex with a ChatGPT plan in a third-party app: not clearly allowed or forbidden), Cursor (its agent CLI and SDK terms), Google (Antigravity), xAI (Grok CLI). Until a vendor's terms are clear, its adapter ships as an experimental option with an API-key mode.
- **Risk:** vendors change these terms and enforce without notice (Anthropic restricted third-party harnesses several times in 2026). Every adapter has a kill switch we can flip from our cloud, and the task falls back to our own engine.

## 21. How the app evolves

- **7 Nov 2026, in V1 (features 18.1–18.9):** Titan117 is built like an operating system. The **core** (engine, permission and approval layer, model router, credits and metering, licence lease, sync, update channel) is fixed, signed and changed only by our releases. **Everything above it** (agents, skills, tools, sidebar apps, automations) can be added, changed and removed by users and by Titan.
- When a user needs something we didn't build, they ask Titan; it plans the add-on, shows what it will create and what it may access, and builds it after their OK, using the agent builder (§4 of the feature map), the coding engine and the app builder. Add-ons are packages with a `titan.json` manifest, run in the marketplace sandbox, have versions and rollback, and can be shared on the marketplace.
- **Agents never modify the core** on the user's computer: no writing to the app's files, its permission, credit or licence settings, or its update channel. Why: an agent that could edit the permission layer could switch off every safety check (one poisoned web page would be enough); it would break code signing and auto-update; it would make the licence and metering trivially bypassable; and every user would run a different app we couldn't support.
- **Safe mode:** if the app can't start, or keeps failing after an add-on changed, it starts with add-ons off and offers to roll back or remove the one that broke it.
- **Core fixes come from us:** Titan can attach a write-up and a suggested fix to an error report (§22), with the user's consent; we review it and ship it to everyone through auto-update.
- Plan: agents and skills on request in phase 11; tools, sidebar apps, add-on packages, safe mode and the core-is-off-limits checks in phase 16; the fix loop in phase 18.

## 22. Error reports

- **7 Nov 2026, in V1 (features 19.1–19.11):** when something breaks, the user can send us a report and we see it in the product owner portal. It must never look like hidden telemetry in a local-first product, so:
  - **Opt-in:** "always ask" is the default; the user can switch to "send automatically" or "never".
  - **Shown in full** before anything leaves the laptop.
  - **What's in it:** versions, OS, the agent or feature, the error and stack trace, the last redacted log lines, the user's note. **Never** file contents, prompts, memory, keys, passwords or tokens; prompts and files only if the user ticks a box for that one report; nothing from "local models only" folders.
  - **Offline:** reports wait in the offline queue.
  - **Kept 90 days**, deleted with the account.
- **Where they go (decided 7 Nov 2026):** our own Convex tables (`errorReports`, `errorGroups`) and the product owner portal (`titan117-pop`), so the data stays with us and follows our deletion rules. A hosted tracker is the alternative if we outgrow it: GlitchTip (MIT) or Bugsink can be self-hosted; Sentry's service and its MIT SDKs could be used, but its server is fair-code (ideas only, §4). Native crashes use Electron's crash reporter.
- Each report gets a reference ID; groups link to an issue and the release that fixed them, so the app can say "Fixed in 1.4, update now?".
- Errors from add-ons go to the user, not to us, unless the add-on's author opts in.
- Plan: error capture and the redacted local log in phase 1; reports end to end (card, Report a problem, crash reporter, queue, product owner portal, reference IDs, setting) in phase 5; triage and the fix loop in phase 18.

## 23. Security model

- **7 Nov 2026:** security is written in [`docs/security.md`](../security.md) in two parts, **protecting our users** (their data, laptop and account) and **protecting us** (credits, subscriptions, our keys, our releases, our portal). Rules with their enforcement are in the guardrails.
- **Remote control** (users): off by default, switched on per laptop; **two-factor required** to switch it on (Clerk, a passkey first); pairing confirmed on the laptop; **laptop-only approvals** for deleting, payments, sending files or data out, installing add-ons and changing permissions (or remotely after a second factor, if the user chooses); alerts on every remote task; "Revoke all devices". **As easy as possible:** the one-time setup is part of the setup checklist, and everything else can be approved anywhere.
- **End-to-end encryption is V1** (feature 9.5), with the key design in the architecture: device keys made on each device, pairing confirmed by a matching code, ciphertext only in Convex, key rotation when a device is removed. Chat channels can't be end-to-end, and the app says so.
- **Network policy per task** (after Claude Code, Codex, Cursor and the browser agents): site lists, ask before a new site once private data was read, block requests carrying private content.
- **Chat channels:** one-time-code linking, private chats only in V1; **the web and phone apps can do everything a channel can.**
- **Product owner portal** (us): a separate app in its own repo (`titan117-pop`, §6) for the owner and employees, with error reports, accounts, credit corrections, kill switches and releases; two-factor required; every view logged.
- **Our money and keys:** balance and entitlements only on the server, the proxy checks before every call, a signed licence lease, device limits on the server, hard spending caps on every paid provider. A cracked app only unlocks local features (accepted, §17).
- **Our releases** (the owner's development process): cloud code signing, a second signature for updates, branch protection, pinned GitHub Actions, a second approval to publish, two-factor everywhere.
- **Process:** `security.txt` with `security@titan117.com`; an incident checklist with a rotation step per key; an **external penetration test before the public beta** (phase 18).
- **Accepted risks:** malware already on a user's laptop; cracking the licence for local features; chat channels not being end-to-end; users approving a harmful action they were shown; vendors changing their terms.

## 24. Social posting in V1

- **7 Nov 2026:** V1 doesn't post through the social platforms' APIs, so it needs **no app reviews** (Meta, TikTok, LinkedIn) and no paid X API. The marketing agent still plans, writes and makes everything; the user publishes in a click: each post comes as a ready-to-post package (text, hashtags, images or video sized for the platform); **Copy and open** copies the text and opens the platform's own post screen (LinkedIn and X pre-fill the text); **Time to post** reminders from the content calendar on the laptop and phone, where one tap opens the phone's share sheet with the media attached (Instagram, TikTok, Facebook); export the calendar (.ics) and a CSV for the platforms' own free schedulers such as Meta Business Suite.
- **The user's choice (changed 8 Nov 2026, §29):** a user can also have the agent fill in the platform's own website in their browser. The app warns first that the platform's terms forbid automation and the account risk is theirs, and the agent stops before the final Post button, which the user clicks.
- **After V1:** automatic scheduled publishing through each platform's API (feature 15.4b). Before that: Meta business verification for Ecotechcore and the privacy policy and terms online (they take time and don't need the feature); the app reviews themselves need a working demo, so they're submitted once publishing works.
- Website and mockups say "ready to post" and "reminders", never "posts go out with the laptop closed".

## 25. GitHub identity

- **8 Nov 2026:** when an agent commits, pushes, opens a pull request, forks or publishes, it does it **as the user**, the way Cursor, VS Code and Claude Code work on your own repos. The user owns and answers for what lands in their repos, and repo owners see a person they know, not an unknown bot. There is **no `titan117[bot]` acting in users' repos**.
- **Local git:** the user's own git setup on the laptop (name and email, Git Credential Manager or SSH keys). Commits are authored by the user. Each agent commit adds a `Co-authored-by` trailer naming Titan117, so the AI's part is visible in the history; the user can turn it off in settings.
- **GitHub actions** (open a pull request, fork, create a repo, publish a marketplace item, 10.6 and 13.7): the user clicks **Sign in with GitHub**, approves our GitHub App through GitHub's **device flow**, and picks which repos it may use. The app gets a **user access token**. GitHub's documented behaviour (checked 8 Nov 2026 on docs.github.com):
  - Actions are attributed to the user: the user's avatar with the app's small badge in the GitHub UI, and the user as the actor in audit logs.
  - The token has only the permissions both the user and the app have, on only the repos both can reach.
  - The token expires after 8 hours; its refresh token lasts 6 months.
  - The device flow needs no client secret, so nothing secret ships in the app.
- **The GitHub App** is registered under the **EcotechCore** organisation (its install screen reads "by EcotechCore") and asks for the smallest set of permissions the features need, listed in the phase 7 spec. It is used only for user access tokens, never with its own installation identity in users' repos.
- **Tokens stay on the laptop**, in the OS keychain (guardrails §8). They never go to Convex, our servers, logs or error reports. A coding task started from the web or phone runs on the laptop with the laptop's token.
- **Approvals:** pushing, opening a pull request, forking and publishing are outward actions and go through the approval screen (4.5) unless the user allows them for that repo. Agents never force-push, push to a protected branch or merge without the user's OK.
- **Signing out** deletes the token from the keychain; the user can also revoke the app on GitHub at any time.

## 26. External services

- **8 Nov 2026:** after the GitHub slip (§25), every third-party service gets a row in [external-services.md](external-services.md) answering whose account, who it acts as, where credentials live, which approvals the vendor requires, what the terms forbid and who pays, checked against the vendor's own documentation with a date and link (guardrails §11b).
- **Default when in doubt:** the user's own account, acting as the user, credentials in their keychain, the vendor's official API and sign-in flow.
- The first pass found open points listed in the feature map's open decisions 10–16, the most important being OpenRouter's terms on reselling (needed before phase 2).

## 27. Email at no cost

- **8 Nov 2026:** one inbox for all the user's mail accounts (3.6), built so it costs us nothing.
- **Mail stays on the laptop.** Fetched, stored, searched and drafted on the laptop only. It never goes to Convex, our proxy, error reports or sync. Remote control can show mail only end to end encrypted (security.md A2). This is what keeps Google's paid yearly assessment from applying: Google ties it to storing or transmitting that data on servers.
- **Gmail:** sign in with Google through our app, after Google's free verification (privacy policy and verified domain, so after phase 2). Until then, Google's testing mode for us and beta testers. If Google still asks for the paid assessment, Gmail connects through IMAP with an app password instead, and we revisit when revenue covers it.
- **Outlook and Microsoft 365:** Microsoft's own sign-in; publisher verification (to check in phase 3).
- **Yahoo, iCloud, company mail:** IMAP and SMTP with the user's app password.
- **Cloud models never get mail through our proxy.** A task that reads mail uses a local model, the user's own key, or, with credits, a **per-user OpenRouter key** made by our server through OpenRouter's key management API: capped with a limit, kept in the laptop's keychain, calling OpenRouter directly, its usage read back and charged to credits, disabled when the subscription ends. Only for mail tasks; everything else stays on the proxy.
- **Safety:** mail is untrusted content (4.9); sending always asks (4.5).

## 28. Connect your own

- **8 Nov 2026:** like OpenClaw, users connect their own accounts and services; we make it very easy (a guided card per service with screenshots, a connection test, clear errors, keys in the keychain, as in §15) but we don't run or own their connections. Nothing to approve for us, nothing of theirs on our servers.
- **Chat channels (9.7):** the user's own bot. Telegram through BotFather, Discord through its developer portal, Slack as an app in their own workspace, WhatsApp through their own Meta account (§15). The laptop connects out to the platform; no Titan117 bot, nothing through our servers. Messages arrive only while the laptop is on, which is true of all our agents anyway.
- **Our web and phone apps are the exception:** they're our product, run through our servers, and stay end to end encrypted (§23), so we pass along what we can't read.
- **Ads (15.13):** ready-to-use ads plus a bulk-upload file for Google's and Meta's own import tools by default; optionally the user's own Google Ads developer token or Meta developer app, connected with our guide.
- **Google Business Profile (14.11):** a guided checklist in the user's own profile by default; optionally their own API access, applied for with our guide.
- Where it applies, the same choice as everywhere: the easiest default that needs nobody's approval, and "connect your own" for users who want more.

## 29. The user's choice: browser automation

- **8 Nov 2026:** users can point the browser agent (3.10), the recorder (§8) and computer use (8.7, 8.8) at **any site or app they choose**, including their own apps, supplier portals, government forms, and platforms like Meta Ads Manager or LinkedIn. We help them build and run it; the responsibility for using a site is theirs, as with any browser.
- **Our default stays the safe route:** ready-to-post packages (§24), ads with import files and Business Profile checklists (§28). Browser automation is an extra option, never the default, for platforms whose terms forbid it.
- **Warned before it runs:** a list of sites known to forbid automation or to restrict accounts for it (Meta, LinkedIn, X, TikTok, Google Ads, Discord, and more as we learn). The card says it plainly: "This site's terms don't allow automation. It may restrict your account. Run it anyway?" The user's answer is remembered per site and can be changed.
- **The final step is always the user's:** the agent fills in and prepares everything, then stops before **publish, post, launch, send or pay**; the user clicks it or approves it (4.5). Scheduled runs (8.1) that reach such a step pause and notify.
- **Never, on any site:** bypassing CAPTCHAs, paywalls or logins; hiding that it's automated (no fake fingerprints or bot-detection evasion); sites the user hasn't signed into themselves. Discord user accounts aren't automated at all (its terms ban "self-bots").
- **A self-correcting browser agent is a core strength:** it reads the page, acts, checks the result, and recovers from changed layouts, pop-ups and slow pages on its own; a recorded flow that breaks gets fixed by the agent with the user's OK (8.4). Measured on a fixed set of real tasks in our own tests (guardrails §1), on our sites and on public ones.
- **Example, the law watcher (5.5):** a user sets "check Romanian environmental law every Monday"; the watcher reads the official sources (for example the Ministry of Justice's legislative portal), finds what changed since last time, and reports what matters to the company, with links. It runs while the app is open and catches up on the next launch (8.1).

## 30. Search and hosting

- **8 Nov 2026, search:** three sources. (1) **Credits:** OpenRouter's search tool through our proxy, the default (covered by OpenRouter's OK, §12). (2) **The user's own key:** Brave, Tavily, Exa or Serper. (3) **The browser, on the user's request:** the browser agent searches in a visible browser at a human pace, as the user's choice (§29); search engines are on the warning list, and a CAPTCHA stops it and hands over to the user. The old free mode, which scraped search engines in the background on every task, is dropped.
- **8 Nov 2026, hosting:** sites the app builder publishes (6.15) go to the **user's own Vercel, Netlify or Cloudflare account**, connected as the user with a guided setup; they own the site and pay their host. **Share links** (17.13) stay on our cloud, so we're a hosting service for them under the EU Digital Services Act: a **Report** button on every shared page, a takedown process with a contact point, and our content rules in the terms. Built in phase 4.

## 31. Paid services

- **8 Nov 2026:** **only OpenRouter goes through our credits** (models and web search; confirmed by OpenRouter, §12). **Every other paid service is the user's own account:** they sign up, pay the provider directly, and connect it to Titan117. This settles the contradiction between §12 and §15.
- Covers, among others: AI video and images beyond OpenRouter (fal.ai, Replicate), SEO data (DataForSEO, SERP APIs), device farms (BrowserStack), hosting (§30), email sending (Brevo, Amazon SES, Mailgun, Postmark), X and WhatsApp (§15), ads and developer access (§28).
- **We make it easy** (the "connect your own" pattern, §15 and §28): a "you need this first" card (1.17) when a task needs the service, saying what it's for, what it roughly costs and whether there's a free tier; a step-by-step guide with screenshots and direct links; a connection test; keys in the keychain; the provider's limits and costs shown before a task uses them.
- **Why:** no resale permission to chase per provider, no bills or abuse risk for us, and the user owns their account and data, as with other agent tools and automation platforms (OpenClaw, n8n, Zapier's own-account connections).
- **Free first, and the user's word wins (8 Nov 2026, feature 1.25):** a paid service is never required by default. Agents reach for free options first (local models, open-source tools, free tiers that allow commercial use, or building it themselves) and suggest a paid service only when it's clearly better, with the free alternative next to it. If the user says "no paid services", for a task or as a workspace setting, agents respect it, like Claude Code follows such an instruction, and say plainly when something can't be done for free. Examples: AI video clips become motion graphics made by the open-source video engine; keyword data becomes Search Console data; device farms become the local emulators; hosting uses a free tier.
- **Later, optional:** a provider moves into credits only if it allows reselling in writing (saved in `vendor-answers/`) and users ask for it.

## 11. Deleting data

To write in phase 2, as in Ninjathons: account deletion with a grace period, then a batched hard delete in our cloud, Clerk and payments. **Every new Convex table gets a row here when it's created.**

| Data | Tables | On account deletion |
|---|---|---|
| Remote control keys (planned, phase 15; decisions §23): each paired device's public key, its name and pairing time; never private keys or message content | `deviceKeys` | Deleted with the device and on account deletion |
| Product owner portal audit (planned, phase 5; decisions §23): which admin viewed or changed what, and when | `adminAudit` | Kept 2 years for accountability; user references removed on account deletion |
| Error reports (planned, phase 5; decisions §22): app and component versions, OS, feature, error, stack trace, redacted log lines, the user's note, a reference ID; grouped by signature | `errorReports`, `errorGroups` | Reports deleted after 90 days, and at once on account deletion; groups keep only counts and versions, with no user link |

---

## Open decisions

The full list, each with the phase that needs it and a leaning, is in the [feature map](brainstorming-feature-map.md#open-decisions). Before or during phase 0:

1. ~~GitHub organisation~~ Decided 7 Nov: the EcotechCore organisation owns all three repos (§6).
2. **Shell sandbox** on Windows and macOS, and the risky-command list: decide during phase 0, needed for phase 1.
3. **Trademark check** on "Titan117", and our own restyle of the eyes logo before beta (§9).
4. **Legal basics:** privacy policy and terms online with the web app basics (phase 2); GDPR deletion plan (§11); licence audit before launch.
5. ~~OpenRouter's OK~~ Confirmed 8 Nov (§12). Still open: one resale rule for every other paid service (§26, external-services.md), before phase 2.
