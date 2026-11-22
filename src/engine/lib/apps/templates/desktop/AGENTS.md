# How this desktop app is built

Made with Titan117's app builder. Notes for anyone (or any coding agent) changing it.

- **Stack:** Tauri 2 (a small Rust program in `src-tauri/` that opens a native window) showing a web page made with React 19, TypeScript, Vite and Tailwind CSS 4 (`src/`). On Windows the window uses WebView2 (Chromium); on a Mac, WebKit.
- **Where to work:** almost everything is in `src/`. Change `src-tauri/` only for things a web page can't do (files, menus, system tray), and then add the matching Tauri plugin and its permission in `src-tauri/capabilities/default.json`. Never widen the window's content security policy in `tauri.conf.json` to load scripts from other websites.
- **Commands:** `npm run dev` (the page in a browser), `npm run typecheck`, `npm run build`, `npm test`. All four must pass. `npm run tauri dev` opens the real window and `npm run tauri build` makes the Windows installer (NSIS); both need Rust and, on Windows, Microsoft's C++ build tools.
- **Browser first:** Titan117 previews and tests the page in a browser, where Tauri isn't there. Call Tauri only through `@tauri-apps/api`, inside `if (isTauri())` (from `@tauri-apps/api/core`), so the page still works in the preview.
- **Name and description** live in `app.config.json`; the window's title and the installer's name in `src-tauri/tauri.conf.json` (`productName`).
- **Desktop first:** a window from 800×600 up to a full screen; keyboard shortcuts and visible focus; text selectable where people copy it; dark mode with `dark:` classes.
- **Tests:** `src/*.test.tsx` with Vitest; render with `react-dom/server` (no window needed).
- **The icon** is `app-icon.svg`; `npm run tauri icon app-icon.svg` makes the icon files the installer needs.
- **No secrets** in the code or in `.env` files committed to git.
