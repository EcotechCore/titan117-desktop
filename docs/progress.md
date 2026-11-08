# Progress

Where the build stands against the phases in the [roadmap](01-launch-roadmap-v1.md). Update this file in the same commit as the work: change the phase table when a phase starts or finishes, and add a log entry, newest first.

**Now:** planning is done (feature map, architecture, guardrails, design, mockups, roadmap). **Next step:** phase 0, Setup, when you say so: the two repos, CI, the shared packages and an empty Electron app running on Windows. Nothing else is open before it.

## Phases

| # | Phase | Status | Started | Finished |
|---|---|---|---|---|
| 0 | Setup | Not started | | |
| 1 | Engine core | Not started | | |
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
