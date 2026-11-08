# Open-source references

17 Oct 2026. The best open-source projects to learn from or build on, per feature area and phase. Before building a phase, read the references listed for it. Feature numbers point to the [feature map](brainstorming-feature-map.md); phase numbers to the [roadmap](../01-launch-roadmap-v1.md).

## How to use this file

- **Where the code lives:** clone each project into **`D:\Officials\titan117-references\<area>\<project>`**, next to the three repos but outside them (a local folder, never pushed), so reference code never ends up in them by accident. The "Folder" column below is the path inside that root.
- **Pin it:** shallow-clone (`git clone --depth 1`), then write the commit into the project's row (the **Commit** column). Update deliberately, not by habit. **Clone per phase, just before it starts**, not everything at once. (The 53 study repos, about 7 GB, downloaded on 17 Oct 2026 are no longer on this machine; the commits and licence checks recorded below are still valid.) On Windows, clone with `-c core.longpaths=true` (n8n and Twenty need it).
- **Licence first:** open the project's `LICENSE` file and fill in the **Licence checked** column before reading code to copy. Rows marked *to check* below are what we believe, not confirmed.
- **Reuse rule (decisions §4):** MIT, Apache 2.0, BSD, ISC: copy and adapt, keep notices, add a row to the sources list. **MPL 2.0:** use as a library unchanged; changes to its own files must stay MPL. **GPL, AGPL, fair-code, source-available:** ideas only, or run unchanged as a separate program.
- **Treat it as untrusted:** read it, don't run it. No `npm install` or install scripts in the reference folder; if a project must be run to understand it, do it in a VM.
- **Notes per project:** add a `NOTES.md` next to each clone: what it does well, the key files, what we take, what we don't. That's the "better data" for when we build.

Legend for **Use:** **Code** = we may copy and adapt; **Lib** = we use it as a dependency; **Ideas** = study only.

---

## Closest products (read these first)

The projects most like Titan117: local-first desktop apps (Electron) that run persistent AI agents on the user's machine. Grok Bot, the managed cloud service from xAI that both describe themselves as alternatives to, is closed source.

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) | Agents as chat contacts, each with its own model, memory, computer and apps; local harness server on 127.0.0.1; Electron app, onboarding, companion app | Apache 2.0 | Code | `closest/openmausbot` | Apache 2.0, except `enterprise/` (separate licence, see `LICENSING.md`): don't copy from enterprise | `988e15ceb090` |
| [nightly-labs/openbot](https://github.com/nightly-labs/openbot) | Persistent agents you tag like teammates; many agent back-ends; marketplace; Electron app | PolyForm Noncommercial | Ideas | `closest/openbot` | PolyForm Noncommercial 1.0.0: no commercial use, ideas only | `1f65659de93c` |
| OpenClaw (phase 3 below) | General agent with tools, skills and chat channels | MIT | Code | `titan/openclaw` | see below | see below |
| Goose (phase 1 below) | Desktop agent app with MCP | Apache 2.0 | Code | `core/goose` | see below | see below |

**Note:** OpenMausBot's main idea is running the user's installed Claude, Codex or Grok command-line agents with their existing logins. For Titan117 that conflicts with decisions §3 (no sign-in with chat subscriptions), so we take its architecture and UX, not that part.

## Phase 1 · Engine core

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [electron/electron](https://github.com/electron/electron) | The shell; security checklist, utility processes | MIT | Lib | `core/electron` | | |
| [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) | Packaging, signing, `electron-updater` auto-update | MIT | Lib | `core/electron-builder` | | |
| [block/goose](https://github.com/block/goose) | Desktop agent app with MCP built in: agent loop, tool permissions, Electron UI | Apache 2.0 | Code | `core/goose` | Apache 2.0 | `bfcc6ee6f1ee` |
| [vercel/ai](https://github.com/vercel/ai) | Model abstraction, streaming, tool calls, MCP client | Apache 2.0 | Lib | `core/vercel-ai` | Apache 2.0 | `fce9210c6405` |
| [withcatai/node-llama-cpp](https://github.com/withcatai/node-llama-cpp) | Running llama.cpp from Node, model download, GPU detection | MIT | Lib | `core/node-llama-cpp` | MIT | `10e58c743b93` |
| [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | Local inference engine | MIT | Lib | `core/llama-cpp` | | |
| [ollama/ollama](https://github.com/ollama/ollama) | Model management UX, model library ideas | MIT | Ideas | `core/ollama` | MIT | `d1ed3fd13ac7` |
| [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Local database from Node | MIT | Lib | `core/better-sqlite3` | | |
| [OpenRouterTeam](https://github.com/OpenRouterTeam) SDKs and examples | Key management API, streaming, usage | *to check* | Lib | `core/openrouter` | | |

## Phase 2 · Accounts and money

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| Ninjathons (our own repo) | Convex guardrail wrappers, Stripe webhook, entitlements, denial tests, data-deletion table | ours | Code | — | — | — |
| [stripe-samples](https://github.com/stripe-samples) | Subscriptions, one-time payments, webhooks, customer portal | MIT | Code | `money/stripe-samples` | | |
| [get-convex](https://github.com/get-convex) templates and components | Convex with Clerk, rate limiting, crons | Apache 2.0 *to check* | Code | `money/convex` | | |

## Phase 3 · Titan and memory

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | General agent: tools, skills, chat channels, what to make safer | MIT *to check* | Code | `titan/openclaw` | MIT | `139b998d0b6a` |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Persistent memory, self-written skills | MIT *to check* | Code | `titan/hermes-agent` | MIT | `7e9eb8d9a30f` |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | Memory layer: extraction, update, scopes | Apache 2.0 | Code | `titan/mem0` | Apache 2.0 | `0724291bd864` |
| [letta-ai/letta](https://github.com/letta-ai/letta) | Long-term memory design for agents | Apache 2.0 | Ideas | `titan/letta` | Apache 2.0 | `5bcdd177d70f` |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MCP client | MIT | Lib | `titan/mcp-sdk` | | |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Reference MCP servers (files, git, fetch) | MIT | Code | `titan/mcp-servers` | MIT moving to Apache 2.0 (mixed per contribution) | `bbb701e7ac1e` |
| [openai/codex](https://github.com/openai/codex) | Command sandboxing per OS, approval modes | Apache 2.0 | Code | `titan/codex` | Apache 2.0 | `ce0323f2f2d3` |
| [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) | Desktop chat with local models, agents, workspaces | MIT | Code | `titan/anything-llm` | MIT | `d7d68e75c422` |
| [janhq/jan](https://github.com/janhq/jan) | Local-model desktop app UX | Apache 2.0 | Code | `titan/jan` | Apache 2.0 | `a86d87ebcfb7` |
| [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) | Multi-model chat UI, artifacts, MCP | MIT | Code | `titan/librechat` | MIT | `e081b566a42d` |

## Phase 4 · Web search and artifacts

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [deedy5/ddgs](https://github.com/deedy5/ddgs) | Free-mode metasearch | MIT | Code | `search/ddgs` | MIT | `70a5635510fb` |
| [Aas-ee/open-webSearch](https://github.com/Aas-ee/open-webSearch) | Free-mode search server | Apache 2.0 *to check* | Code | `search/open-websearch` | Apache 2.0 | `fb11fd94df73` |
| [mozilla/readability](https://github.com/mozilla/readability) | Page to clean text | Apache 2.0 | Lib | `search/readability` | | |
| [adbar/trafilatura](https://github.com/adbar/trafilatura) | Main-text extraction | Apache 2.0 | Code | `search/trafilatura` | Apache 2.0 | `e2f85c965662` |
| [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) | Whole-site crawling to text | Apache 2.0 *to check* | Code | `search/crawl4ai` | Apache 2.0 | `94b67888ca8b` |
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Deep research loop and reports | Apache 2.0 *to check* | Code | `search/gpt-researcher` | Apache 2.0 | `3582a6841fe7` |
| [ItzCrazyKns/Perplexica](https://github.com/ItzCrazyKns/Perplexica) | Answer engine with sources | MIT *to check* | Code | `search/perplexica` | MIT | `348feca3e378` |
| [dolanmiu/docx](https://github.com/dolanmiu/docx) | Word export | MIT | Lib | `artifacts/docx` | | |
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | PowerPoint export | MIT | Lib | `artifacts/pptxgenjs` | | |
| [exceljs/exceljs](https://github.com/exceljs/exceljs) | Excel export | MIT | Lib | `artifacts/exceljs` | | |
| [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) | Diagrams | MIT | Lib | `artifacts/mermaid` | | |
| [hakimel/reveal.js](https://github.com/hakimel/reveal.js) | Slides | MIT | Lib | `artifacts/revealjs` | | |

## Phase 5 · Install and setup

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| electron-builder (above) | Installers, signing, updates | MIT | Lib | — | | |
| [sebhildebrandt/systeminformation](https://github.com/sebhildebrandt/systeminformation) | Hardware check (RAM, GPU, disk) | MIT | Lib | `setup/systeminformation` | | |
| Goose, AnythingLLM, Jan (above) | First-run and model-download flows | — | Ideas | — | | |

## Phase 6 · Folder agent

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [docling-project/docling](https://github.com/docling-project/docling) | PDF, Office and scan parsing with layout | MIT | Lib (separate Python program) | `docs/docling` | | |
| [microsoft/markitdown](https://github.com/microsoft/markitdown) | Office and PDF to Markdown | MIT | Lib (separate Python program) | `docs/markitdown` | | |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | PDF reading in Node and the viewer | Apache 2.0 | Lib | `docs/pdfjs` | | |
| [mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) | Word to text and HTML | BSD-2 | Lib | `docs/mammoth` | | |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | OCR | Apache 2.0 | Lib | `docs/tesseract-js` | | |
| [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) | Vector search in SQLite | MIT or Apache 2.0 | Lib | `docs/sqlite-vec` | | |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | Local embeddings (multilingual, for example bge-m3) | Apache 2.0 | Lib | `docs/transformers-js` | | |
| AnythingLLM (above) | Document workspaces and citations | MIT | Code | — | | |

## Phase 7 · Coding engine and code builder

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | **The coding engine** (headless server, TypeScript SDK) | MIT | Lib | `code/opencode` | MIT | `22e771f5893e` |
| [cline/cline](https://github.com/cline/cline) | Approval flow, diff review UX | Apache 2.0 | Code | `code/cline` | Apache 2.0 | `a42df8c8d5fd` |
| [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) | Orchestrator and sub-agent modes | Apache 2.0 | Code | `code/kilocode` | MIT | `1552877e82ce` |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Repo map, git-first edits | Apache 2.0 | Ideas | `code/aider` | Apache 2.0 | `5dc9490bb35f` |

## Phase 8 · App builder: web

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [dyad-sh/dyad](https://github.com/dyad-sh/dyad) | **Closest to us:** local Electron app builder with Ollama and OpenRouter | Apache 2.0 (some parts may differ) *to check* | Code | `builder/dyad` | Apache 2.0, except `src/pro` (separate licence): don't copy from src/pro | `486403e0ed14` |
| [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | Prompt-to-app loop, multi-provider | MIT | Code | `builder/bolt-diy` | MIT | `353b44c8f386` |
| [firecrawl/open-lovable](https://github.com/firecrawl/open-lovable) | Lovable-style builder | MIT *to check* | Code | `builder/open-lovable` | MIT | `806b8072f28a` |
| [get-convex/chef](https://github.com/get-convex/chef) | App builder on Convex | Apache 2.0 | Code | `builder/convex-chef` | Apache 2.0 | `d8a6cb6a6f22` |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | Visual edit: click an element, change it (6.9) | Apache 2.0 | Code | `builder/onlook` | Apache 2.0 | `423e2e924366` |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | Components for generated apps | MIT | Code | `builder/shadcn-ui` | MIT | `d2fba50ee5b9` |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Browser tests in three engines | Apache 2.0 | Lib | `builder/playwright` | | |

## Phase 9 · App builder: mobile and desktop

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [expo/expo](https://github.com/expo/expo) | Mobile apps, Expo Go, EAS | MIT | Lib | `mobile/expo` | | |
| [mobile-dev-inc/maestro](https://github.com/mobile-dev-inc/maestro) | Automated taps and checks on emulators | Apache 2.0 | Lib | `mobile/maestro` | | |
| [appium/appium](https://github.com/appium/appium) | Alternative mobile automation | Apache 2.0 | Ideas | `mobile/appium` | Apache 2.0 | `8f57e0492cc8` |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | Desktop apps users build | MIT or Apache 2.0 | Lib | `mobile/tauri` | | |
| [containers/podman](https://github.com/containers/podman) | Backends in containers (separate program) | Apache 2.0 | Lib | `mobile/podman` | | |

## Phase 10 · Sidebar apps

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [twentyhq/twenty](https://github.com/twentyhq/twenty) | CRM data model and UI ideas for templates | AGPL *to check* | Ideas | `apps/twenty` | AGPL (mostly): ideas only | `e7743ba77003` |
| [nocodb/nocodb](https://github.com/nocodb/nocodb) | Shared tables and views | Sustainable Use (fair-code) | Ideas | `apps/nocodb` | Sustainable Use (fair-code): ideas only | `10f215665687` |
| [electric-sql](https://github.com/electric-sql) or [rocicorp](https://github.com/rocicorp) sync engines | Local-first sync for sidebar apps | Apache 2.0 *to check* | Ideas | `apps/sync` | | |

## Phase 11 · Agent builder

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) | Multi-agent graphs, hand-offs | MIT | Code | `agents/langgraphjs` | MIT | `cc29753d529c` |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js) | Agents, hand-offs, guardrails patterns | MIT *to check* | Code | `agents/openai-agents-js` | MIT | `9687b544c8c8` |
| [activepieces/activepieces](https://github.com/activepieces/activepieces) | Connector catalogue and builder UI | MIT (community edition) *to check* | Code | `agents/activepieces` | MIT, except `packages/ee` (commercial): don't copy from ee | `860ce5b87c43` |
| [n8n-io/n8n](https://github.com/n8n-io/n8n) | Workflow builder UX | Fair-code (Sustainable Use) | Ideas | `agents/n8n` | Sustainable Use (fair-code), `.ee` files enterprise: ideas only | `936349a9c77c` |

## Phase 12 · QA and SEO agents

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | AI browser exploration | MIT | Code | `qa/browser-use` | MIT | `ccd22fef47a1` |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | AI browser actions in TypeScript | MIT | Code | `qa/stagehand` | MIT | `10418f988312` |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Browser control through MCP | Apache 2.0 | Lib | `qa/playwright-mcp` | Apache 2.0 | `b8b4183e099f` |
| [dequelabs/axe-core](https://github.com/dequelabs/axe-core) | Accessibility checks | MPL 2.0 | Lib | `qa/axe-core` | | |
| [GoogleChrome/lighthouse](https://github.com/GoogleChrome/lighthouse) | Speed and SEO scores | Apache 2.0 | Lib | `qa/lighthouse` | | |
| [harlan-zw/unlighthouse](https://github.com/harlan-zw/unlighthouse) | Lighthouse across a whole site | MIT | Code | `seo/unlighthouse` | MIT | `c3d5c5f6357a` |
| [StJudeWasHere/seonaut](https://github.com/StJudeWasHere/seonaut) | Site audit checks | MIT | Code | `seo/seonaut` | MIT | `a67387fe63a2` |
| [janreges/siteone-crawler](https://github.com/janreges/siteone-crawler) | Site crawler and reports | MIT | Code | `seo/siteone-crawler` | MIT | `f3d967b190a7` |
| [towfiqi/serpbear](https://github.com/towfiqi/serpbear) | Rank tracking | MIT | Code | `seo/serpbear` | MIT | `a1328fb4142d` |
| Skyvern | AI browser automation | AGPL | Ideas | — | | |

## Phase 13 · Automation

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [puppeteer/replay](https://github.com/puppeteer/replay) | Replaying recorded browser steps | Apache 2.0 | Code | `auto/puppeteer-replay` | Apache 2.0 | `6b51dcb1df24` |
| Playwright codegen (in Playwright) | Recording browser actions | Apache 2.0 | Code | — | | |
| [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) | Computer use: screenshots, actions | Apache 2.0 *to check* | Code | `auto/ui-tars-desktop` | Apache 2.0 | `3ac2cb8d946d` |
| [nut-tree/nut.js](https://github.com/nut-tree/nut.js) | Mouse and keyboard control | No licence file found | Ideas | `auto/nutjs` | No licence file in repo: ideas only | `e413fa1f19a1` |
| Open Interpreter | Computer use | AGPL | Ideas | — | | |

## Phase 14 · Marketing and video

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [redotvideo/revideo](https://github.com/redotvideo/revideo) | **Video from code**, rendering API | MIT *to check* | Code | `video/revideo` | MIT | `b5de67a009a5` |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | Code-driven animation | MIT | Code | `video/motion-canvas` | MIT | `7b91435c301d` |
| [mifi/editly](https://github.com/mifi/editly) | JSON-to-video edits | MIT *to check* | Code | `video/editly` | MIT | `dc46674052ea` |
| FFmpeg (LGPL build) | Encoding and formats (separate program) | LGPL | Lib | `video/ffmpeg` | | |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) and kokoro-js | Local voiceover (TTS) | Apache 2.0 | Lib | `video/kokoro` | | |
| Piper TTS | Local TTS | Now GPL *to check* | Ideas | — | | |
| [inovector/mixpost](https://github.com/inovector/mixpost) | Social scheduling (Lite edition) | MIT *to check* | Code | `marketing/mixpost` | MIT | `df57648b8663` |
| [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) | Social scheduling, many platforms | AGPL | Ideas | `marketing/postiz` | AGPL: ideas only | `08b1e6b46f49` |
| [umami-software/umami](https://github.com/umami-software/umami) | Privacy-friendly analytics for built sites | MIT | Code | `marketing/umami` | MIT | `ec0ff50388c2` |
| Listmonk, Mautic, Plausible | Newsletters, sequences, analytics | AGPL, GPL, AGPL | Ideas | `marketing/…` | | |

## Phase 15 · Remote and channels

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [grammyjs/grammY](https://github.com/grammyjs/grammY) | Telegram bots | MIT | Lib | `remote/grammy` | | |
| [slackapi/bolt-js](https://github.com/slackapi/bolt-js) | Slack app | MIT | Lib | `remote/slack-bolt` | | |
| [discordjs/discord.js](https://github.com/discordjs/discord.js) | Discord bot | Apache 2.0 | Lib | `remote/discordjs` | | |
| Meta WhatsApp Cloud API docs and samples | Official WhatsApp API (bring-your-own) | *to check* | Lib | `remote/whatsapp` | | |
| [jedisct1/libsodium.js](https://github.com/jedisct1/libsodium.js) | End-to-end encryption | ISC | Lib | `remote/libsodium` | | |

## Phase 16 · Marketplace

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [octokit/octokit.js](https://github.com/octokit/octokit.js) | GitHub API and GitHub App | MIT | Lib | `market/octokit` | | |
| [google/osv-scanner](https://github.com/google/osv-scanner) | Dependency vulnerability scan | Apache 2.0 | Lib | `market/osv-scanner` | | |
| [licensee/licensee](https://github.com/licensee/licensee) | Licence detection | MIT | Ideas | `market/licensee` | MIT | `e56521d7e811` |
| [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) | Secret scanning (also our CI) | MIT | Lib | `market/gitleaks` | | |

---

## Website and brand

| Project | What to take | Licence (believed) | Use | Folder | Licence checked | Commit |
|---|---|---|---|---|---|---|
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | Orchestrates Claude Code, Codex, Cursor, OpenCode, Antigravity and Grok from one window with the user's own sign-ins: the model for feature 13.14 (decisions §20) | MIT | Ideas | not cloned | MIT | |
| [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub) | Agent avatars: one SVG shape morphing through 15 states (thinking, notify, orbit…), 8 shapes, 16 expressions, eyes that follow the pointer. Its framework-free `src/bot/` engine will draw the logo and every agent avatar; the homepage logo's eyes run its bundled build (`homepage-grid/assets/bot.js`) | MIT | Code | `avatars/bloub` | MIT (Jérémy Perret, 2026) | `b4bb3c1` |
| [ayangabryl/asciify-engine](https://github.com/ayangabryl/asciify-engine) | ASCII backgrounds. The old mockup's ASCII field (`mockup/src/js/10-bg.js`, removed with the mockups on 7 Nov 2026; still in git history) ported its `caustics`, `contour` and `ripple` scenes, its value noise and its lantern hover (`src/field/field-shaders.ts`, `src/field/glyph-field.ts`): lines one cell wide via `fwidth` | MIT | Code | not cloned | MIT (ayangabryl, 2026) | `8925e5b` |

**Note:** bloub's author describes it as a recreation of the x.ai bot avatar. The code is MIT, but the look is xAI's: before launch we restyle it (our own shapes, eyes and colours) (decisions §9).

## Also worth doing

1. **A docs cache of official documentation** for our stack (Electron, Convex, Clerk, Stripe, OpenRouter, Next.js, Expo, Playwright, OpenCode), saved locally like Ninjathons' `.docs-cache`. Agents building a phase read the real, current API instead of memory.
2. **A pinned-clone script:** one script that clones every row at its recorded commit into `titan117-references`, so the folder can be rebuilt anywhere.
3. **The sources list** (decisions §4) as its own file in each product repo, filled whenever code is copied.
4. **Review this file at the start of each phase:** confirm licences, pick the final project per row, write its `NOTES.md`.
