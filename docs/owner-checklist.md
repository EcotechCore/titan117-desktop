# Owner checklist

Everything waiting on the owner, in the order to do it. Gathered from every repo's progress log; last rewritten 15 Nov 2026 after phase 4's leftovers and the first part of phase 5. Shared doc: edited in `titan117-web`, copied to the other repos. When an item is done, tick it here and add a line to `progress.md`; when the build adds a new one, it goes here in the same commit.

**Where the code is:** everything up to phase 10 is merged into `main` in all three repos (22 Nov 2026); run the desktop app from `main` with `pnpm dev`. **Production waits** (decisions §52): everything is checked locally first.

## Step 1 · Push and review

- [x] ~~Push the branches and open the pull requests~~ Done and merged, 16 Nov 2026.

## Next · After phase 8 (put aside by the owner on 21 Nov 2026)

Nothing here blocks phase 8. Gathered here to do together once phase 8 is built.

- [ ] **§53, the coding engine (phase 7), items 3–9:** one OpenCode server per coding task with a password; its model steps through our router (a coding job's budget: 150 steps, $3); our approvals decide every command and change it makes, and it never remembers an "always" of its own; its own internet calls, plugins and repo or home settings switched off; Codex and Cursor stay experimental. (Items 1 and 2, shipping OpenCode unchanged and downloading it on first use, you decided on 20 Nov 2026.)
- [ ] **§54, git and the code builder screen (phase 7):** commits as you with a `Co-authored-by: Titan117` line; never a force-push, a push to the main branch or a commit carrying secrets; pushes and pull requests ask every time; pull requests through GitHub's CLI or GitHub's own page until the app is registered; project memory per repository; the code review changes nothing; open in VS Code or Cursor (items 9–13).
- [ ] **§55, the rest of phase 7:** Claude Code on your own plan with every action through our approvals; Codex, Cursor's agent and Grok experimental and off by default; Antigravity and Gemini CLI not offered; the kill switch; commands on your own servers over SSH; Sign in with GitHub ready for the app; OpenCode in Seatbelt on macOS; JetBrains in Open in.
- [ ] **A Windows code signing certificate: you start on Monday 23 Nov 2026** (a reminder is set for that morning). Needed sooner than planned: Windows' Smart App Control blocks our unsigned installer outright (it did on this laptop on 15 Nov 2026), and auto-update only installs updates signed by the same publisher.
- [ ] **Accept Anthropic's Commercial Terms** for running Claude Code inside Titan117 (decisions §20, §55), before the beta.
- [ ] **Ask Modal in writing** whether Titan117 users may run jobs on their own Modal accounts through our app (their terms limit use to the customer's own internal business; decisions §53.9). Needed before cloud sandboxes (3.15) are built, later in phase 7.
- [ ] **Phase 7's check, done on 20 Nov 2026:** look at the pull requests the code builder opened, [#5](https://github.com/ispasdani/titan117-sample-shop/pull/5) (phase 7's check) and [#6](https://github.com/ispasdani/titan117-sample-shop/pull/6) (your first through Sign in with GitHub), in the private sample repo `ispasdani/titan117-sample-shop`, then merge or close it as you like. Also try the Code screen yourself on a project of your own: a job with Plan first, then Build, and Review the changes.
- [ ] **Decide: send Claude Code jobs straight to Claude Code** (an improvement, not built yet). Today, when you pick Claude Code, Titan's own model still reads your request and writes the summary, which costs a little credit. With this, a job started from the Code screen with Claude Code would go to it directly, and its own answer would be the reply: no credits at all. Say yes and it gets built.

## Phase 8 · The app builder for the web (started 21 Nov 2026)

Nothing here blocks the next part of phase 8 except where it says so.

- [ ] **Try the Apps screen** (the desktop app from `main`, with `pnpm dev`): allow a folder, open **Apps**, make a site with a name, a sentence about it and what to build first. Approve the plan when its card shows it, then look at the **Preview** at phone, tablet and desktop size, the **Test report** with a screenshot per browser and size, and **Versions** (try "Go back to this"). The first build downloads Node.js (41 MB) and the test browsers (about 250 MB) once.
- [ ] **Decisions §56** (to be confirmed, with §53–§55 after phase 8): Node.js downloaded on first use; npm without install scripts or your `.npmrc`; the web template; a plan you approve covers that build's file changes and checks; up to three fixes with a stronger model after repeated failures; Firefox and WebKit downloaded by Playwright itself (it checks no hash, only HTTPS); Chromium is your own Edge or Chrome; a tested page reaches only its own preview.
- [x] **Let Titan117 make repositories for Save to GitHub** (owner, 21 Nov 2026: "Repository creation" set to Read and write, saved and accepted; GitHub's API shows `repository_creation: write`): in the GitHub App's settings (github.com/organizations/EcotechCore/settings/apps/titan117-by-ecotechcore, Permissions), set **Repository permissions → "Repository creation": Read and write** if it's offered, otherwise "Administration": Read and write, and save. GitHub then asks each user who installed the app (you too) to accept the new permission. Until then, Save to GitHub sends you to GitHub's page to make the empty repository yourself, which works too.
- [ ] **Try Save to GitHub once** with a site from the Apps screen (signed in with GitHub on the Code screen): it should end up as a private repository in your account. Tell Claude if GitHub refuses the push, so the "Only select repositories" case can be settled.
- [ ] **Publish one site for real** (the last part of phase 8's check): in Cloudflare, create an API token with the **"Edit Cloudflare Workers"** template (My Profile → API Tokens), and open Workers & Pages once so the account has a workers.dev address. In the app: Apps → Your hosting → Cloudflare → Add key, then Publish on a site. Tell Claude what happens; the upload's details the docs only show by example are confirmed by this first real publish.
- [ ] **Optional: publish from GitHub** once a site is saved there: on the Apps screen, under GitHub → Publish from GitHub, follow the steps for Cloudflare, Netlify or Vercel. Each later version is then published by the host itself. Tell Claude if Cloudflare opens its own set-up pull request.
- [ ] **Ask Convex in writing** (platforms@convex.dev) before the user's own Convex backend is built: may Titan117, a desktop app that builds websites on the user's laptop, create projects in the user's own Convex team through Convex's OAuth (as a public client without a secret, with PKCE), and does §4.4 of their terms ("application builders may embed the Software … solely on serverless instance types designated by Convex") apply when the user owns the account?
- [ ] **Try the new Apps features:** a kind of site when making one, Your brand (colours, font, tone, logo), Edit visually on the preview, Download ZIP.
- [ ] **Models for builds:** on the Apps screen, optionally set a planner, a coder and a fixer (for example a strong model to plan and fix, a cheaper one to code). Empty uses the task's model. Our own defaults come from the five sample apps, later in phase 8.
- [ ] **Before Netlify publishing is built: register our Netlify OAuth app** at app.netlify.com/applications ("Titan117 by EcotechCore"), because Netlify requires OAuth for public integrations. Claude will give the exact settings when it gets there.
- [ ] **Ask Vercel in writing** whether a desktop app may deploy to the user's own Vercel account with a token the user creates (their API Terms forbid an application receiving end users' tokens, and their Hobby plan is non-commercial). Until they answer, Vercel isn't offered; Cloudflare and Netlify are. A short message is enough: "Titan117 is a desktop app that builds websites on the user's laptop. May it deploy them to the user's own Vercel account, with an access token the user creates and keeps in their OS keychain (never on our servers), or through Sign in with Vercel with deployment permissions?"

## Phase 9 · The app builder for mobile and desktop (started 21 Nov 2026)

Nothing here blocks phase 8's last steps. What's built (mobile apps with Expo, Expo Go on your phone, the laptop check, and desktop apps with Tauri up to the installer) is merged into `main`.

- [ ] **Try a mobile app** (the desktop app from `main`, with `pnpm dev`): Apps → New app → **Mobile app (iPhone and Android)**, a name, a sentence and what to build first. Approve the plan, then look at the Preview and the Test report (phone sizes in Chromium and WebKit).
- [ ] **Try a desktop app:** Apps → New app → **Desktop app (Windows and Mac)**, then Preview (Desktop size) and Test it. Making its Windows installer needs the two installs below.
- [ ] **Try it on your phone:** install **Expo Go** (free, App Store or Google Play), put the phone on the same Wi-Fi as the laptop, press **Open on your phone** and scan the code (Android: in Expo Go; iPhone: with the Camera). If Windows asks whether Node.js may use networks, allow **private networks** only. Tell Claude whether it opened on Android and on an iPhone (that's half of phase 9's check).
- [ ] **Decisions §57** (to be confirmed): Expo for mobile apps with no Expo account and nothing sent to Expo; Expo Go on the same Wi-Fi only, asking every time, never Expo's public tunnel; the laptop check; the plan for the emulator, Tauri (NSIS installers, not WiX), Windows Sandbox, Podman before Docker, Maestro with its own Java; Expo EAS, store publishing and device farms only after written answers.
- [ ] **Turn on two Windows features on this laptop**, for the Android emulator and the clean-Windows test (Titan117 only checks them, it can't switch them on): Start → type **Turn Windows features on or off** → tick **Windows Hypervisor Platform** and **Windows Sandbox** → OK → restart. Apps → This laptop → Check again should then show both as ready.
- [ ] **Set up the Android emulator** (after Windows Hypervisor Platform is on): Apps → This laptop → **Download Google's tools** → **Read Google's licence** → accept it if you agree (your decision, for Ecotechcore) → **Install the emulator** (about 3 GB) → **Start the phone**. In the phone, sign in to Google Play and install **Expo Go**. Then on a mobile app press **Open in the emulator**. Tell Claude what happened (phase 9's check).
- [ ] **Make a desktop installer and try it in a clean Windows** (after the Build Tools and Rust below, and Windows Sandbox): on a desktop app press **Make the installer**, then **Try it in a clean Windows**. Tell Claude whether the app opened (phase 9's check).
- [ ] **Desktop apps (Tauri) need two installs on this laptop, after one licence check:** Microsoft's **Build Tools for Visual Studio** with "Desktop development with C++" (visualstudio.microsoft.com/visual-cpp-build-tools), then **Rust** (rustup.rs). First confirm Ecotechcore may use the Build Tools: Microsoft normally licenses them with Visual Studio, and Visual Studio Community is free for small companies (read the licence shown by the installer, or ask Claude to read it with you).
- [ ] **Ask Expo in writing** (before EAS cloud builds and store submission are built): may Titan117, a desktop app that helps a small company build its own mobile apps on its own laptop, run EAS Build and EAS Submit in that company's own Expo account with a token the company creates, given the acceptable use policy's "service bureau … including to build or deploy apps for third parties" and "competitive solution" lines? Our draft: the apps are the user's own, in their own account, paid on their own plan; Titan117 never builds for third parties.
- [ ] **Ask BrowserStack in writing** (before cloud devices are built): may a customer use their own BrowserStack account and access key from Titan117 to test their own apps, given §3.1 ("solely for its own benefit") and §3.3(b) (not incorporating the services into a product provided to a third party)? Firebase Test Lab's free plan is the free-first option meanwhile.
- [ ] **For phase 9's check later:** an Android phone (or the emulator once Windows Hypervisor Platform is on), and Windows Sandbox for the clean-Windows install. An iPhone simulator needs a Mac (already on the list below).
- [ ] **Store publishing later needs your own developer accounts**, only when you want to publish a mobile app: Apple Developer Program ($99 a year; as a company it needs a free D-U-N-S number), Google Play ($25 once; a new personal account must run a closed test with 12 testers for 14 days, a company account needs a D-U-N-S number). Apple's rule 4.2.6 means **you** submit the app in your account; Titan117 prepares it.
- [ ] **The licence review before launch also covers phase 9's downloads:** the Android emulator (Google's licence, which each user accepts; it contains QEMU under GPL v2, run unchanged), Eclipse Temurin for Maestro (GPL v2 with the Classpath Exception, run unchanged), and the mobile template's packages (MPL 2.0 lightningcss; node-forge used under BSD).

## Phase 10 · Sidebar apps (started 22 Nov 2026)

Nothing here blocks phases 8 and 9. Phase 10 is merged into `main` (22 Nov 2026) and done, except sync between devices, which waits for phase 15.

- [ ] **Try two sidebar apps** (the desktop app from `main`, with `pnpm dev`): Apps → New app → Website or web app → tick **An internal tool for the Titan117 sidebar**. Make an **Inventory** first (items with quantities and prices), then a **CRM** whose orders pick items from the inventory (say so in what to build first). Approve the plan and the **Add to the sidebar** card, which lists what the app may reach. Both then show under **Your apps** in the sidebar. Add a few records, then ask Titan something that needs both, for example "Which customers ordered items that are low in stock?" (phase 10's check).
- [ ] **Try the rest of phase 10:** ask Titan to give the CRM a "Draft follow-up" button that uses `titan.ai`; then on the Apps screen open the CRM, press **Review what it reaches** and **Update it** (the card says the AI costs credits). On the Inventory, press **Add a mobile app** and look at the new linked app.
- [ ] **Decisions §58** (to be confirmed): one local database per app as the shared data layer; an app reaches another app's data only as its `titan.json` asks and you agreed; the sidebar runs a checked build with no network; Titan reads the apps' data without asking and changes it with your OK; sync waits for phase 15 and will be end to end encrypted (Electric, Zero and PowerSync aren't used because their servers read the data; Evolu is the model); `titan.ai` limited to 100 questions a day per app, only with your OK; another target as a linked app sharing `src/shared/`; the sync core with AES-256-GCM, its transport after phase 15.

## Phase 11 · The agent builder (started 22 Nov 2026)

Nothing here blocks other phases. Run the desktop app from the `phase-11-agent-builder` branch until it's merged (then from `main`), with `pnpm dev`.

- [ ] **Try the three parts of phase 11's check:** (1) **Agents** (the **Manage** link beside "Agents" in the sidebar) → **New agent**: give it a name, a team, what it does, its tools and instructions, press **Make the agent**, then **Start a task**. (2) Ask Titan for a task with two separate parts, for example "Researcher should find X and Writer should draft Y; give me both": the task's details show **Parts handed out** and **Team talk**. (3) Ask Titan "I need an agent that …, with a skill for …": approve the card, and the agent appears in the sidebar under its team.
- [ ] **Try Compare models** (sidebar): one prompt on two to four models, with each answer's time and cost.
- [ ] **Decisions §59** (to be confirmed): agents as files with a header, built-ins cloned to change, a definition only narrows what an agent may do, parts handed to other agents (at most three at once, one level deep, their cost counted in the first task), the message bus kept on the laptop, smart routing (a fast model for the steps after the plan), Compare, Titan making agents and skills after one approval every time, and media (images and video through OpenRouter) as the next part.
- [ ] **Try images (2.7):** with the local web app running and the desktop signed in (so it uses credits), ask Titan "Make a square picture of … and save it as picture.png", approve the card, and check the file and the cost in the task's details. Models → **Images and video** picks the models. This path hasn't been tried end to end through credits yet; with the development key a real image cost $0.03.
- [ ] **Decide when to try a video clip:** a short clip can cost $0.25–$2 in credits, so none was made while building. The client, the proxy's job routes and the charging are tested with a fake provider.
- [ ] **Before production:** the proxy should also receive OpenRouter's signed webhook for video jobs, so a job nobody polls to the end is still charged (decisions §59.13).

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
- [ ] **The repos go private** (decided 20 Nov 2026; no rush). Your contribution graph keeps counting the commits if "Private contributions" is on in your GitHub profile settings; others see only the counts, not the repos.

## Step 3 · Try it yourself (an afternoon)

All of it runs on this laptop: the web app from the "web" preview (port 3100) against the development Convex deployment, the desktop app from source (`pnpm dev`), Stripe in test mode. Done by the owner on 19 Nov 2026: everything below worked, except two things fixed the same day (the full-screen artifact panel showed only its toolbar; read aloud had no controls, now Pause, Resume, speed and Stop). Signed in to the desktop app with your plan:

- [x] **Phase 4's check (closes phase 4):** turn on Deep research, ask for a real report (for example "Research e-invoicing rules in Romania"), download it as PDF, Word and Excel, press Share, open the link in a browser, leave a comment and send a test report with the Report button. Then, in the app, see the comment, reply, and try "Apply with Titan".
- [x] **Report a problem:** send one and check a `T117-…` reference appears.
- [x] **Turn off Wi-Fi** with the app open: the Offline banner, a cloud task stopping with "Continue with … (local)" (download a local model first), and both clearing when Wi-Fi is back.
- [x] **A notification:** start a task, switch to another window, wait for "Titan finished".
- [x] **Phase 6's check (the folder agent):** turn on a folder of your own real documents (contracts, invoices, offers) in Documents, ask questions whose answers you know, and see that the answers cite the right file and page. Also mark a folder "Local models only" and check that a cloud model task stops and offers a local model.
- [ ] **Sign in with GitHub in the app** (Code screen → GitHub → Sign in with GitHub, enter the code on GitHub's page), then **Choose repositories** for the ones Titan may open pull requests in. Ask Titan for a small change in one of them and a pull request.
- [ ] **Try your own coding tools, if you use them:** install Claude Code (and sign in with `claude auth login`), then on the Code screen choose it as the engine for a job. Codex, Cursor's agent and Grok work the same once turned on there (experimental). Also add one of your servers under Your servers and ask Titan to run `uptime` on it.
- [ ] Search with your own Exa, Tavily or Brave key, if you have one (optional).
- [x] The microphone button with your own microphone (phase 3).

## Step 4 · Accounts and services

- [ ] **Phase 5's check needs** (noted 20 Nov 2026), besides the certificate below: a Mac to build and test on; a clean Windows machine (a virtual machine is fine) to run the install from download to first task; and the 14-day offline test (the app works offline, then locks on day 15). Local first: none of it is urgent.

- [ ] **Clerk Pro, two-factor required for staff, then remove `PORTAL_TWO_FACTOR`** (decisions §37). Unblocks the portal's error-report screens (phase 5) and later remote control (phase 15). **Waits** (owner, 20 Nov 2026): nothing is paid for until the app runs locally without issues.
- [ ] **Where updates are published** (an HTTPS address for signed releases, for example a GitHub release or our own storage); then set `PRODUCTION.updateUrl` in `src/main/index.ts` of the desktop app.
- [ ] Once signed: **install on a clean Windows** (a virtual machine without the Visual C++ runtime) to see Microsoft's runtime step run.
- [x] ~~Register our GitHub App~~ Done 21 Nov 2026: "Titan117 by EcotechCore", device flow on, client ID in the app.
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
- [ ] **Videos for the website's home page and Learn lessons** (placeholders since phase 2), or say who makes them.
- [ ] **The licence review before launch includes OpenCode's program:** OpenCode is MIT, and its Bun runtime contains JavaScriptCore (LGPL-2), shipped unchanged with its notices (decisions §53.1).
- [ ] **The licence review also covers the app builder's downloads** (decisions §56): Node.js (MIT) and npm (Artistic 2.0 with permissive packages), and the test browsers Playwright downloads itself: Firefox (MPL 2.0), WebKit (LGPL 2 and BSD) and its ffmpeg (LGPL 2.1). All are downloaded to the user's laptop unchanged and run as separate programs; we ship none of them.
- [ ] Visual C++ redistributable: shipping it is allowed under a Visual Studio licence (Community is free for small companies); confirm one is in place. Already fetched with your OK: 14.44.35211, signed by Microsoft.

## Step 6 · Waiting on vendors

- [ ] **Not needed now; only when the one inbox (3.6) and Google Docs downloads (17.25) are built.** Google's app verification for Gmail, Calendar, Drive and Docs, and Microsoft's publisher verification for Outlook. Both are free; what decisions §27 avoids is Google's *paid* yearly security assessment, not this verification. It's needed only because Titan signs in to Gmail through our own Google app for every user (unverified: a warning screen and at most 100 test users). Until then Gmail works through IMAP with an app password, and testers use Google's testing mode.

## Step 7 · Before external testers and the public beta

- [ ] **Production, postponed (decisions §52):** a Clerk production instance on titan117.com with its webhook to Convex production's `/clerk`; Convex production's environment (`CLERK_FRONTEND_API_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PROXY_SECRET`, `LEASE_PRIVATE_KEY`, `SITE_URL`); Stripe live mode after their written OK (`node scripts/stripe-setup.mjs --webhook <production site>/stripe`); a Vercel project from `titan117-web` (root `apps/web`) with its keys and titan117.com. Then Claude runs the Convex production deploy and checks the live routes.

- [ ] macOS: a Mac to build and test every phase so far, including OpenCode inside Seatbelt (decisions §55.10).
- [ ] **Our own redraw of the eyes logo** before the beta (open decision 3, decisions §9), so the mark is ours before the trademark is filed.
- [ ] Clerk production instances on our own domain; production web and Convex addresses and the production lease key in the desktop build (phase 18).
- [ ] An OS sandbox for commands on Windows, revisited (decisions §43.1).
- [ ] The external penetration test; critical and high findings fixed (phase 18).
- [ ] Node's built-in SQLite against better-sqlite3, revisited (§38).

## Done

- [x] OK to download Microsoft's Visual C++ redistributable (15 Nov 2026).
