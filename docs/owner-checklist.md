# Owner checklist

Everything waiting on the owner, in the order to do it. Gathered from every repo's progress log; last rewritten 15 Nov 2026 after phase 4's leftovers and the first part of phase 5. Shared doc: edited in `titan117-web`, copied to the other repos. When an item is done, tick it here and add a line to `progress.md`; when the build adds a new one, it goes here in the same commit.

**Where the code is:** everything up to phase 6's first part is merged into `main` in all three repos (16 Nov 2026). **Production waits** (decisions §52): everything is checked locally first.

## Step 1 · Push and review

- [x] ~~Push the branches and open the pull requests~~ Done and merged, 16 Nov 2026.

## Step 2 · Confirm the decisions (about an hour of reading)

All confirmed by the owner on 18 Nov 2026 (decisions §44–§51), with one addition: Titan searches in the browser when asked to search on Google or another engine (§44.12).

- [x] **§44, web search and artifacts:** credits search through OpenRouter's search tool on Exa (about 1 credit a search); own keys for Exa, Tavily and Brave; **Serper dropped** (scraped Google results); Brave results never cached (their terms); **robots.txt respected for single pages too**; a 15-minute cache in memory; deep research with 60 steps, 30 minutes and $2; artifacts change without asking (every version kept); PDF through Electron's print; share links for anyone with the link (5 MB each, 100 in all, 30 a day); Mermaid's ELK layout left out (EPL or GPL).
- [x] **§45, error reports:** sent through our web app (not the phase 15 bridge); any signed-in device, 20 a day; the home folder shown as `~`; "send automatically" at most once a minute; native crash dumps never sent.
- [x] **§46, setup and health:** the three-step first-launch wizard; your chosen uses decide what the checklist asks for; the health check doesn't try search keys (that costs a search); disk warning under 10 GB, problem under 2 GB.
- [x] **§47, offline:** noticed from failed requests plus a check every 20 seconds; cloud tasks stop and offer a local model; dropped connections aren't error reports; reports and the licence lease catch up when back online.
- [x] **§48, keep awake, checkpoints and notifications:** tasks resume by themselves at most twice within an hour; an unfinished step is answered "not run to the end", never repeated silently; notifications only when the window is in the background.
- [x] **§49, the Windows installer:** no CUDA back end (Vulkan covers NVIDIA, AMD and Intel); trimmed to 693 MB installed, 211 MB to download (235 MB with Microsoft's runtime); Microsoft's runtime installer run only when needed.
- [x] **§50, phase 4 leftovers and auto-update:** ZIP downloads; the browser tool never downloads programs or scripts, 200 MB at most; comments on shared pages open to anyone with the link (100 a day per page; you can hide them); auto-update off until signing and an update address exist.
- [x] **§51, the folder agent (phase 6):** document folders read-only for agents by default; reading in Node only (no Python: Docling and MarkItDown not used); citations by page, or by section heading for Word; search with word stems plus meaning (multilingual-e5-small, MIT, about 120 MB downloaded once); a task that touched a local-models-only folder never goes back to a cloud model.
- [x] **OCR for scanned documents:** decided 20 Nov 2026: the language files ship inside the app (decisions §51.8). Built the same day.
- [x] **Phase 5 started before phase 4's check passed**, at your request on 15 Nov 2026: confirm that stands.
- [ ] **§53, the coding engine (phase 7), items 3–9:** one OpenCode server per coding task with a password; its model steps through our router (a coding job's budget: 150 steps, $3); our approvals decide every command and change it makes, and it never remembers an "always" of its own; its own internet calls, plugins and repo or home settings switched off; Codex and Cursor stay experimental. (Items 1 and 2, shipping OpenCode unchanged and downloading it on first use, you decided on 20 Nov 2026.)
- [ ] **The repos go private** (decided 20 Nov 2026; no rush). Your contribution graph keeps counting the commits if "Private contributions" is on in your GitHub profile settings; others see only the counts, not the repos.

## Step 3 · Try it yourself (an afternoon)

All of it runs on this laptop: the web app from the "web" preview (port 3100) against the development Convex deployment, the desktop app from source (`pnpm dev`), Stripe in test mode. Done by the owner on 19 Nov 2026: everything below worked, except two things fixed the same day (the full-screen artifact panel showed only its toolbar; read aloud had no controls, now Pause, Resume, speed and Stop). Signed in to the desktop app with your plan:

- [x] **Phase 4's check (closes phase 4):** turn on Deep research, ask for a real report (for example "Research e-invoicing rules in Romania"), download it as PDF, Word and Excel, press Share, open the link in a browser, leave a comment and send a test report with the Report button. Then, in the app, see the comment, reply, and try "Apply with Titan".
- [x] **Report a problem:** send one and check a `T117-…` reference appears.
- [x] **Turn off Wi-Fi** with the app open: the Offline banner, a cloud task stopping with "Continue with … (local)" (download a local model first), and both clearing when Wi-Fi is back.
- [x] **A notification:** start a task, switch to another window, wait for "Titan finished".
- [x] **Phase 6's check (the folder agent):** turn on a folder of your own real documents (contracts, invoices, offers) in Documents, ask questions whose answers you know, and see that the answers cite the right file and page. Also mark a folder "Local models only" and check that a cloud model task stops and offers a local model.
- [ ] Search with your own Exa, Tavily or Brave key, if you have one (optional).
- [x] The microphone button with your own microphone (phase 3).

## Step 4 · Accounts and services

- [ ] **Phase 5's check needs** (noted 20 Nov 2026), besides the certificate below: a Mac to build and test on; a clean Windows machine (a virtual machine is fine) to run the install from download to first task; and the 14-day offline test (the app works offline, then locks on day 15). Local first: none of it is urgent.

- [ ] **Clerk Pro, two-factor required for staff, then remove `PORTAL_TWO_FACTOR`** (decisions §37). Unblocks the portal's error-report screens (phase 5) and later remote control (phase 15). **Waits** (owner, 20 Nov 2026): nothing is paid for until the app runs locally without issues.
- [ ] **A Windows code signing certificate: you start on Monday 23 Nov 2026** (a reminder is set for that morning). Needed sooner than planned: Windows' Smart App Control blocks our unsigned installer outright (it did on this laptop on 15 Nov 2026), and auto-update only installs updates signed by the same publisher.
- [ ] **Where updates are published** (an HTTPS address for signed releases, for example a GitHub release or our own storage); then set `PRODUCTION.updateUrl` in `src/main/index.ts` of the desktop app.
- [ ] Once signed: **install on a clean Windows** (a virtual machine without the Visual C++ runtime) to see Microsoft's runtime step run.
- [ ] **Register our GitHub App** under the EcotechCore organisation (needed for pull requests in phase 7, decisions §25): Settings → Developer settings → GitHub Apps → New. Turn on **device flow**; no webhook; no client secret needed; "Expire user authorization tokens" on. Permissions (repository): Contents read and write, Pull requests read and write, Metadata read. Then send me the app's **client ID** (it isn't secret).
- [ ] Mailboxes `support@`, `privacy@` and **`abuse@titan117.com`** (the Digital Services Act contact point for shared pages), or change the addresses in `apps/web/content/legal.ts`.
- [ ] Stripe: the terms address in public details and "Successful payments" customer emails on, then switch on `STRIPE_REQUIRE_TERMS`.
- [ ] Hard spending caps on our OpenRouter account and every paid provider, alerts at 50% and 80% (guardrails §3).
- [ ] A separate domain for shared pages, so shared content never runs under titan117.com (decisions §44).
- [ ] Read access to `@ecotechcore/titan117-shared` for the desktop and portal repos (when they first install it).

## Step 5 · Legal and business (before launch)

- [ ] Company details on the legal pages: registered name, registration number, VAT number, address (`apps/web/content/legal.ts`).
- [ ] **Ask Modal in writing** whether Titan117 users may run jobs on their own Modal accounts through our app (their terms limit use to the customer's own internal business; decisions §53.9). Needed before cloud sandboxes (3.15) are built, later in phase 7.
- [ ] The Romanian lawyer's review of the legal pages, now including the content rules, takedown process and **comments** for shared pages.
- [ ] **Stripe's written OK** that our credits are allowed (before live mode).
- [ ] The trademark lawyer's short opinion, then file the EU trademark "TITAN117" in classes 9 and 42 (decisions §33.7).
- [ ] One resale rule for every paid service other than OpenRouter (open decision 5; the default today is the user's own account, §31).
- [ ] **Videos for the website's home page and Learn lessons** (placeholders since phase 2), or say who makes them.
- [ ] **The licence review before launch includes OpenCode's program:** OpenCode is MIT, and its Bun runtime contains JavaScriptCore (LGPL-2), shipped unchanged with its notices (decisions §53.1).
- [ ] Visual C++ redistributable: shipping it is allowed under a Visual Studio licence (Community is free for small companies); confirm one is in place. Already fetched with your OK: 14.44.35211, signed by Microsoft.

## Step 6 · Waiting on vendors

- [ ] **Not needed now; only when the one inbox (3.6) and Google Docs downloads (17.25) are built.** Google's app verification for Gmail, Calendar, Drive and Docs, and Microsoft's publisher verification for Outlook. Both are free; what decisions §27 avoids is Google's *paid* yearly security assessment, not this verification. It's needed only because Titan signs in to Gmail through our own Google app for every user (unverified: a warning screen and at most 100 test users). Until then Gmail works through IMAP with an app password, and testers use Google's testing mode.

## Step 7 · Before external testers and the public beta

- [ ] **Production, postponed (decisions §52):** a Clerk production instance on titan117.com with its webhook to Convex production's `/clerk`; Convex production's environment (`CLERK_FRONTEND_API_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PROXY_SECRET`, `LEASE_PRIVATE_KEY`, `SITE_URL`); Stripe live mode after their written OK (`node scripts/stripe-setup.mjs --webhook <production site>/stripe`); a Vercel project from `titan117-web` (root `apps/web`) with its keys and titan117.com. Then Claude runs the Convex production deploy and checks the live routes.

- [ ] macOS: a Mac to build and test every phase so far.
- [ ] **Our own redraw of the eyes logo** before the beta (open decision 3, decisions §9), so the mark is ours before the trademark is filed.
- [ ] Clerk production instances on our own domain; production web and Convex addresses and the production lease key in the desktop build (phase 18).
- [ ] An OS sandbox for commands on Windows, revisited (decisions §43.1).
- [ ] The external penetration test; critical and high findings fixed (phase 18).
- [ ] Node's built-in SQLite against better-sqlite3, revisited (§38).

## Done

- [x] OK to download Microsoft's Visual C++ redistributable (15 Nov 2026).
