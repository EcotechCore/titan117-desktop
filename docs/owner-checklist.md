# Owner checklist

Everything waiting on the owner (decisions, checks, accounts, legal), gathered from every repo's progress log on 15 Nov 2026. Shared doc: edited in `titan117-web`, copied to the other repos. When an item is done, tick it here and add a line to `progress.md`; when the build adds a new one, it goes here in the same commit.

Each item says **when it's needed**. "Now" means a phase can't close without it.

## 1. Decisions to confirm

- [ ] **Decisions §44, phase 4** (now). Each can be changed on its own:
  - Search through credits is OpenRouter's search tool on Exa ($0.007 a search, about 1 credit); own keys for **Exa, Tavily and Brave**.
  - **Serper is dropped**: its terms call its data scraped, and it resells Google's results.
  - **Brave results are never cached** (Brave's terms allow keeping results only on a plan with storage rights).
  - **robots.txt respected for single pages too**, not only whole-site reading (stricter than most tools; some pages will need the visible browser).
  - Cache 15 minutes, in memory only.
  - Deep research budget: 60 steps, 30 minutes, $2.
  - Making and changing artifacts doesn't ask (every version kept); saving one into a folder asks.
  - PDF through Electron's own print instead of Playwright's.
  - Share links: anyone with the link; 5 MB each, 100 in all, 30 a day; chosen people later.
  - Mermaid's ELK layout (EPL or GPL) left out; `Zlib` allowed in the licence check.
- [ ] **Is phase 5 allowed to run before phase 4 closes?** (now) Started early on 15 Nov 2026 at the owner's request; say if that should stand.
- [ ] **Whether the repos stay public** (before external testers).

## 2. Checks only the owner can run

- [ ] **Phase 4's check** (now): in the desktop app signed in with a plan, turn on Deep research and ask for a real report (for example "Research e-invoicing rules in Romania"). Then download it as PDF, Word and Excel, press Share, open the link in a browser, and send a test report with the Report button.
- [ ] Search with your own Exa, Tavily or Brave key, if you have one (optional).
- [ ] The microphone button with your own microphone (phase 3).
- [ ] macOS for every phase so far (needs a Mac; before external testers).

## 3. Accounts and services to set up

- [ ] **Clerk Pro, two-factor required for staff, then remove `PORTAL_TWO_FACTOR`** (before the portal shows any data in phase 5, decisions §37; remote control in phase 15 needs it too).
- [ ] Mailboxes `support@`, `privacy@` and **`abuse@titan117.com`** (`abuse@` is the Digital Services Act contact point for shared pages), or change the addresses in `apps/web/content/legal.ts` (before launch).
- [ ] Stripe: the terms address in public details and "Successful payments" customer emails on, then switch on `STRIPE_REQUIRE_TERMS` (before live payments).
- [ ] Hard spending caps on our OpenRouter account and every paid provider, alerts at 50% and 80% (before launch, guardrails §3).
- [ ] Read access to `@ecotechcore/titan117-shared` for the desktop and portal repos (when they first install it).
- [ ] Clerk production instances on our own domain; production web and Convex addresses and the production lease key in the desktop build (phase 18).
- [ ] A separate domain for shared pages, so shared content never runs under titan117.com (before launch, decisions §44).

## 4. Legal and business

- [ ] Company details on the legal pages: registered name, registration number, VAT number, address (`apps/web/content/legal.ts`).
- [ ] The Romanian lawyer's review of the legal pages, now including the content rules and takedown process for shared pages (before launch).
- [ ] **Stripe's written OK** that our credits are allowed (before live mode).
- [ ] The trademark lawyer's short opinion, then file the EU trademark "TITAN117" in classes 9 and 42 (before launch, decisions §33.7).
- [ ] One resale rule for every paid service other than OpenRouter (open decision 5; the default today is the user's own account, §31).

## 5. Waiting on vendors

- [ ] Google's app verification for Gmail, Calendar, Drive and Docs, and Microsoft's publisher verification for Outlook; until then the one inbox (3.6) and Google Docs, Sheets and Slides downloads (17.25) wait.

## 6. Before the public beta

- [ ] An OS sandbox for commands on Windows, revisited (decisions §43.1).
- [ ] The external penetration test; critical and high findings fixed (phase 18).
- [ ] Node's built-in SQLite against better-sqlite3, revisited (§38).

## Added by phase 5

- [ ] **Decisions §45, error reports** (before phase 5 closes): reports sent through our web app (not the phase 15 bridge); any signed-in device, 20 a day; home folder shown as `~`; automatic sending at most once a minute; native crash dumps never sent; no "attach this task" option until phase 6.
- [ ] **Decisions §46, setup and health** (before phase 5 closes): the three-step wizard, uses deciding the checklist, the health check leaving search keys untested, the disk thresholds.
- [ ] **Decisions §47, offline** (before phase 5 closes): offline noticed from failed requests and a 20-second check with OpenRouter; cloud tasks stop and offer a local model; dropped connections aren't error reports; reports and the lease catch up when online.
- [ ] **Turn off Wi-Fi once** with the app open: check the Offline banner, a cloud task stopping with "Continue with … (local)", and that it all clears when Wi-Fi is back (not checked in the real window: the network can't be cut from here without changing system settings).
- [ ] **Clerk Pro and required staff two-factor** (section 3) unblock the portal's error screens; until then reports are stored and grouped but only readable through Convex.
- [ ] Try it once signed in: Report a problem, Send, and check the reference appears (needs the web app with these routes deployed).
