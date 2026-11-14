# titan117-desktop

The Titan117 desktop app: Electron with React and TypeScript. The agents, the engine and everything local run here.

- **Docs:** [`docs/`](docs/README.md), copied from `titan117-web` (edit them there). Working rules: [`CLAUDE.md`](CLAUDE.md).
- **Design reference:** the clickable mockup in [`mockup/`](mockup/README.md); rules in [`docs/notes/design.md`](docs/notes/design.md).

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Cloud models need a development OpenRouter key until accounts arrive in phase 2: copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY`. It is read only when the app runs from source. Local models download from the Models view and need the Microsoft Visual C++ runtime 14.40 or newer on Windows.

## Where things are

- `src/main/`: the Electron shell. It starts the engine and shows the window.
- `src/engine/`: the Titan engine, its own process. Tools are made only with `defineTool` and run only through the permission layer (`permissions.ts`); only `engine/lib` and `engine/tools/lib` may touch files, processes or the network (guardrails §4).
- `src/renderer/`: the window. It talks to the engine's local API and nothing else.
- `src/shared/`: the local API's types.

## Checks

```bash
pnpm lint
```

```bash
pnpm test
```

## Build

```bash
pnpm build:win
```

```bash
pnpm build:mac
```
