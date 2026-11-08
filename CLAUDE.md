# Titan117

Local-first AI team for small companies: a desktop app (agents run on the user's laptop) and a web app (accounts, plans, credits, remote control). Planning docs are in [`docs/`](docs/README.md). This file is copied into every repo: `titan117-web`, `titan117-desktop` and `titan117-pop` (the product owner portal).

# Progress log

After finishing any piece of work, update `docs/progress.md` in the same commit: add a log entry under today's date (newest first) and update the phase table and the "Now / Next step" line if they changed. Phases are defined in `docs/01-launch-roadmap-v1.md`.

# Before you build

- **Decisions:** `docs/notes/decisions.md` wins over every other doc. A new decision gets a row and a section there in the same commit.
- **Guardrails:** follow `docs/guardrails.md`. Every rule names what enforces it; a phase is done only when its check passes and "done means done" is met.
- **Design:** the desktop app follows `docs/notes/design.md` (no black buttons or selections; tomato for actions); the website follows `homepage-grid/design.md` (web repo).
- **Security:** `docs/security.md` (protecting users, protecting us). Remote control off by default with two-factor; nothing secret in the app.
- **Architecture:** `docs/03-architecture.md`. The engine's permission and approval layer is the only way to touch files, shell, network or the browser. Every Convex function uses the guardrail wrappers.
- **Open source:** before building a phase, read its references in `docs/notes/open-source-references.md` (code in `D:\Officials\titan117-references`, cloned per phase, never pushed). Copy code only from MIT, Apache 2.0, BSD or ISC projects, and add it to the sources list. GPL, AGPL and fair-code are ideas only (decisions §4).
- **Secrets:** never in code, logs, memory or fixtures (guardrails §8).
- **Third-party services:** before specifying or building anything that uses one, its row in `docs/notes/external-services.md` must be checked against the vendor's own docs (guardrails §11b). Default: the user's own account, acting as the user.
- **New Convex tables** get a row in the data table in decisions §11.

# Shared docs

Shared docs (everything in `docs/` except `progress.md`: roadmap, architecture, guardrails, security, design, decisions, feature map, scope, pricing, open-source references, brand) are edited in `titan117-web` and copied to `titan117-desktop` and `titan117-pop`, together with this file (`python scripts/sync-docs.py`). Each repo keeps its own `docs/progress.md`.
