# Sources

Code we copied or adapted from other projects (guardrails §11, decisions §4). Each one's licence notice also goes into the third-party licences file shipped with the app (phase 5). Libraries we only depend on are covered by the licence check (`pnpm check:licenses`), not listed here.

| Project | Licence | What we took | Where | Commit |
|---|---|---|---|---|
| [openai/codex](https://github.com/openai/codex) | Apache 2.0 | The Seatbelt base rules for sandboxed commands on macOS (`codex-rs/sandboxing/src/seatbelt_base_policy.sbpl`: deny by default, processes, signals and process info within the sandbox), adapted and shortened | `src/engine/lib/shell.ts` (`seatbeltProfile`) | `ce0323f2f2d3` |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 | Apache 2.0 | Two one-line fixes to the library itself: language data given as bytes is joined by its code (`src/worker-script/index.js`), and in Node the LSTM-only flag picks the LSTM core builds (`src/worker-script/node/getCore.js`) | `patches/tesseract.js@7.0.0.patch` (applied by pnpm on install) | npm 7.0.0 |

## Programs the app downloads and runs unchanged

Downloaded on first use, pinned and checked against hashes in `src/engine/lib/code/components.ts` (decisions §53). Their notices go into the third-party licences file with the rest.

| Program | Licence | What it is | Version |
|---|---|---|---|
| [anomalyco/opencode](https://github.com/anomalyco/opencode) (`opencode-<os>-<arch>` from npm) | MIT. The program is built with [Bun](https://github.com/oven-sh/bun) (MIT), whose runtime statically links **JavaScriptCore (LGPL-2)** from [oven-sh/WebKit](https://github.com/oven-sh/WebKit) and tinycc (LGPL-2.1); shipped unchanged, with Bun's relinking instructions at [bun.com/docs/project/license](https://bun.com/docs/project/license) | The coding engine, run as its own program on 127.0.0.1 | 1.19.6 (tag `v1.19.6`, `f4e363c`) |
| [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | MIT or Unlicense | Code search for OpenCode | 15.1.0 |
