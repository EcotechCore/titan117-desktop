# Owner checklist

Everything waiting on the owner, in the order to do it. Gathered from every repo's progress log; last rewritten 15 Nov 2026 after phase 4's leftovers and the first part of phase 5. Shared doc: edited in `titan117-web`, copied to the other repos. When an item is done, tick it here and add a line to `progress.md`; when the build adds a new one, it goes here in the same commit.

**Where the code is:** nothing is pushed yet. Every piece is a local branch, stacked in this order in all three repos: `phase-4` (`phase-4-docs` in the portal) → `phase-5-error-reports` → `phase-5-setup` → `phase-5-offline` → `phase-5-awake` → `phase-5-installer` → `phase-4-leftovers`. The last branch holds everything.

## Step 1 · Push and review (about an hour)

- [ ] **Push the branches and open the pull requests** (or ask Claude to): one pull request per repo from `phase-4-leftovers` holds all of it; or one per branch for smaller reviews.
- [ ] **Deploy the web app and Convex to production** once merged, so the desktop app's share links, error reports and comments reach real routes (the development deployment already has the Convex functions).

## Step 2 · Confirm the decisions (about an hour of reading)

Each is in `docs/notes/decisions.md`, marked "to be confirmed". Any one can be changed on its own; say which.

- [ ] **§44, web search and artifacts:** credits search through OpenRouter's search tool on Exa (about 1 credit a search); own keys for Exa, Tavily and Brave; **Serper dropped** (scraped Google results); Brave results never cached (their terms); **robots.txt respected for single pages too**; a 15-minute cache in memory; deep research with 60 steps, 30 minutes and $2; artifacts change without asking (every version kept); PDF through Electron's print; share links for anyone with the link (5 MB each, 100 in all, 30 a day); Mermaid's ELK layout left out (EPL or GPL).
- [ ] **§45, error reports:** sent through our web app (not the phase 15 bridge); any signed-in device, 20 a day; the home folder shown as `~`; "send automatically" at most once a minute; native crash dumps never sent.
- [ ] **§46, setup and health:** the three-step first-launch wizard; your chosen uses decide what the checklist asks for; the health check doesn't try search keys (that costs a search); disk warning under 10 GB, problem under 2 GB.
- [ ] **§47, offline:** noticed from failed requests plus a check every 20 seconds; cloud tasks stop and offer a local model; dropped connections aren't error reports; reports and the licence lease catch up when back online.
- [ ] **§48, keep awake, checkpoints and notifications:** tasks resume by themselves at most twice within an hour; an unfinished step is answered "not run to the end", never repeated silently; notifications only when the window is in the background.
- [ ] **§49, the Windows installer:** no CUDA back end (Vulkan covers NVIDIA, AMD and Intel); trimmed to 693 MB installed, 211 MB to download (235 MB with Microsoft's runtime); Microsoft's runtime installer run only when needed.
- [ ] **§50, phase 4 leftovers and auto-update:** ZIP downloads; the browser tool never downloads programs or scripts, 200 MB at most; comments on shared pages open to anyone with the link (100 a day per page; you can hide them); auto-update off until signing and an update address exist.
- [ ] **Phase 5 started before phase 4's check passed**, at your request on 15 Nov 2026: confirm that stands.
- [ ] **Whether the repos stay public.**

## Step 3 · Try it yourself (an afternoon)

Signed in to the desktop app with your plan:

- [ ] **Phase 4's check (closes phase 4):** turn on Deep research, ask for a real report (for example "Research e-invoicing rules in Romania"), download it as PDF, Word and Excel, press Share, open the link in a browser, leave a comment and send a test report with the Report button. Then, in the app, see the comment, reply, and try "Apply with Titan".
- [ ] **Report a problem:** send one and check a `T117-…` reference appears.
- [ ] **Turn off Wi-Fi** with the app open: the Offline banner, a cloud task stopping with "Continue with … (local)" (download a local model first), and both clearing when Wi-Fi is back.
- [ ] **A notification:** start a task, switch to another window, wait for "Titan finished".
- [ ] Search with your own Exa, Tavily or Brave key, if you have one (optional).
- [ ] The microphone button with your own microphone (phase 3).

## Step 4 · Accounts and services

- [ ] **Clerk Pro, two-factor required for staff, then remove `PORTAL_TWO_FACTOR`** (decisions §37). Unblocks the portal's error-report screens (phase 5) and later remote control (phase 15).
- [ ] **A Windows code signing certificate.** Needed sooner than planned: Windows' Smart App Control blocks our unsigned installer outright (it did on this laptop on 15 Nov 2026), and auto-update only installs updates signed by the same publisher.
- [ ] **Where updates are published** (an HTTPS address for signed releases, for example a GitHub release or our own storage); then set `PRODUCTION.updateUrl` in `src/main/index.ts` of the desktop app.
- [ ] Once signed: **install on a clean Windows** (a virtual machine without the Visual C++ runtime) to see Microsoft's runtime step run.
- [ ] Mailboxes `support@`, `privacy@` and **`abuse@titan117.com`** (the Digital Services Act contact point for shared pages), or change the addresses in `apps/web/content/legal.ts`.
- [ ] Stripe: the terms address in public details and "Successful payments" customer emails on, then switch on `STRIPE_REQUIRE_TERMS`.
- [ ] Hard spending caps on our OpenRouter account and every paid provider, alerts at 50% and 80% (guardrails §3).
- [ ] A separate domain for shared pages, so shared content never runs under titan117.com (decisions §44).
- [ ] Read access to `@ecotechcore/titan117-shared` for the desktop and portal repos (when they first install it).

## Step 5 · Legal and business (before launch)

- [ ] Company details on the legal pages: registered name, registration number, VAT number, address (`apps/web/content/legal.ts`).
- [ ] The Romanian lawyer's review of the legal pages, now including the content rules, takedown process and **comments** for shared pages.
- [ ] **Stripe's written OK** that our credits are allowed (before live mode).
- [ ] The trademark lawyer's short opinion, then file the EU trademark "TITAN117" in classes 9 and 42 (decisions §33.7).
- [ ] One resale rule for every paid service other than OpenRouter (open decision 5; the default today is the user's own account, §31).
- [ ] Visual C++ redistributable: shipping it is allowed under a Visual Studio licence (Community is free for small companies); confirm one is in place. Already fetched with your OK: 14.44.35211, signed by Microsoft.

## Step 6 · Waiting on vendors

- [ ] Google's app verification for Gmail, Calendar, Drive and Docs, and Microsoft's publisher verification for Outlook; until then the one inbox (3.6) and Google Docs, Sheets and Slides downloads (17.25) wait.

## Step 7 · Before external testers and the public beta

- [ ] macOS: a Mac to build and test every phase so far.
- [ ] Clerk production instances on our own domain; production web and Convex addresses and the production lease key in the desktop build (phase 18).
- [ ] An OS sandbox for commands on Windows, revisited (decisions §43.1).
- [ ] The external penetration test; critical and high findings fixed (phase 18).
- [ ] Node's built-in SQLite against better-sqlite3, revisited (§38).

## Done

- [x] OK to download Microsoft's Visual C++ redistributable (15 Nov 2026).
