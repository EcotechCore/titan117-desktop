# Sources

Code we copied or adapted from other projects (guardrails §11, decisions §4). Each one's licence notice also goes into the third-party licences file shipped with the app (phase 5). Libraries we only depend on are covered by the licence check (`pnpm check:licenses`), not listed here.

| Project | Licence | What we took | Where | Commit |
|---|---|---|---|---|
| [openai/codex](https://github.com/openai/codex) | Apache 2.0 | The Seatbelt base rules for sandboxed commands on macOS (`codex-rs/sandboxing/src/seatbelt_base_policy.sbpl`: deny by default, processes, signals and process info within the sandbox), adapted and shortened | `src/engine/lib/shell.ts` (`seatbeltProfile`) | `ce0323f2f2d3` |
