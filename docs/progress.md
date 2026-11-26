# Progress

Where the build stands against the phases in the [roadmap](01-launch-roadmap-v1.md). Update this file in the same commit as the work: change the phase table when a phase starts or finishes, and add a log entry, newest first.

**Now:** phase 7 is done (21 Nov 2026), apart from what waits outside the code: the GitHub App's client ID, Modal's answer (cloud sandboxes), a Mac (Seatbelt) and remote coding tasks (phase 15). Phase 5 waits for code signing (the owner starts on Monday 23 Nov 2026), a Mac, a clean Windows machine, the 14-day offline test and, once paying, Clerk Pro. **Phase 8 started (21 Nov 2026):** its first part works in the built app: make a web app, a plan you approve, the build, checks in Chromium, Firefox and WebKit at three sizes, fixes, a test report, versions and a live preview. **Since then (21 Nov 2026):** Save to GitHub, ZIP export, more test conditions, starters and a brand kit, visual edit and Cloudflare publishing are built, and the five sample apps all pass. **Phase 9 started (21 Nov 2026):** the phase-start review is recorded (decisions §57), and mobile apps with Expo work in the built app: made and built by Titan, previewed and tested at phone sizes, and opened on a phone with Expo Go; a laptop check says what's needed for the emulator, clean-Windows tests and desktop apps. **Phase 10 started (22 Nov 2026):** sidebar apps work in the built app: Titan built an Inventory and a CRM that reads the inventory's items, both run sandboxed in the sidebar with their data on the laptop, and Titan answered a question across both (phase 10's check, seen working; decisions §58 to be confirmed). **Since then (22 Nov 2026):** `titan.ai`, another target per project and the sync core are built and seen working; phase 10 is done apart from sync's transport, which needs phase 15's device keys. **Phase 11 started (22 Nov 2026):** agents as files, built-ins with clone and edit, the Agents form, parts handed between agents, Titan making agents and skills, smart routing and Compare work in the built app (phase 11's check seen working; decisions §59 to be confirmed); images and video are built too, a real image seen made; phase 11 is done and merged. **Phase 12 started (22 Nov 2026):** the phase-start review is recorded (decisions §60), and the QA tester and the SEO agent work in the built app: both ran end to end on a real public site and their reports downloaded as PDF, Word and Excel (phase 12's check, seen working). Search Console waits for our Google sign-in app; keyword data on the user's own account comes later. **Phase 13 started (24 Nov 2026):** the phase-start review is recorded (decisions §61), and schedules in plain words, web watches and recordings that replay without AI work in the built app: a recorded task replayed on a schedule (the first half of phase 13's check, seen working). The law watcher on a real change in a law page isn't seen yet (it needs a day between checks); computer use and recording other desktop apps aren't built. **Since then (24 Nov 2026):** triggers (a new file in a folder starts a task), ready-made schedules, and watches that read feeds (EUR-Lex through its official RSS) or read in the browser are built and seen working. **Phase 14 started (24 Nov 2026):** the phase-start review is recorded (decisions §62), and the brand kit, a content calendar of ready-to-post posts with Copy and open and "Time to post" reminders, and promo videos drawn on the laptop work: from a small company site the Video maker made a video with a voiceover in two shapes and the Marketing agent a month of posts (the first half of phase 14's check, seen working). Then campaign reports, tracked links, ad drafts (a paused Google Ads Editor file and a Meta sheet), lead finding and review watching were added and seen working. **Since then (25 Nov 2026):** newsletters and sequences through the user's own Brevo or Postmark account, visits of published sites counted in the user's own Cloudflare account, and AI clips and camera moves in the video studio are built (decisions §63); everything phase 14 plans is built except the drag-and-drop timeline editor. Still to see: a real newsletter send, a real post published from its reminder on two platforms (the phone's share sheet waits for phase 15), and a published site counting visits. **Next step:** the owner watches a real law page over a few days and records something by hand; then the decision on computer use, or Search Console (phase 12). Waiting on the owner: the real Save to GitHub and Cloudflare publish (phase 8's check), trying a mobile app on a phone, and turning on Windows Hypervisor Platform and Windows Sandbox; then the Android emulator and Tauri desktop apps. Netlify waits for our OAuth app; Vercel, Convex, Expo (EAS) and BrowserStack for written answers. Production waits (§52). **Phase 15 started (25 Nov 2026):** remote control, Telegram, Slack, the phone's notifications and share sheet, and schedule results built (decisions §64); Discord waits for its policy to be read; WhatsApp, sync's transport and the native app are still to build; the check through the real services waits for Clerk Pro, the owner's bot and phone. **Phase 16 started (26 Nov 2026):** the review and decisions §66 (to be confirmed); the first part is built: `titan.json`, the marketplace's listing from the GitHub topic `titan117-addon` and its `/marketplace` page, installs pinned to a commit with the licence, OSV and secret checks on one laptop-only card, tool add-ons in a QuickJS sandbox, versions and rollback, safe mode and the core-is-off-limits checks; Titan made a working tool and installed a community agent with Claude Haiku 5.5. Fork and publish, installs and ratings, other hosts and the portal's screen come next.

## Phases

| # | Phase | Status | Started | Finished |
|---|---|---|---|---|
| 0 | Setup | Done | 9 Nov 2026 | 14 Nov 2026 |
| 1 | Engine core | Done | 14 Nov 2026 | 14 Nov 2026 |
| 2 | Accounts and money | Done | 15 Nov 2026 | 15 Nov 2026 |
| 3 | Titan and memory | Done | 15 Nov 2026 | 15 Nov 2026 |
| 4 | Web search and artifacts | Done | 15 Nov 2026 | 19 Nov 2026 |
| 5 | Install and setup | In progress | 15 Nov 2026 | |
| 6 | Folder agent | Done | 16 Nov 2026 | 20 Nov 2026 |
| 7 | Coding engine and code builder | Done (except what waits outside the code) | 20 Nov 2026 | 21 Nov 2026 |
| 8 | App builder: web | In progress | 21 Nov 2026 | |
| 9 | App builder: mobile and desktop | In progress | 21 Nov 2026 | |
| 10 | Sidebar apps | Done (sync's transport built in phase 15, 26 Nov 2026) | 22 Nov 2026 | 22 Nov 2026 |
| 11 | Agent builder | Done | 22 Nov 2026 | 22 Nov 2026 |
| 12 | QA and SEO agents | In progress | 22 Nov 2026 | |
| 13 | Automation | In progress | 24 Nov 2026 | |
| 14 | Marketing and video | In progress | 24 Nov 2026 | |
| 15 | Remote and channels | In progress | 25 Nov 2026 | |
| 16 | Marketplace | In progress | 26 Nov 2026 | |
| 17 | Teams and plans | Not started | | |
| 18 | Beta and launch | Not started | | |

## Log

Each entry: date, phase, what was done, and anything left open. One entry per piece of work, not per commit.

### 26 Nov 2026 · Phase 16's second part merged

The pull requests are merged in all three repos (web #64 first, then desktop #59 and pop #51 after their docs check passed), and the development Convex deployment has the new tables. Run the desktop app from `main`. Phase 16 stays in progress: fork and publish, larger tools from the coding engine, MCP servers and workflows from the marketplace, install any open-source project, other hosts and the portal's screen; decisions §66 waits for the owner.

### 26 Nov 2026 · Phase 16: sidebar app rollback, takedowns, the update card and ratings

Built (decisions §66.19): sidebar apps on the Add-ons screen with their kept builds and **Roll back** (`builds` and `rollback` in the sidebar service; the window serves the build put back); installed add-ons we took down are switched off on the next check (30 seconds after start, then hourly) and stay off; **Check for update** with the commits in between on the card; the install reported to our web app with the device token, and stars from the Add-ons screen.

- **Checks:** desktop tests (new: build rollback served by the window, the update card's comparison and the "couldn't list" case, the install report, a takedown's lock), typecheck, lint, licences, the build and its contents. **Not seen yet:** a real update, rating or takedown against the development deployment (no listed repository yet). No model is involved, so no live run.

### 26 Nov 2026 · Phase 16's first part merged

The pull requests are merged in all three repos (web #62 first, then desktop #57 and pop #49 after their docs check passed). Run the desktop app from `main`. Phase 16 stays in progress: fork and publish, installs and ratings, later takedowns, MCP servers and workflows from the marketplace, other hosts, the update card and the portal's screen; decisions §66 waits for the owner.

### 26 Nov 2026 · Phase 16 started: add-ons from GitHub, tools on request, safe mode

Built (decisions §66, to be confirmed): `src/engine/lib/addons/` (the GitHub source pinned to a commit and unpacked in memory with limits; the licence, OSV and secret checks; the store with five versions, rollback and switching off a tool that keeps failing after a change; safe mode with the start mark, `--safe-mode` and sidebar apps not served; the QuickJS sandbox), five tools for Titan only (`addons_inspect`, `addons_install`, `addons_create_tool`, `addons_list`, `addons_rollback`) with denial tests, the tool group "Add-on tools", add-on agents and skills in their stores, commands and scripts that name the app's folders refused before asking, the Add-ons screen and the safe-mode banner. One new dependency: quickjs-emscripten (three MIT packages, about 650 KB).

- **Checks:** 677 tests (new: the sandbox's escapes and limits, sources, checks, installs, tools through the permission layer, rollback, safe mode, the core off-limits, 5 denial tests), typecheck, lint, licences (849 packages), the build and its contents. The QuickJS WebAssembly file loads from inside the packaged archive.
- **Seen working** (Claude Haiku 5.5, `pnpm eval:addons`): Titan made an ECB-rates tool after one laptop-only card ("It may reach only: www.ecb.europa.eu") and it answered "1 EUR = 5.344 RON" from the real page ($0.018); Titan inspected a community agent (GitHub played by the harness, OSV real), summarised it on the card and installed it at its commit ($0.009). In the app (the production build with Electron's signed binary, a throwaway profile, the real profile checked untouched): the Add-ons screen, a real repository without `titan.json` refused with that reason, the safe-mode banner. The only console line was Chromium's own log of that refusal's 400 answer.
- **Found:** the National Bank of Romania's XML address now redirects to its home page (the add-on and Titan both said the rate wasn't there); the packaged `.exe` is blocked by Windows' Application Control until it is signed (owner's code signing).
- **Not seen yet:** an app template copied into a real allowed folder from the screen, safe mode after real failed starts (tests only), a real community repository (owner checklist). Not built: fork and publish, installs and ratings, later takedowns switching off installed copies, MCP servers and workflows from the marketplace, other hosts, the update card.

### 26 Nov 2026 · Phase 15: sync between laptops, conversations, the second factor and Slack files

Built (decisions §65, to be confirmed): **Sync between my laptops** on the Remote control screen (`src/main/lib/laptop-sync.ts`, `sync-package.ts`): its own switch and keys in the keychain, a new laptop let in only after the code is checked on both, a new key when one leaves, sidebar apps' records and finished conversations sealed both ways; the engine's `/v1/sync/...` routes, `store.syncedTasksSince` and `importSyncedTask` (a conversation running here is never replaced; "from <laptop>" in the task list). **Laptop-only approvals after a second factor:** two switches (Sending, publishing and deleting; Commands that always ask), the permission layer's categories, `verifySecondFactorProof` in `lease.ts` checking account, device, approval and expiry. **Slack:** files in the direct message saved in the inbox folder, the bot token sent only to `files.slack.com` with no redirects; the manifest asks for `files:read`.

- **Checks:** 630 tests pass (new: the proof, the categories, two and three laptops through a fake relay, conversations, Slack files), typecheck and lint clean. **Not seen yet:** two real laptops and a real second factor (Clerk Pro); on the owner checklist.

### 25 Nov 2026 · Phase 15: Slack, the share sheet, schedule results and pushes

Built (decisions §64.21): Slack in Socket Mode (`src/main/lib/slack.ts`: the user's own app, direct messages only, a one-time code, every envelope acknowledged, approval buttons, laptop-only ones said so; the manifest on the setup card); "Time to post" sends each ready post sealed to the phone with its full text and the pictures that fit, read only inside the allowed folders (`GET /v1/remote-share`); a schedule's result goes to the phone and the chats (a switch on the screen, on by default); the laptop flags new approvals, finished tasks, alerts and due posts so the phone gets an empty push. Tests: remote 9, Telegram 7, Slack 3. **Not built:** Discord (its policy pages refuse our reader), WhatsApp, sync's transport.

### 25 Nov 2026 · Phase 15: remote control and Telegram, first part

Built (decisions §64.16): the shell's remote bridge (`src/main/lib/remote.ts`: off by default, the laptop's X25519 key encrypted by the keychain, pairing allowed only after comparing the code, commands opened only from trusted keys, once and before they expire, key rotation when a device is removed, Revoke all), one command runner for phone, browser and chat (`remote-commands.ts`, through the engine's local API with two new routes, `GET /v1/remote` and `POST /v1/remote-approvals/:id`; laptop-only approvals refused remotely, never "always"), the Telegram channel (`telegram.ts`: the user's own bot by long polling, private chats only, linked with a one-time code, Approve and Deny buttons, laptop-only ones say so, files into the chosen inbox folder) and a **Remote control** screen. The protocol is a byte-identical copy of the web's (`src/shared/remote-protocol.ts`) with the same test vector. No new agent tool, so no new denial test. Checks: typecheck, lint, 612 tests plus 14 new (remote 8, Telegram 6), build, licences (846 packages), build contents (96 files).
- **Seen working** (Claude Haiku 5.5, `pnpm eval:remote`): a task sealed from a phone key started on the laptop, its `write_file` approval appeared in the Telegram chat and was approved there (recorded as remote), and the file read "Thank you, Brasov Logistics, for Thursday's delivery." ($0.0026); nothing readable went to the cloud. Our cloud's route and Telegram's servers were fakes. In the built app (throwaway profile with `--user-data-dir`, the real profile checked untouched): the screen, Switch on refused while signed out, a malformed token refused before sending, no console errors.
- **Not done:** the real-services check (Clerk Pro, the owner's bot and phone), Slack, Discord, WhatsApp, schedule results to phone and chat, the share sheet, sync's transport (§64.20).

### 25 Nov 2026 · Phase 14's newsletters, analytics and video studio merged

The pull requests are merged in all three repos (web #58 first, then desktop #53 and pop #45 after their docs check). Run the desktop app from `main`. Phase 14 stays in progress: a real newsletter send, real visits, a post published from its reminder (the phone half waits for phase 15) and the drag-and-drop timeline editor; decisions §62 and §63 wait for the owner.

### 25 Nov 2026 · Phase 14: newsletters, sequences, website analytics and the video studio

- **Newsletters and sequences (15.5, 15.6)** (`marketing/mail.ts`, `mail-providers.ts`, `mailer.ts`; new local tables `mail_lists`, `subscribers`, `newsletters`, `mail_sequences`, `mail_sequence_sent`): lists with each person's consent words, imports from CSV, unsubscribes kept for good, Markdown emails in the brand with a footer (sender, postal address, why, unsubscribe), the set-up check (settings, the provider's own sender and domain state, SPF and DMARC from DNS), a test before every send, suppressions read back first; Brevo (list, import, campaign, `sendNow`/`sendTest`) and Postmark (broadcast stream, batches of 500); sequences by day for people who join after they were made, looked at hourly. Keys `brevo` and `postmark` (each checked with its read-only account call). Tools `mail_state`, `mail_list_save`, `subscribers_add`, `newsletter_save`, `newsletter_test`, `newsletter_send` (outward, every time, laptop only), `sequence_save` (every time, laptop only). The **Newsletters** section of the Marketing screen (`Newsletters.tsx`), with a sandboxed preview.
- **Website analytics (15.10)** (`apps/cloudflare.ts`): published sites get a beacon script and a counting Worker writing to Workers Analytics Engine (page, referring site, country, phone or computer; no cookies or IPs; bots skipped; Do Not Track respected); on unless `site.config.json` says `"analytics": false`, and the publish card says which. `site_visits` reads them through the SQL API into a report, and says which token permission to add when refused.
- **Video studio (15.15), first part** (`marketing/video.ts`, `tools/media.ts`): `clip` scenes (MP4 or WebM, from a point in the clip, filling the frame, with titles, voiceover and captions over them), camera moves on `video_create`, and the Video maker's studio instructions.
- **Tests:** `test/mail.test.ts` (consent, rendering, Brevo and Postmark against fakes, sending rules, sequences over days), `test/site-visits.test.ts` (the Worker's own code against a fake environment, the page script, publish bindings, reading back), clips and camera moves, key checks, and denial tests for the eight new tools. `test/live/marketing-mail.live.ts` with a real model; `pnpm eval:marketing` adds a clip video.
- **Seen working** (Claude Haiku 5.5): the Marketing agent made a list, added three people from a CSV with their consent, wrote the December newsletter and a three-email welcome sequence; the test send was refused because sending wasn't set up, and no provider was reached ($0.0099). A portrait video with a clip played in Edge. In the built app (a throwaway profile, checked untouched real profile): the Newsletters section, the missing set-up, the providers' keys, Send disabled before a test, the preview, no console errors apart from a deliberate refused request. **Not seen:** a real send (needs the owner's provider and domain), real visits on a published site, an AI clip through credits.
- Typecheck, lint, 598 tests, build, build contents and licences pass. No new dependency.

### 24 Nov 2026 · Phase 14's first two parts merged

The phase 14 pull requests are merged in all three repos (web #56 first, then desktop #51 and pop #43 after their docs check). CI caught a test that only failed on Linux (a `C:/Windows/…` path is relative there); fixed with a separate temporary folder. Run the desktop app from `main`.

### 24 Nov 2026 · Phase 14: campaign reports, tracked links, ad drafts, leads and monitoring

- **Campaign reports (15.11)** (`marketing/report.ts`, `post_results`, `campaign_report`): planned, posted and overdue per platform and campaign, and what posts brought, from numbers the user types in (a new `results` column on `posts`, a migration). **Tracked links** (`trackedLink` in `posts.ts`): `utm_source`, `utm_medium=social`, `utm_campaign`, used by Copy and open and the export.
- **Ad drafts (15.13)** (`marketing/ads.ts`, `ad_drafts`): Google's limits checked before asking; a Google Ads Editor import file (UTF-16 tab-separated, every campaign, ad group, ad and keyword Paused, formula-safe cells); a Meta sheet with Meta's recommendations as advice; one document saying nothing is running.
- **Lead finding (15.12):** instructions for the Marketing agent (businesses only, only what they publish, GDPR reminder, nothing sent). **Monitoring (15.14) and landing pages (15.7):** buttons on the Marketing screen that start the Web watcher and the Builder. The screen also gets Draft ads, Find leads, Report for this month, and the results fields on posted posts.
- **Tests:** reports, tracked links, results, ad checks, the Editor file row by row, Meta's advice, the document; denial tests for the three new tools. `pnpm eval:marketing-agents` adds results, the report and ad drafts with a real model.
- **Seen working** (Claude Haiku 5.5): all three live checks pass; the ads and report step cost $0.0085 and the Editor file had 8 rows, none enabled. In the built app (throwaway profile): results saved from the card, tracked links shown, the five buttons work, no console errors. **Not checked:** the file inside Google Ads Editor itself.
- Typecheck, lint, 565 tests, build and build contents pass. No new dependency.

### 24 Nov 2026 · Phase 14 started: the brand kit, the content calendar and promo videos

- **Brand kit (15.1)** (`marketing/brand.ts`): the app builder's kit plus the name, tagline, website, description, audience, products and heading font, kept in `meta.brandKit` and as one shared memory. `readSite` opens the site in the laptop's Edge or Chrome (fresh profile, every request through the task's network policy, the logo fetch too) for its name, description, headings, two colours (`pickColours`: colourful only, buttons first), heading font, logo and desktop and phone screenshots.
- **Posts and the calendar (15.2–15.4)** (`marketing/posts.ts`, new local table `posts`): checks per platform (X's weighted count with links as 23), batches saved together or not at all, statuses, `composeUrl` (X and LinkedIn asked to pre-fill as a best effort; Facebook, Instagram and TikTok open their sites), reminders once per ready post (not after three days late, nothing while locked) through a notification that opens the Marketing screen, and .ics (RFC 5545, folded lines, an alarm) and formula-safe .csv exports.
- **Promo video (5.1, 15.9)** (`marketing/video.ts`, `mp4.ts`): scenes checked against the brand kit's look, timed to the system voice's length, captions; drawn on a canvas in a page that refuses every request, encoded with WebCodecs (H.264 High without B-frames, AAC), and written by our own MP4 writer (`ftyp`, `moov` first, `mdat`, a second of each track at a time). `speech.ts` gained `readWav` so the voiceover keeps its own sample rate.
- **Tools and agents:** `brand_get`, `brand_from_site`, `brand_save`, `post_save`, `post_list`, `post_change`, `calendar_export`, `promo_video` in the new group "Brand kit, posts and promo videos" (`permissions.marketing`); built-in **Marketing agent** and **Video maker**. A bad post or video is refused before anyone is asked.
- **Window:** the **Marketing** screen (`Marketing.tsx`, `marketing-lib.ts`): plain-words boxes for the two agents, "Time to post", the month calendar, post cards (Copy and open, I posted it, Ready, Edit, Remove, the post's picture and **Show in folder** through a new `files:reveal` IPC limited to the allowed folders), the brand kit form, and the export. A notice when the clipboard refuses.
- **Tests:** `test/marketing.test.ts` (brand kit, colours, posts and platforms, the store and reminders, exports, the video's script, timing and captions, the MP4 writer box by box, the local API, the month grid) and denial tests for all eight tools. `pnpm eval:marketing` draws videos in all three shapes, one with the real system voice, plays them back, and reads a real public site; `pnpm eval:marketing-agents` is phase 14's check with a real model.
- **Seen working** (Claude Haiku 5.5): on a bakery site served on the laptop, the Video maker saved the brand kit and made a 32-second video with a voiceover in landscape and portrait ($0.006); the Marketing agent saved 23 December posts for LinkedIn and X in one approval ($0.008). Videos in all three shapes played in Edge with sound; books.toscrape.com was read for its brand. In the built app (a throwaway profile, `--user-data-dir`): the Marketing screen, calendar, "Time to post", Copy and open (text copied, X's post screen opened), the copy-failed notice, I posted it, the brand kit and the agents, with no console errors.
- **Found live and fixed:** hashtags written in the text and in the list showed twice; X counts emoji and most non-Latin characters as 2; a refused copy went unnoticed. **A slip:** the first runs of the screen check set `APPDATA`, which Electron ignores, so they ran in the owner's development profile: its 12 test posts and test memory were removed, the brand kit couldn't be restored (owner checklist). The script now passes `--user-data-dir`, and the real profile was checked untouched.
- **Not checked:** a post published from its reminder on a real platform, LinkedIn's text pre-fill while signed in, macOS (its `say` voice and Chrome's encoders there).
- Typecheck, lint, 555 tests, build, build contents and licences pass. No new dependency. Decisions §62 (to be confirmed).

### 24 Nov 2026 · Phase 13: triggers, ready-made schedules, feeds and the browser for watches

- **Triggers (4.1)** (`automation/schedule.ts`, `service.ts`): a new kind of "when", `{kind: "folder", folder, match}`. The scheduler looks in the folder (inside the allowed folders only, three levels deep, hidden folders and `node_modules` left out), waits until a file is 10 seconds old, and starts one task for everything new, naming the files. What was there before, or arrived while paused, never counts (`state_json` on `schedules`, a new migration). Only a task for an agent; a folder no longer allowed is reported once.
- **Agents' pages** (`Agents.tsx`): "Runs by itself" lists the agent's schedules and triggers, and "Add a schedule or a trigger" opens Automations with that agent chosen.
- **Ready-made schedules** (`Automations.tsx`): Morning briefing, Weekly SEO re-audit (asks for the site), Weekly backup (asks for the folder), each one click.
- **Feeds** (`automation/watch.ts`, `feedLines`): RSS and Atom are compared item by item. **Read in the browser** (`watches.via`, a checkbox on the form, `browser` on `watch_save`): `watch_check` opens the pages with the browser tool's rules.
- **One task per watch check** (`runtime.runDirect` takes a `followUp`): when a check found changes the Web watcher carries on in the same task. **Notifications** name the agent and add the task's last line.
- **Tests:** triggers (checks, settled files, one task naming the files, refusals, a folder no longer allowed), feeds, the browser choice, and the notification; the denial test for `watch_check` covers a watch read in the browser (a site that forbids automation, Discord). `pnpm eval:automation` adds the EUR-Lex feed and a folder trigger with a real model.
- **Seen working** (Claude Haiku 5.5): all 10 live checks pass. EUR-Lex's "All Parliament and Council legislation" feed read as 100 acts; a text file dropped into an allowed folder started Titan, which said "delivery.txt: The pallets from Brasov arrive on Thursday at 10." In the built app (throwaway profile): the ready-made schedules (Morning briefing added with a click), the watch form with feeds and the browser option, and Writer's "Runs by itself" opening the trigger form with Writer chosen; no console errors.
- **Not checked:** a trigger in the app with a real allowed folder (the profile had none; checked through the engine and live), a watch read in the browser on a real site, macOS.
- Typecheck, lint, 523 tests, build and build contents pass. No new dependency. Decisions §61.18–§61.22 (to be confirmed).

### 24 Nov 2026 · Phase 13's first part merged

- The phase 13 pull requests are merged (web #53, desktop #48, pop #40). Run the desktop app from `main` to try Automations.

### 24 Nov 2026 · Phase 13 started: schedules, the web watcher and the recorder

- **Schedules** (`src/engine/lib/automation/schedule.ts`, `service.ts`): daily (with weekdays), monthly, every N minutes (15 at least) or once, in local time; kept in the local database (new tables `schedules`, `watches`, `watch_pages`, `watch_changes`). The scheduler looks every 30 seconds, runs each due schedule **once** however many times it was missed, does nothing while the app is locked and catches up when unlocked, and skips a run while the last one is still going.
- **Runs without a model** (`runtime.runDirect`): one tool call as its own task through the permission layer, used for replays and watch checks; no model, no cost.
- **Web watches** (`automation/watch.ts`): up to 10 pages per watch, read fresh (the page reader got a `fresh` option, so the 15-minute cache never hides a change), compared line by line; the first check is the starting point; a page that can't be read is reported, not treated as a change. After a check that found changes, the Web watcher is asked in the same task what matters.
- **The recorder** (`automation/recorder.ts`, `lib/browser.ts`): our own page script (clicks, typing, choices, Enter; never a password field's value), steps with role and name, label, text and CSS for each element, variables written `{{name}}`, recordings as JSON files in `recordings/` in the data folder. Replay runs in the task's page without AI; the browser host got `replay`, `startRecording`, `recording` and `stopRecording`.
- **Saved logins** (`src/main/lib/site-logins.ts`, IPC `logins:*`): a user name and password per site, encrypted by the OS keychain, sent to the engine only. Filled in only on their own site; the password may leave only in a request to that site, anywhere else the network policy still blocks it.
- **Nine tools** (`src/engine/tools/automation.ts`, new permission `automation` and tool group "Schedules, web watches and recordings"): `schedule_list`, `schedule_create` (asks every time, laptop only), `schedule_change`, `watch_list`, `watch_save`, `watch_check`, `recording_list`, `recording_save` (asks every time, laptop only, steps shown), `recording_run` (asks; final steps ask every time; sites that forbid automation warn; Discord never).
- **Two built-in agents** (`lib/agents.ts`): **Web watcher** and **Recorder**, team Operations. Titan's instructions mention schedules and watches.
- **The Automations screen** (`src/renderer/src/Automations.tsx`, in the sidebar): a schedule in plain words (a task for Titan), the list with Run now, Pause and Remove, a form to add one; watches with Check now and their latest changes; Record new, Stop and save, Run with variables, the steps in plain words and an editor; saved logins. Local API: `GET /v1/automations`, `POST /v1/automations/<action>`.
- **Tests:** `test/automation.test.ts` (next run times, the scheduler's catch-up, lock, skip and pause, watches, recorded events to steps, checks of steps and variables, saved logins, which agents get the tools, and three runs through the engine) and denial tests for all nine tools. `pnpm eval:automation` (`test/live/automation.live.ts`) runs the same for real.
- **Seen working** (Claude Haiku 5.5). In a real Edge: a sign-in and a report recorded as seven steps with no password in them; a schedule replayed them without AI for $0, waited at "Send report" and sent after the approval; a form posting the saved password to another host got nothing; a broken step was reported with where it stopped. The watcher said which new act mattered to a packaging company ($0.002); a real page (news.ycombinator.com/newest) showed a real change between two checks; Titan made the right schedule from "every weekday at 8, check the web watch …" after one approval ($0.006). In the built app (a throwaway profile): Record new, Stop and save, Run, the final-step card, Check now and the schedule card, with no console errors.
- **Found live and fixed:** the engine's own guard blocked the sign-in form because it carried a saved secret (now allowed to its own site only); variables weren't filled into drop-down choices; a `file:` address was read as a host by a watch; a watch check could read a cached page.
- **Not checked or not built:** the law watcher on a real change in a law page (legislation.gov.uk/new was read once as a starting point; a change needs a day or more); recording by hand in the app (a page script played the user); macOS. Computer use (8.7–8.9) and recording other desktop apps (8.6) are planned in decisions §61.16, not built.
- Typecheck, lint, 515 tests, build, build contents and licences pass. No new dependency. Decisions §61 (to be confirmed).

### 22 Nov 2026 · Phase 12 merged

- The phase 12 pull requests are merged (web #41, desktop #39, pop #36). Run the desktop app from `main` to try the QA tester and the SEO agent.

### 22 Nov 2026 · Phase 12: the QA tester and the SEO agent

- **Two built-in agents** (`src/engine/lib/agents.ts`): **QA tester** (Quality) and **SEO agent** (Marketing), and a new tool group, **Site checks (QA and SEO)** (`sites` permission, `toolGroup`).
- **The audit crawler** (`src/engine/lib/sites/audit.ts`): robots.txt kept, 400 ms between requests, 30 pages by default (200 at most), sitemap and llms.txt read; checks for broken pages, redirects (and to another site), titles, descriptions, headings, alt text, thin pages, noindex, canonical, hreflang, phone layout, Open Graph, schema.org, duplicates and local business details; a score; past audits kept in `site-audits/` for re-audits. The network policy gets `fetchOnce` (one request, redirects not followed).
- **The QA run** (`sites/qa.ts`): the laptop's Edge or Chrome, headless, fresh profile, phone and desktop sizes: errors, failed requests, sideways scrolling, axe-core 4.14.1 (new dependency, MPL 2.0, unchanged) and Core Web Vitals; saved tests as plain steps with a Playwright file beside them, replayed without AI.
- **PageSpeed Insights and AI visibility** (`sites/service.ts`): the user's own free Google API key (new key provider `pagespeed`, on the Web search screen; sent in a header); questions to OpenAI, Perplexity and Google models through OpenRouter's web search.
- **Six tools** (`src/engine/tools/sites.ts`): `site_audit`, `qa_check`, `seo_speed`, `seo_ai_visibility` (asks: credits), `qa_save_test` (asks: files), `qa_run_tests` (asks: clicks a live site). Reports are artifacts (`sites/report.ts`): download as PDF, Word or Excel.
- **Tests:** `test/sites.test.ts` (crawler on a fake site, robots.txt, redirects, re-audit, reports, saved tests, PageSpeed, AI visibility, the agents' tools) and denial tests for all six tools.
- **Seen working in the built app** (Claude Haiku 5.5) on books.toscrape.com (a practice site that welcomes crawlers): the QA tester checked 4 pages, saved and replayed a test (passed); the SEO agent audited 15 pages, re-audited, asked three AI models ($0.05); the QA and SEO reports downloaded as PDF, Word and Excel. Found live and fixed: Perplexity takes no tools; Google's keyless PageSpeed limit is shared and was used up (hence the user's own key); a `file:` address was read as a host; the test-run report.
- Typecheck, lint, 487 tests, build, build contents and licences pass. Decisions §60 (to be confirmed).

### 22 Nov 2026 · Phase 11 done and merged

- **Images in the chat:** an image `image_create` saved shows under its step (`GET /v1/tasks/{id}/image?call=…`, read only from the file that task's tool saved, inside the allowed folders; PNG, JPEG, WebP or GIF, never SVG; 15 MB at most).
- **Teams fold in the sidebar:** click a team's name; a folded team shows its number of agents, or Working / Needs you; remembered on this laptop.
- **Seen in the built app:** the croissant picture shows in its task; Build and Knowledge folded.
- **Merged:** the phase 11 pull requests in all three repos. Phase 11 is done (its check seen working: an agent made in the form, a task split between two agents, an agent and its skill made by Titan); decisions §59 waits for the owner. Agent triggers come with phase 13.
- Typecheck, lint, 470 tests, build, build contents and licences pass.

### 22 Nov 2026 · Phase 11: images and video (2.7)

- **The media client** (`src/engine/lib/media.ts`): OpenRouter's Images API and asynchronous Videos API (a job, polled every 15 seconds for up to 20 minutes, then downloaded), through credits, the user's own OpenRouter key or the development key; models from OpenRouter's public list, a sensible one picked unless the user chose one.
- **Tools:** `image_create` (asks, with "always in this task") and `video_create` (asks every time, laptop only); the prompt is checked for private content before anyone is asked; the file is saved in an allowed folder; the cost counts in the task's budget. New tool group "Images and video". Denial tests for both.
- **Models screen:** "Images and video" picks the models (`GET`/`PUT /v1/media`).
- **Seen working in the built app** (development key, Claude Haiku 5.5): Titan made a croissant picture with `google/gemini-3.1-flash-lite-image` after the approval card, saved as `croissant.jpg` for $0.03 (the model answers JPEG even when PNG is asked, and Titan said so instead of renaming). No video made (cost); tested with a fake provider. Not tried through credits end to end yet.
- Tests: `test/media.test.ts`; typecheck, lint, 470 tests, build, build contents and licences pass.

### 22 Nov 2026 · Phase 11 started: the agent builder

- **Agent files (4.1, `src/engine/lib/agents.ts`):** `agents/<id>.md` in the data folder (out of every agent's file tools' reach), a header (name, role, team, colour, model, fast model, tool groups, memory, manager, always-ask tools, skills) and the instructions. Checked on read and save; a broken file is skipped.
- **Built-in agents (4.2):** Titan, Researcher, Writer, Folder agent and Builder, in our code; **clone and edit (4.3)**; a built-in's models are a setting.
- **Only an agent's own tools (§59.3):** groups follow what each tool declares (`toolGroup`), a tool outside them is refused and logged, "always asks" in a file makes a tool ask every time (never less); scripts (4.10) get only the agent's tools; "own memory only" hides shared memory.
- **Agents working together (4.6, 4.7):** `agent_delegate` hands up to three parts at once to other agents, each its own task linked to the first (`tasks.parent_id`), one level deep, stopped with the manager, its cost counted in the manager's budget; briefs and answers in `agent_messages`, shown as **Parts handed out** and **Team talk** in the task's details.
- **Agents and skills on request (18.1, 18.2):** `agent_create` (Titan only) writes the agent and its skills after one approval, every time, laptop only; nothing is written before the yes.
- **Smart routing (2.4):** an agent's fast model takes the steps after the plan; the main model plans each turn and steps after a failure. **Compare models (2.8):** `POST /v1/compare` and a Compare screen, up to four models, no tools, nothing kept.
- **Screens:** Agents (list by team, the form, Advanced: the file), agents in the sidebar under their teams with Working / Needs you, an agent picker in the composer, Compare models.
- **Seen working in the built app** (throwaway profile, Claude Haiku 5.5): the form made "Invoice clerk" (Finance), which totalled `invoices.csv` per client (Acme 1,500.00, Brasov Logistics 850.50, total 2,350.50 EUR) with only its tools; Titan handed a research part to Researcher and an email to Writer at the same time and combined them ($0.02 for the parts); Titan made "Supplier chaser" (Operations) with the skill `late-delivery-reminder` after one approval with no "Always", and it appeared in the sidebar; Compare ran Haiku 5.5 (0.9 s) next to Hy4 flash (16.4 s). Phase 11's check, all three parts.
- Tests: `test/agents.test.ts` (12) and denial tests for `agent_delegate` and `agent_create`; typecheck, lint, 463 tests, build, build contents and licences pass.
- **Left in phase 11:** media (2.7; built the same day, entry above), agent triggers (schedules come with phase 13).

### 22 Nov 2026 · Phase 10 merged

The phase 10 pull requests are merged into `main` in all three repos (web #38, desktop #36, pop #33). The owner checklist now says to run the desktop app from `main` for phases 9 and 10, and its "Where the code is" line is current. Secret scanning flagged a fake base64 test value in the sync test; it's built at run time now and allowlisted with its reason in the desktop repo's `.gitleaks.toml`.

### 22 Nov 2026 · Phase 10: titan.ai, another target, the sync core

- **`titan.ai`** (decisions §58.10): `await titan.ai.ask("…")` returns text from the user's default model, no tools; only with `"ai": true` in `titan.json` and the user's OK (the review and the approval card name the cost); 100 questions a day per app; today's questions and cost in the sidebar's header. `app_build` now brings a sidebar app's SDK up to date before building (found in the built app: an app made earlier still had the old SDK).
- **Another target (6.6, §58.11):** "Add a mobile app / website / desktop app" on the Apps screen and `app_add_target` make a linked app beside the first, sharing `src/shared/`; "Copy shared code to the others" and `app_share_code` copy it and save versions. Denial tests for both tools.
- **The sync core (6.12, §58.12, `src/engine/lib/apps/sync.ts`):** deletions kept as tombstones, entries per changed record, AES-256-GCM packages (app and fields inside, padded to 1 KB), last-writer-wins merging that refuses unknown apps and bad records and doesn't echo. Tested between two databases; the transport waits for phase 15.
- **Seen working in the built app** (same throwaway profile, Claude Haiku 5.5): Titan added a "Draft follow-up" button to the CRM with `titan.ai` ($0.05); the Apps screen's review named the AI cost and **Update it** put the new version in the sidebar; the draft for Ana named her 10 sourdough loaves and 4 kg of coffee, and the header counted the questions. "Add a mobile app" on the Inventory made `inventory-mobile`, linked both ways, with its notes and two versions.
- Tests: `test/sidebar-more.test.ts`; typecheck, lint, 449 tests, build, build contents and licences pass.
- **Phase 10 is done** except sync's transport (phase 15).

### 22 Nov 2026 · Phase 10 started: sidebar apps (6.2, 6.11, 6.14), first part

- **The shared data layer** (`src/engine/lib/apps/data.ts`): one SQLite database per sidebar app in the data folder (`sidebar-apps/<app>/data.db`, Node's built-in driver), JSON records in collections, filters, search, sorting, limits, and a change log for sync later.
- **Sidebar apps** (`src/engine/lib/apps/sidebar.ts`, `sdk.ts`): the `titan` SDK (`templates/sidebar/titan.ts.tmpl`: `db`, `auth`, `agent`; in-memory outside the sidebar so previews and tests work), `titan.json` (collections, other apps' `reads` and `writes`), add / update / remove, a checked build copied per version (three kept), the review of what an app reaches, and every SDK call checked against what the user agreed to. `app_create` takes `sidebar: true`.
- **No network, own address only:** the main process serves `titan117://<app>.apps/` from the build with a content security policy without `connect-src` (`src/main/lib/sidebar-files.ts`); the window shows it in a frame sandboxed without same-origin and relays the SDK's messages only from that frame (`SidebarApp.tsx`); frames can't move to another app.
- **Tools:** `sidebar_data` (read across apps, no asking, private and untrusted output), `sidebar_change` (asks), `sidebar_add` (asks every time, laptop only, naming what it reaches), `sidebar_update`; `app_build` updates a sidebar app after a passing version (6.14). Denial tests for all four, plus a read-only tool that can't write.
- **The window:** "Your apps" in the sidebar, each app with Update and Change with Titan, its errors with Fix with Titan; on the Apps screen, the sidebar choice when making a web app and Add to the sidebar with the review.
- **Seen working in the built app** (throwaway profile, Claude Haiku 5.5): Titan made an **Inventory** ($0.06) and a **CRM** that reads `inventory/items` ($0.07), each passing its checks and added through the approval card; both opened in the sidebar at their `titan117://…apps/` addresses with no console errors; items, customers and orders entered through the apps' own forms, the CRM's product list coming from the Inventory; then Titan answered "which customers ordered more than we have in stock, and which products are low" correctly from both apps, with four `sidebar_data` reads and no approval asked. **Phase 10's check passes.**
- Tests: `test/sidebar.test.ts` (data layer, grants, builds, serving, navigation), denial tests; typecheck, lint, 441+ tests, build, build contents and licences pass.
- **Left in phase 10** (when this was written): another target per project (6.6), `titan.ai`, sync (6.12, after phase 15's device keys), the owner trying it.

### 22 Nov 2026 · Phase 9: the emulator's set-up, the installer, a clean Windows, store guides

Branch `phase-9-app-builder`; decisions §57.19.

- **The emulator (`android.ts`):** Google's command-line tools 22.0 and Eclipse Temurin 21.0.13.1, hash-checked (both matched), into `components/android`; Google's licence shown exactly as `sdkmanager --install` asks for Titan117's four packages, declined while reading; acceptance recorded with the text's fingerprint; then the install, a Pixel 7 phone on Android 14 with Google Play, start (waits for boot) and `exp://10.0.2.2:…` to open a mobile app. Google's tools run from Java directly, with their own settings folder.
- **The installer:** `makeInstaller` (toolchain check, checks, icons, `tauri build --bundles nsis`) and **a clean Windows** (`sandbox.ts`: a `.wsb` with no network, the installer read-only, a results folder; Windows Sandbox installs silently and starts the app).
- **Store guides** for Google Play, the App Store and the Microsoft Store on the Apps screen.
- **Seen in the built app:** the tools downloaded and matched their fingerprints; Google's licence showed in full (17,069 characters, no notices or progress bars) and was not accepted; nothing was installed; Make the installer said Rust and the build tools are missing; the store guides showed. The emulator itself, the installer and the sandbox wait for the owner's steps (owner checklist).
- **Checks:** typecheck, lint, 424 tests, build and `check:licenses` pass.

### 22 Nov 2026 · Phase 9: desktop apps with Tauri, first part

Branch `phase-9-app-builder`; decisions §57.18.

- **The desktop template (6.4):** Tauri 2.12.7 (`tauri-build` 2.7.6, exact versions in `Cargo.toml`) around a React 19, Vite and Tailwind page; `app.config.json` holds the name, `src-tauri/tauri.conf.json` the window and installer (NSIS only, current user), a window that loads only its own content, Tauri's core permissions only; a test, `AGENTS.md`, and a lockfile of 110 npm packages (permissive, plus MPL 2.0 lightningcss). Its typecheck, test, build and `tauri icon` (from `app-icon.svg`) work without Rust.
- **The engine:** a third kind, `desktop` (`app_create` target "desktop"), with the desktop specialist's stack, rules and fix prompt; its page tested in Chromium (WebView2) and WebKit at 1024×720, 800×600, 1440×900 and dark, with the screen checks; Cloudflare publishing and Expo Go refused for it. The Apps screen's third choice, an Installer note, and its own placeholders.
- **Bugs found by driving it and fixed:** `app_create` turned the "desktop" target into a website (now checked by `targetOf`, with a test); and a desktop app got a website's SEO checks because one of its window sizes is named "desktop", so the first fix round added meta tags for nothing (website checks now only for websites, with a test in Edge). Also: a long folder path in the App picker made the Apps screen scroll sideways; it now fits.
- **Seen working in the built app** (Claude Haiku 5.5): Titan made "Customer Book" as a desktop app and built a customer list (a form, a searchable table, kept on the computer; 9 files, 407 lines with tests), and every check passed in both engines at every window size; after the fixes, Test it on the Apps screen showed the app checks without SEO, and the preview at desktop size showed the two-column window.
- **Checks:** typecheck, lint, 413 tests, build and `check:licenses` (845 packages) pass.
- **Left:** the installer (`tauri build`; needs Rust and Microsoft's C++ build tools, and makes the `Cargo.lock`), then the clean-Windows install in Windows Sandbox.

### 21 Nov 2026 · Phase 9 started: mobile apps with Expo, Expo Go, the laptop check

Branch `phase-9-app-builder`. Decisions §57 (to be confirmed); the phase-start review is in the shared docs.

- **Mobile apps (6.3):** a second template, Expo SDK 58.0.26 with React Native 0.88.1 and React 19.3 (from Expo's 0BSD blank template): a lockfile of 497 packages from the public registry, installed without install scripts; a Vitest test rendering through react-native-web (Expo modules that need a phone get stand-ins in `test-stubs/`); `AGENTS.md` rules. `app_create` takes `target: "mobile"`; the Apps screen asks "Website or web app" or "Mobile app". Expo's telemetry and server calls are off (`EXPO_NO_TELEMETRY`, `EXPO_OFFLINE`); no Expo account.
- **Preview and tests:** Expo's dev server on 127.0.0.1 only (`--localhost`, checked: nothing else listens); a mobile app's checks are typecheck, the web export, its tests, then Chromium and WebKit at phone, small phone, tablet, phone dark and slow phone, with screen checks (shows something, named buttons and images, 44-point tap targets) instead of SEO. The first bundle is made once before the browsers time it.
- **On the phone (6.24):** `app_phone` and the Apps screen's "Open on your phone" restart the server on the laptop's Wi-Fi address (never a virtual adapter's; Expo's public tunnel never used), show a QR code for Expo Go, and ask every time, on the laptop only (denial test added). Stopping the preview closes it.
- **The laptop check (6.28):** "This laptop" on the Apps screen reads memory, disk, virtualization, Windows Hypervisor Platform, Windows Sandbox, the edition, WebView2, the C++ build tools, Rust, Xcode and the Wi-Fi address, changes nothing, and says the user's own step for each missing piece.
- **The mobile specialist (6.5):** its own stack, rules and fix prompt for the coding engine. Publishing to a website host, visual edit and Publish from GitHub are hidden or refused for mobile apps.
- **Seen working in the built app** (Playwright, a throwaway profile, web and API addresses blank, Claude Haiku 5.5): the laptop check found the Wi-Fi address and that Windows Hypervisor Platform and Windows Sandbox are off; Titan made "Cluj Bakery" as a mobile app and built a home screen (hours, six items with prices in lei, a call button) in about 4 minutes for $0.03: the first check caught a type error in its test, one fix round, then everything passed in both engines at every size. The preview showed it at phone size; Open on your phone asked first, showed the QR code for `exp://192.168.111.17:…`, and from that Wi-Fi address Expo's manifest (SDK 58) and a 3.8 MB Android bundle for Expo Go were served; after Stop the preview, nothing answered there.
- **Checks:** typecheck, lint, 406 tests, build and `check:licenses` (845 packages; `uqr` 0.1.3, MIT, draws the QR code) pass.
- **Left:** a real phone with Expo Go (owner), then the Android emulator and automated taps, Tauri desktop apps, Windows Sandbox installs, containers, store publishing and cloud devices (decisions §57.17).

### 21 Nov 2026 · Phase 8's work merged

The owner asked to merge: this repo's #33 (with titan117-web #35 and titan117-pop #30) is merged into `main` (squashed) after CI passed. CI caught one test that only failed on Linux: the Node.js download's fingerprint test stopped at "this system isn't supported" before the check it meant to test. Fixed by letting `createNodeComponent` take the system to act as (as the coding engine's download already does). Run the app from `main` now.

### 21 Nov 2026 · Phase 8: publish from GitHub, and cheaper models compared

- **Publish from GitHub** (decisions §56.26): once an app is on GitHub, the Apps screen shows Cloudflare's, Netlify's and Vercel's own steps for connecting the repository in their dashboards, with the app's values filled in; each pushed version is then published by the host. Titan117 never handles the host's sign-in. The template now has `.nvmrc` (22), `engines.node` and a `wrangler.jsonc` so every host builds it with Node 22 or newer. Checked in the built app; `pnpm eval:apps` passes with the new template.
- **Cheaper models compared** (decisions §56.27): the five sample sites with DeepSeek V4.1 Flash (4 of 5, $0.22), GLM 5.3 Flash (5 of 5, $0.21, slower) and Qwen3 Coder Next (3 of 5, $0.52), against Claude Haiku 5.5 (5 of 5, $0.21, fastest). No cheaper default; the Apps screen names the two that passed everything. Reports in `test/live/results`.
- **Checks:** typecheck, lint, tests, build and licences pass.

### 21 Nov 2026 · Phase 8: export, conditions, specialist, starters, brand, visual edit, publishing, five sample apps

Asked for by the owner ("proceed with everything"). Decisions §56.17–§56.25 (to be confirmed).

- **Download ZIP** of the current version (`git archive`: never packages, reports or `.env`).
- **More test conditions:** phone on a slow network, desktop in Romanian, and "works offline" (nothing asked from other websites). 14 screenshots per test run now.
- **The web specialist:** fixed rules on content, SEO, speed, accessibility, phones, privacy and dark mode, given with every plan, build and fix.
- **Starters** (restaurant, shop, services, portfolio, landing page) and **Your brand** (colours, font, tone, logo) on the Apps screen, applied to each new app.
- **Visual edit:** "Edit visually" over the preview; click an element, say the change, approve once. A quick change skips planning and uses a new "Quick edits" model role. The picker lives only in the app's preview, never in a built site. In the built app: the heading picked, recoloured, checks passing, a version saved, for under a cent.
- **Publish to Cloudflare:** the user's own token under Your hosting (checked with Cloudflare, kept in the keychain), only a version that passes its checks, Cloudflare's documented static assets upload, asks every time. Tested against a fake Cloudflare; a real publish needs the owner's token.
- **Convex backend: not built.** Convex's docs leave the OAuth secret question and an "application builders" clause in its terms open; the owner asks Convex.
- **Phase 8's check, first part: five sample apps** (`pnpm eval:samples`) all built and passed with Claude Haiku 5.5, $0.21 in all (`test/live/results/apps-samples-haiku-2026-11-21.md`). Publishing them waits for the owner's Cloudflare token.
- **Fixed on the way:** errors on the Apps screen now show there; two key tests list Cloudflare.
- **Checks:** typecheck, lint, 387 tests, build and licences pass; `pnpm eval:apps` passes.

### 21 Nov 2026 · GitHub App: Repository creation permission

The owner gave our GitHub App "Repository creation: Read and write", so Save to GitHub can make the repository itself. After the owner saved and accepted it, GitHub's API lists `repository_creation: write`. Still to try: a real save from the Apps screen, signed in. Shared docs updated (decisions §56.16, the GitHub row, the owner checklist).

### 21 Nov 2026 · Phase 8: Save to GitHub

Asked for by the owner. Decisions §56.16 (to be confirmed).

- **On the Apps screen, Save to GitHub** (private by default) puts the app in a repository in the user's own GitHub account, as the user, through our GitHub App's sign-in, with all its versions. After that, **each new version is pushed by itself** until Stop pushing; a failed push never stops a version being saved, and its reason shows on the screen.
- **The repository:** made through GitHub's API once our GitHub App has the "Repository creation" (or "Administration") permission, which it doesn't have yet (owner checklist). Until then the screen links to GitHub's own new-repository page, filled in, and the next save uses that empty repository. A repository with commits is never used; the next free name is.
- **Pushing** (`src/engine/lib/apps/github.ts`, `gitPushTo` and `gitRemoteSet` in `git.ts`): the token reaches git only as a header through its environment, never on a command line or in `.git/config`; never forced, so changes made on GitHub stop the push and nothing is overwritten. An app's own repository gets its `main` pushed (an exception to "never push to main", which stays for other repositories).
- **Asks** every time, on the laptop only, when Titan does it (`app_github`, with its denial test); the screen's button is the user's own click.
- **Fixed on the way:** errors on the Apps screen weren't shown (the window shows them only in the chat); they now show on the screen, by the button that caused them.
- **Checks:** typecheck, lint, 374 tests (8 new: the repository found or made against a fake GitHub, a push into a local repository that keeps the token out of the settings and refuses to overwrite, the sync after each version), build and licences pass. In the built app, the GitHub section shows and, without a sign-in, says to sign in first. **Not yet tried against the real GitHub:** it needs the owner's sign-in and makes a repository in their account (owner checklist).

### 21 Nov 2026 · Phase 8 started: the app builder for the web, first part

Decisions §56 (to be confirmed). Branch `phase-8-app-builder`.

- **The phase-start review:** the vendors' own pages were read for publishing (Cloudflare, Netlify, Vercel), Playwright's browser downloads and Node.js; their rows are in `external-services.md`. Publishing goes Cloudflare first, Netlify after our own OAuth app, and Vercel waits for its written answer (its Hobby plan is non-commercial and its API terms forbid receiving users' tokens). No GPL in anything new: Node.js MIT, npm Artistic 2.0 with permissive packages, the template's packages MIT/Apache/BSD/ISC plus MPL 2.0 (lightningcss), Firefox MPL 2.0, WebKit LGPL 2 and BSD, Playwright's ffmpeg LGPL 2.1 (all downloaded to the laptop and run unchanged, never shipped).
- **Node.js 26.13.1** downloaded on first use from nodejs.org and checked against its SHA-256 (`src/engine/lib/apps/node.ts`); npm runs with our settings: public registry, no install scripts, no user or project `.npmrc`, its own cache (`runner.ts`).
- **The web template** (`src/engine/lib/apps/templates/web`): React 19, TypeScript, Vite 8, Tailwind 4, small shadcn/ui-style components, a Vitest test, `AGENTS.md`, a lockfile, and **SEO built in** from `site.config.json` (title, description, language, canonical, Open Graph, structured data, `robots.txt`, `sitemap.xml`).
- **Six tools** (`src/engine/tools/apps.ts`), each with denial tests: `app_create`, `app_build` (plan → the plan on an approval card → build → install, typecheck, build, tests and three browsers → up to three fixes, the fixer model after the first → a version), `app_check`, `app_preview`, `app_versions`, `app_restore`. A new `apps` permission; running an app asks like a command ("Always run this app"); **an approved plan covers that build's file changes and checks inside that app's folder, in that task only.**
- **Browser tests** (`browsers.ts`): Chromium through the laptop's Edge or Chrome, Firefox and WebKit downloaded by Playwright itself; phone, tablet, desktop and desktop dark; screenshots, console and page errors, failed requests, sideways scroll; page checks (styles, title, description, language, viewport, one `<h1>`, alt text, Open Graph, structured data, form labels). A tested page reaches only its own preview.
- **The Apps screen** (`src/renderer/src/Apps.tsx`): make an app, ask for a build, the live preview in a frame at phone, tablet or desktop size (scaled to fit), the test report with a screenshot per browser and size, versions with "Go back to this", and models for the planner, coder and fixer. The approval card shows the full plan. The window may now frame 127.0.0.1 (app previews) besides the artifact sandbox, never from an artifact's frame.
- **Checks:** typecheck, lint, 366 tests, build and `pnpm check:licenses` pass. `pnpm eval:apps` (new, no model) passed for real: Node.js downloaded and matched its hash, install, typecheck, build and tests, 12 screenshots across the three engines, clean SEO, the preview on 127.0.0.1, and a planted second `<h1>` and outside font both caught. It also found a real bug, fixed: the template's stylesheet arrived empty (a bundler empties `.css` imports), so templates' stylesheets travel as text now and an unstyled page fails the report.
- **Seen working in the built app** (Playwright driving it with a throwaway profile, no sign-in, Claude Haiku 5.5 on the development key): from the Apps screen, "Cluj Bakery" was made, its plan shown and approved, built (welcome, hours, three breads with prices, address), one fix round, **all checks passed** in Chromium, Firefox and WebKit at every size, and version 2 was saved, for about 2 cents. A second run confirmed 14 file changes approved by the plan alone and the scaled preview.
- **Left in phase 8:** publishing (6.15), export (6.18), visual edit (6.9), templates per business type and the brand kit (6.8), the web specialist (6.5), the user's own Convex backend (6.1), slow network, offline and languages (6.21), and the check: five sample web apps build, pass their tests and publish.

### 21 Nov 2026 · Which coding tool is working is shown; tools found with an old PATH

- **Your own tools found reliably (Windows):** the engine looks in its own PATH, Windows' current user and system PATH settings (read from the registry), and the usual install folders (`~\.local\bin` for Claude Code's installer, `%APPDATA%\npm`). The tools run with that PATH too. Found when the owner installed Claude Code but the app, started from a terminal with the old PATH, still said "not installed".
- **Which tool is working is shown:** the step says "Claude Code (your plan)" instead of "Coding engine", and its approval cards and activity lines start with "Claude Code:".
- **The owner's first real Claude Code job:** formatPrice with tests in the sample shop. It ran on the owner's Claude Pro plan, every file change and `npm test` came to the approval screen, and the tests passed.
- 344 tests pass.

### 21 Nov 2026 · Links in answers are clickable; the Pull request step links to GitHub

The owner's first real pull request through the GitHub sign-in worked (sample repo, pull request #6), but its address in the answer couldn't be clicked.

- **Links in answers:** `https://` links in Titan's answers (and while they stream in) are now links. They open in the user's own browser, because the window sends https links there and nothing else; the sentence's punctuation stays outside the link.
- **The Pull request step:** it now has **Open on GitHub**, or **Create on GitHub** when GitHub's page still needs the Create click.
- **Checked:** 3 new tests. In the built app, an answer with the pull request's address showed a link, and clicking it handed exactly that address to the browser (stubbed during the check). No console errors.

### 21 Nov 2026 · Fix: the same laptop signing in again no longer uses up a device place

The app sends its install's fingerprint (the SHA-256 of a random ID kept in the account folder) with the sign-in. The web app then replaces the old device from the same install instead of refusing at the plan's limit (titan117-web). The account test checks that the fingerprint goes along, is stable, and never contains the ID. 340 tests pass.
### 21 Nov 2026 · Phase 7: GitHub App registered, sign-in live

The owner registered **Titan117 by EcotechCore** (client ID `Iv23liPxzFyagnONr6mT`).

- **Checked against GitHub's API:** the device flow is on and gives a code, and the app is owned by EcotechCore with exactly contents write, pull requests write and metadata read, and no webhook events.
- **In the app:** the client ID is in `PRODUCTION.githubClientId`; development uses the same app.
- **Choosing repositories:** a user token reaches only repositories where the app is installed. After signing in, the GitHub section counts them through `/user/installations` and offers **Choose repositories** (GitHub's install page for the app); with none chosen, it says so. The wording of the code step was corrected (choosing repositories is a separate step).
- **Tests:** 341 pass (one new, for the repository count).
- **In the built app:** "Sign in with GitHub" got a real code from GitHub and was cancelled; nothing opened in the owner's browser during the check. No console errors.
- **Left for the owner:** sign in for real and choose repositories (owner checklist).

### 21 Nov 2026 · Phase 7: your own coding tools, servers over SSH, GitHub sign-in, Seatbelt, JetBrains

On `phase-7-own-tools`. Decisions §55 (to be confirmed).

- **Your own coding tools (13.14)** (`lib/code/own-tools.ts`, `lib/code/approval-mcp.ts`):
  - **Claude Code:** its permission prompts go through a tiny MCP endpoint of ours to the permission layer; its web tools are off.
  - **Codex, Cursor's agent, Grok:** experimental and off by default; one approval per job, in their own restricted mode.
  - **Antigravity and Gemini CLI:** not offered.
  - **Sign-in:** read only from each tool's status exit code.
  - **Fallback:** our engine, with a note.
  - **On the Code screen:** the engine choice, each tool's status, and the on/off switches.
  - **Kill switch:** the engine reads `/api/v1/kill-switches` from the web app (decisions §20).
- **Servers over SSH (3.15)** (`lib/ssh.ts`, `tools/servers.ts`):
  - `server_list` and `server_command`, only for servers added on the Code screen (Your servers).
  - The user's own SSH setup: no prompts, no unknown hosts, no forwarding.
  - The shell rules and approvals as on the laptop, with "always" per server; private content never leaves in a command.
- **Sign in with GitHub** (`main/lib/github.ts`):
  - The device flow with the client ID only; tokens encrypted with the OS keychain, refreshed in the background without a secret, sent to the engine only.
  - Pull requests try the sign-in (GitHub's API) first, then GitHub's CLI, then GitHub's page.
  - The GitHub section on the Code screen says it's waiting for the app's client ID.
- **macOS:** OpenCode under `sandbox-exec` (`opencodeSeatbelt`), writing only in the project and its own folders. Not run on a Mac yet.
- **Open in:** IntelliJ IDEA, WebStorm and PyCharm.
- **Tests:** 340 pass, plus the 4 OpenCode contract tests:
  - the coding tools, including a stand-in Claude Code whose command reaches our approvals and gets our "no";
  - SSH arguments and checks;
  - denial tests for `server_list` and `server_command`;
  - the GitHub device flow, refresh and API pull requests against a stand-in GitHub;
  - JetBrains discovery and the Seatbelt profile.

  Typecheck, lint, licences, build and build contents pass.
- **Seen in the built app** (Playwright, throwaway profile): the Code screen's tools, GitHub and servers sections, and adding a server. No console errors.
- **Not tested for real:** a real Claude Code, Codex, Cursor's agent or Grok (none is installed on this laptop); a real SSH server; GitHub sign-in (needs the app's client ID); Seatbelt (needs a Mac).
- **Phase 7 is done** except what waits on the owner or another phase: the GitHub App's client ID, Modal's answer (cloud sandboxes), a Mac, and remote coding tasks (phase 15).

### 20 Nov 2026 · Phase 7's check is met

**The code builder fixed a set of real issues in a sample repo and opened a pull request** (roadmap phase 7). Run with `TITAN_PR_REPO=ispasdani/titan117-sample-shop pnpm eval:pr`, Claude Haiku 5.5 on the development key, $0.03.

- **The sample repo:** `ispasdani/titan117-sample-shop`, private, made with the owner's OK. It's a small shop library whose tests pass but which has four real bugs, filed as issues #1–#4:
  - #1, the cart total ignores quantities;
  - #2, VAT rounding;
  - #3, slugs keep accents (Romanian ș and ț included) and double dashes;
  - #4, the shop counts as open on Sundays.
- **What Titan did:** it read the code and handed the job to the coding engine. The engine fixed `src/shop.js`, added a test for each issue, and ran the tests. Titan then made the branch `fix/shop-issues-1-4`, committed, pushed and opened [pull request #5](https://github.com/ispasdani/titan117-sample-shop/pull/5). Every command, change, commit, push and the pull request went through approvals.
- **Checked on GitHub, not from the model's word:**
  - the pull request is open, by `ispasdani` (the user, through GitHub's CLI), with "Fixes #1" to "Fixes #4" (GitHub links all four issues);
  - the commit is the user's, with `Co-authored-by: Titan117`;
  - on the pushed branch, 12 of 12 tests pass, and each issue's own example passes a separate check;
  - only `src/shop.js` and `test/shop.test.js` changed.
- **Phase 7 stays open** for:
  - the user's own coding tools (13.14);
  - other machines (3.15);
  - Seatbelt around OpenCode on macOS (needs a Mac);
  - GitHub sign-in through our app (needs its registration);
  - remote coding tasks (with phase 15).

  The pull request stays open in the sample repo for the owner to look at.

### 20 Nov 2026 · Phase 7: project memory, code review, open in your editor

On `phase-7-git`. Decisions §54, items 9–13 (to be confirmed).

- **Project memory (13.8):**
  - A new memory scope, `project:<real root folder>`. `memory_save` takes a `project` folder, and saves only for allowed folders.
  - The coding engine gets the project's memories as instructions on every job there (OpenCode's `system`).
  - Memory shows them as "Project <name>".
- **Code review (13.10):**
  - `code_review` reviews the uncommitted changes or the branch against main, with the engine in plan mode. Its file changes are refused without asking (`readOnly` jobs).
  - `git_diff` takes a `base` branch.
  - "Review the changes" / "Review the branch" are on the Code screen.
- **Open in your editor (13.12):**
  - VS Code and Cursor are found next to their command-line launchers and started directly, with no command shell. "Show the folder" opens Explorer or Finder.
  - The main process checks the folder against the engine's allowed folders first (`main/lib/editors.ts`, IPC `code:editors` and `code:open`).
- **The co-author line** can be switched off on the Code screen (`PUT /v1/code`). It's on by default.
- **Sub-agents (13.9):** OpenCode's own task tool, already allowed, under the same approvals and budget.
- **Tests:** 319 pass:
  - a denial test for `code_review`, covering project memory saved only for allowed folders, the review receiving it, and its edit refused without asking;
  - tests for the editor folder check and editor discovery.

  Typecheck and lint pass.
- **Seen in the built app** (Playwright, throwaway profile, Claude Haiku 5.5 on the development key):
  - the Code screen with "Open in VS Code", "Open in Cursor", "Show the folder", "Review the changes" and the co-author checkbox;
  - "Review the changes" on the earlier fix: four real findings, each with severity, line and fix. They were a missing quantity giving `NaN`, a timezone bug in the weekday check, Romanian ș and ț surviving the slug, and half-cent rounding. Nothing was changed, and there were no console errors.

  The editor buttons weren't clicked, so no window opened on the owner's desktop.
- **Left in phase 7:** the check with a real pull request on GitHub (needs a sample repo there); GitHub sign-in (the GitHub App); Seatbelt around OpenCode on macOS (needs a Mac); other machines (3.15); the user's own coding tools (13.14); remote coding tasks (with phase 15).

### 20 Nov 2026 · Phase 7: git, pull requests and the code builder screen

Built on `phase-7-git`. Decisions §54 (to be confirmed).

- **Git (`lib/git.ts`):** status, diff, branch, commit and push with the user's own git and sign-in, and a `Co-authored-by: Titan117` line (it can be turned off). Never a force-push, never a push to the main branch. A commit carrying a `.env` or key file, or a key or token in its added lines, is refused and unstaged. Unusable branch names are refused.
- **Pull requests:** through GitHub's CLI (`gh`) when it's signed in on the laptop; otherwise GitHub's own compare page with the title and description filled in.
- **Tools:** `git_status`, `git_diff` (run at once), `git_branch`, `git_commit` (ask, with "always in this task"), `git_push` and `pull_request` (ask every time, laptop only).
- **The Code screen:** pick a project, see its branch, remote and changes as a coloured diff, and start a "Plan first" or "Build" job. The engine's approval cards now show in the task's conversation (before, only in Approvals), and file changes show their diff with counts. The route is `GET /v1/code`.
- **Fixed:** the built app's engine didn't start. OpenCode's SDK is ESM-only, and the engine bundle loaded it with `require`; it's now bundled into the engine. The tests didn't catch this, because they run the source; it was found by opening the built app.
- **Tests:** 6 git tests against real repositories (a bare repository standing in for GitHub), and denial tests for the six git tools. 316 tests pass, plus the 4 OpenCode contract tests; typecheck, lint, licences and build pass.
- **Seen working:**
  - **Live eval** (`pnpm eval:code`, Claude Haiku 5.5): three bugs fixed, then branch `fix/cart-slugify-weekend`, a commit with the co-author line, a push to the stand-in remote, and the pull request page link. Only `src/shop.js` changed. $0.015.
  - **The built app**, driven by Playwright with a throwaway profile: the Code screen with the project's branch and diff, then a Build job from it. Six cards were approved in the window, including the change to `src/shop.js` with its diff (+10 −4) shown before approving, and the tests passed. No console errors.
- **Not done yet in phase 7:** GitHub sign-in through our app (waits for its registration), project memory, sub-agents and the review agent, open in editor, the co-author switch in Settings, Seatbelt around OpenCode on macOS, other machines (3.15), the user's own coding tools (13.14), and the phase check with a real pull request on GitHub.

### 20 Nov 2026 · Phase 7 started: the coding engine (OpenCode) and code_task

Built on `phase-7-coding-engine` (from `phase-6-ocr`). Decisions §53; the owner chose to ship OpenCode unchanged despite its LGPL runtime, and to download it on first use.

- **Download (`lib/code/components.ts`):** OpenCode 1.19.6 from npm and ripgrep 15.1.0 from GitHub, the first time the code builder is used, each checked against a hash in the code before unpacking (a tar reader of our own for npm's `.tgz`, fflate for ripgrep's zip). About 80 MB.
- **The adapter (`lib/code/opencode.ts`):** one OpenCode server per coding task on 127.0.0.1 with a password, its own config, data, cache and home folders, a scrubbed environment with ripgrep on its PATH, and every outside call switched off. Repo and home `.opencode` settings are ignored. Its config folder is prepared so it doesn't install its plugin helper from npm on start. Our one plugin blanks `OPENCODE_` variables (its password, the bridge token) in the commands it runs. It stops 15 minutes after the task's last message.
- **The model bridge (`lib/code/bridge.ts`):** an OpenAI-compatible server on 127.0.0.1 with a token per task; each step goes through our router (credits, own keys, local models), with a coding budget (150 steps, $3), local-only folders and the offline note.
- **Asks (`lib/code/assess.ts`, `permissions.decide`):** OpenCode's permission prompts are decided by our layer. Commands go through the shell rules, edits only inside the project (not credentials, not read-only folders), and web, other folders and anything unknown are refused. Approvals show as `code_command` and `code_edit`, and OpenCode is always answered "once". The approval code was split out of `execute` into `gate`, shared by both.
- **The tool:** `code_task` (build or plan mode) for Titan; changed files come from the edits we approved.
- **Tests:** 11 unit tests (asks, settings, bridge, downloads, changed files) and a denial test for `code_task`; **contract tests against the real program** (`OPENCODE_CONTRACT=1 pnpm test:opencode`, 4): ask then run, a denied edit, settings in the repo and home ignored, commands can't see the password, follow-ups keep the session, and a recording proxy shows nothing reaches the internet. Two of them were checked to fail with the protection removed (npm calls; the password visible). 304 tests pass; typecheck, lint, licences and build pass.
- **Seen working with a real model** (`pnpm eval:code`, Claude Haiku 5.5 through the development key): a sample repo with three bugs and failing tests; Titan handed it to the coding engine, which ran the tests, read the code, changed `src/shop.js` after approval, and all tests passed with the tests untouched. 4 engine steps, under one cent.
- **Not done yet in phase 7:** the code builder's own screen (diff review, 13.3), git and pull requests with GitHub sign-in (§25, needs the GitHub App), project memory, sub-agents and the review agent, open in editor, remote tasks, Seatbelt around OpenCode on macOS, other machines (3.15) and the user's own coding tools (13.14). Not checked: the desktop window itself (the tool runs inside the engine the window uses; no new screen yet).

### 20 Nov 2026 · Phase 6 done: OCR for scans and photos (7.3)

Scanned PDF pages and PNG or JPEG photos are read with OCR in English and Romanian, on the laptop (decisions §51.8):

- **How:** pdf.js draws a page with no text layer on a Node canvas (@napi-rs/canvas, MIT); Tesseract.js (Apache 2.0) reads it in a worker thread, stopped after a minute idle. The language files (@tesseract.js-data, MIT, LSTM models, 4.6 MB) ship in the app and are handed over as bytes, so nothing is downloaded. Up to 100 scanned pages per document; pages still without text are counted ("pages without readable text"). Files read before OCR that had scanned pages are read again (a migration).
- **Electron's utility process:** pdf.js doesn't treat it as Node, so it would draw on a web page's canvas. It now gets the Node canvas and its drawing helpers explicitly; a test makes Node look like that process.
- **Two Tesseract.js 7 bugs, patched** (`patches/tesseract.js@7.0.0.patch`, in `SOURCES.md`): language data given as bytes was joined by its data instead of its code; and in Node the "LSTM only" flag never picked the LSTM builds.
- **Packaging:** Tesseract, its WebAssembly, the language files and the canvas sit outside the app archive; only the LSTM builds and language files ship (about 63 MB unpacked in all). Checked in the packaged app: a utility process reads a Romanian line with the shipped files.
- **Checked:** 292 tests (5 new); in the built app a folder with a two-page scanned lease and a phone photo of an invoice is read, and "monthly rent" finds the lease's page 2. Not checked: the packaged app end to end, which opens at sign-in (production waits, §52).

### 19 Nov 2026 · Dependencies updated

All the Dependabot updates in one tested change: Vite 8.3.8, @vitejs/plugin-react 6.3.0, electron-builder 26.18.0, Prettier 3.10.1 (one test file reformatted), ESLint 10, TypeScript 6.0.3. Not taken:

- **TypeScript 7:** the newest typescript-eslint supports TypeScript below 6.1 only. TypeScript 6 deprecates `baseUrl`, so the renderer's paths are now relative.
- **Electron 45:** Windows Smart App Control on the owner's laptop blocks Electron 45's `electron.exe` (unsigned and too new to have a reputation), which would stop `pnpm dev`. Stays on Electron 44.10.2, a supported line; retry when Dependabot proposes a later 45 or 46.
- **@types/node 26:** stays on 24, matching Node 24 in Electron 44 and CI.

eslint-plugin-react's React version detection calls an API ESLint 10 removed, so the version is set (19.3). Typecheck, lint, 287 tests, build, licences pass; the built app's smoke run (full-screen artifact, read aloud) passes.

### 19 Nov 2026 · Phase 4 done; the owner's checks; two fixes

The owner ran phases 4-6 on this laptop (details in the web repo's log): **phase 4's check is met**, phase 6's check is met (phase 6 stays open for OCR). Fixed from what the owner found:

- **Full-screen artifact:** the panel moved into the hidden chat's column (0 pixels wide), so only its toolbar showed. It now takes the space beside the sidebar; checked in the built app (panel 1014 px wide, the page showing).
- **Read aloud controls:** a bar above the message box while Titan reads: "Preparing…" while the voice is made, then pause and resume, the time, a position slider, the speed (0.75× to 1.5×) and Stop (also Escape). Checked in the built app on a short reply: pause, speed and stop work. Not checked: the time counting up, as the automated run has no sound device.
- **Search in the browser on request** (decisions §44.12): the instruction is in Titan's prompt.
- **Tests:** 287 passing; lint and build pass.

### 18 Nov 2026 · Decisions §44–§51 confirmed; production waits

The owner reviewed and confirmed decisions §44 to §51 (web search and artifacts, error reports, setup, offline, keep awake and resume, the installer, the phase 4 leftovers and auto-update, the folder agent) and that phase 5 started before phase 4's check. One addition to §44: when asked to search on Google or another engine, Titan does that search in the visible browser (§44.12; the instruction is in the desktop app's prompt). Decided (§52): **production waits** until everything works locally; nothing built so far depends on it. The owner checklist now starts at step 3, trying it all locally.

### 16 Nov 2026 · Phase 6: the folder agent, first part

Started at the owner's request while phases 4 and 5 wait for the owner's checks. Built on `phase-6-folder-agent`, on top of `phase-4-leftovers`. Decisions §51, **to be confirmed**.

- **Documents** in the sidebar: turn an allowed folder on; it's read, watched for new and changed files, read-only for agents by default, optionally for local models only; progress, files that couldn't be read, scanned pages, and a search to try.
- **Reading (7.2):** PDF page by page (pdf.js), Word by section heading (mammoth), Excel by sheet, PowerPoint by slide, emails, text files; passages never cross a page.
- **Search (7.4):** full-text with word stems plus search by meaning with multilingual-e5-small on the laptop, combined.
- **Tools:** `docs_search` and `docs_read` (cite as file and page), `sheet_query` (sums, averages, counts, groups, computed from the cells).
- **Local models only (7.7):** a task that read such a folder never runs a cloud model step again; it offers to continue with a local model.
- **Tests:** 8 new behaviour tests including **the phase 6 test set** (seven questions over a PDF, a Word offer, a sales sheet, a deck and an email: each finds its file and page in the first three passages) and 3 denial tests; 287 in all; build, lint and the licence check pass.
- **Seen in the real app** (built, Playwright, throwaway data): a folder of a PDF, a Romanian Word offer and an Excel sheet turned on and read in 8 seconds; the real embedding model downloaded and gave all 6 passages vectors; the Romanian question "cât costă site-ul?" found the offer's "Prețuri" section first.
- **Fixed while checking:** in the bundled app pdf.js couldn't find its worker file and every PDF failed ("No GlobalWorkerOptions.workerSrc"); tests run unbundled and didn't show it. Now set explicitly.
- **Not explained:** the window crashed three times during one long test script that polled the engine; five dedicated four-minute runs (idle, polling, a folder on, real documents with the model loaded) didn't crash, with steady memory. Watching for it; error reports would capture it.
- **Not built yet:** OCR for scans (7.3, waits for the owner's choice of where its language files come from), Word page numbers (not in the file; sections instead), the check with the owner's own documents and a real model (owner checklist).
### 16 Nov 2026 · CI: dependency advisories and a licence the Linux check couldn't read

Two high advisories in `image-size` (inside PptxGenJS) failed CI's audit; `uuid` (inside ExcelJS) and `fast-uri` (inside the MCP SDK) had moderate ones. All three are pinned to fixed versions with `overrides` in `pnpm-workspace.yaml`; PowerPoint and Excel export tests still pass. `khroma` (inside Mermaid) is MIT by its licence file but declares no licence, so the licence check on Linux read it as unknown: named as an exception. One moderate advisory is left in the linter's `minimatch`, a development tool that isn't shipped, below CI's "high" bar.

### 15 Nov 2026 · Phase 4 leftovers and auto-update

Built on `phase-4-leftovers`, on top of `phase-5-installer` (the web side in `titan117-web` on the same branch name). Decisions §50, **to be confirmed**.

- **ZIP (17.21, 17.22):** tick artifacts in the gallery and download them as one ZIP (best format, or every format); "Every format (ZIP)" in the panel for the version on screen. Seen in the real app: an offer and a project plan came out as `Offer/Offer.docx` and `Project plan/Project plan.pptx`.
- **Browser downloads:** `browser_download` saves a file a site offers into an allowed folder after approval; never programs or scripts, 200 MB at most, never over an existing file. Its denial test covers a refusal, a folder outside, a program and a second download not overwriting the first.
- **Comments on shared pages (17.14):** in the Share section: every comment, reply on the page, hide or show, and "Apply with Titan".
- **Auto-update (1.10):** electron-updater, off until a signing certificate and an update address exist; when on, "Restart to update" in the window.
- **Tests:** 6 new here; 276 in all; build and build-contents check pass.
- **Not checked:** comments and replies against our real web app (need a live share, the owner's step); a real download from a real site in the browser; auto-update for real (needs signing and an update address).

### 15 Nov 2026 · Phase 5: Microsoft's runtime inside the installer

With the owner's OK, `scripts/fetch-vc-redist.mjs` fetched Microsoft's Visual C++ redistributable (14.44.35211, Authenticode signature valid, Microsoft Corporation); `pnpm build:win` now ships it in `resources\vendor` (installer 235 MB).

- **Not run:** the install test of the new installer. Windows' **Smart App Control** (on, on this laptop) blocked it: "An Application Control policy has blocked this file", Code Integrity event 3033, the installer doesn't meet the signing level. The earlier build without the runtime had been allowed. Turning Smart App Control off is a security setting left to the owner; the real fix is code signing (on the owner checklist), then a clean Windows virtual machine to see the runtime step run.
- **Checked:** the file is in the build's `resources\vendor`; the installer's check reads this laptop's runtime as 14.52, so it would skip Microsoft's installer here.

### 15 Nov 2026 · Phase 5: the Windows installer

Built on `phase-5-installer`, on top of `phase-5-awake`. Decisions §49, **to be confirmed**.

- **Smaller:** llama.cpp ships CPU and Vulkan only (CUDA and ARM left out); ONNX Runtime only for Windows x64, its unused web build and dependency source maps left out. Installed size 1.1 GB to 693 MB; the installer 290 MB to 211 MB.
- **The Visual C++ runtime:** `build/installer.nsh` runs Microsoft's redistributable from `resources\vendor` only when the registry shows none or one older than 14.40; `scripts/fetch-vc-redist.mjs` fetches it from Microsoft and keeps it only with a valid Microsoft signature (not committed, `build/vendor/*.exe` ignored). Setup's checklist links to Microsoft's download when local models can't start for that reason.
- **Checked for real:** `pnpm build:win` makes `titan117-0.1.0-setup.exe`; the trimmed llama.cpp and ONNX Runtime load from the packaged app (llama.cpp on Vulkan, the RTX 4070 found); a silent install into a throwaway folder, the installed app started (engine running, local models able to run with 8 GB of graphics memory, the sign-in screen as a production build should), then a silent uninstall left no files, entry or shortcuts.
- **Tests:** the runtime link added to the setup tests; 270 in all.
- **Not checked:** the runtime step itself (the redistributable isn't fetched yet, and this laptop already has 14.52); a clean Windows virtual machine (none here); NVIDIA speed on Vulkan against CUDA; macOS.
- **Earlier oddity explained:** "Graphics: not used for models" in the setup wizard came from the development run before its check finished; the installed app reports the RTX 4070.

### 15 Nov 2026 · Phase 5: keep awake, checkpoints and notifications

Built on `phase-5-awake`, on top of `phase-5-offline`. Decisions §48, **to be confirmed**.

- **Keep awake (1.5):** the engine tells the shell how many tasks run; the shell holds Electron's `prevent-app-suspension` blocker while any does.
- **Checkpoints and resume (1.6):** tasks running when the app stopped, and tasks paused by a lost connection, resume by themselves (twice at most, within an hour); a tool call that never finished is answered "not run to the end" first; a **Resume** button on any other stopped task; `POST /v1/tasks/<id>/resume`.
- **Notifications (1.9):** finished, failed, paused (no internet), needs your OK; only when the window isn't in front; a click opens the task; on or off in Setup.
- **Tests:** 5 new (resume after the app closed with a write waiting, the twice-only limit, resume refusals, resume after the internet returns, busy counts and notifications with the switch); 270 in all; build passes.
- **Seen in the real app** (built, Playwright, throwaway data, one tiny task on the development key): the blocker started with the task and stopped after it; "Titan finished" was shown with the window in the background.
- **Not checked:** a real crash or sleep in the real app (covered by tests that close and restart the engine); the notification's look on Windows, since the test recorded it instead of showing it; macOS.

### 15 Nov 2026 · Phase 5: offline mode and the offline queue

Built on `phase-5-offline`, on top of `phase-5-setup`. Decisions §47, **to be confirmed**.

- **Knowing it's offline (1.22):** every request the engine and its tools make is watched; a network failure marks it offline, a check every 20 seconds notices the internet coming back. The window gets the change at once.
- **Cloud tasks offline:** they stop at the next step with a plain note instead of failing (no error card, no report); the window offers "Continue with <local model> (local)" or points to Models.
- **Online-only features** (web pages, search, sharing) say "No internet connection: … needs it."
- **The queue (1.24):** error reports waiting go as soon as the internet is back; the shell renews the licence lease at once.
- **Offline banner** with what still works.
- **The 14-day lock** was already tested (account.test.ts: unlocked on day 13 offline, locked on day 14).
- **Tests:** 5 new; 265 in all; build passes.
- **Not checked:** the banner and the Continue button in the real window (the laptop's network can't be cut from here without changing system settings; on the owner checklist), a whole local-model task offline end to end (local models are faked in tests), macOS.

### 15 Nov 2026 · Phase 5: setup, checklist and health check

Built on `phase-5-setup`, on top of `phase-5-error-reports`. Decisions §46, **to be confirmed**.

- **First-launch wizard (1.12):** welcome and sign-in, this laptop (system, processor, memory, graphics, disk, the local model that runs well), what you want to do; skippable, and gone for good once finished.
- **Setup page (1.20):** the checklist (account, a chosen model, local and cloud models, folders, web search, the browser, connectors, disk space, waiting reports, recent errors), problems first, each with a fix button; what you use Titan117 for; the hardware; disk used by local models, the speech model, the browser profile and the log (1.13).
- **Health check (1.21):** tries saved OpenRouter, Anthropic, OpenAI and Google keys with their free checks; a refused key shows as a problem with Replace.
- **Fixed while checking:** the health check's route was read as an id and answered 404; now covered by a test.
- **Tests:** 8 new; 260 in all. **Seen in the real app** (built, Playwright, throwaway data): all three wizard steps, Setup with the checklist after a health check, the wizard not shown again after a restart; no console errors.
- **Not checked:** macOS; a refused key with a real provider (tested with a fake); "Graphics: not used for models" showed on this laptop with a throwaway data folder, worth a look once the local model probe has finished on the owner's own data.
- **Not built yet:** "you need this first" cards inside tasks (1.17, 1.19) and requirements per agent (1.16), which need the agent definitions of phase 11 to list what each needs; guided OS steps (1.14) come with the features that need them (Android SDK, virtualization).

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
