# design.md · Titan117 design system (desktop app)

Version 0.3 · 27 Nov 2026 (replaces 0.2 of 7 Nov 2026; decisions §67, to be confirmed)

The desktop app's design rules. Layout v2 was worked out in the clickable mockup `titan117-desktop/mockup/layout-v2/index.html` with the **Azure** accent, the owner's choice of several. Its layout and neutral palette take their direction from the layout of Google's Antigravity app, as **our own version**: no Antigravity logo, icons or exact visual details. The mockup is a direction, not a pixel spec. The website keeps its own system in [`homepage-grid/design.md`](../../homepage-grid/design.md); the website and the logo keep tomato.

**What changed from 0.2:** the window is grey with the chat and the right panel as two white rounded sheets; the sidebar is short (folders with their tasks nested, everything settings-like under Customize); the steps fold into one line; the message box floats. **Tomato is no longer the action colour in the app:** actions use the Azure gradient with white text, and Send is that gradient (0.2's rule "tomato for actions" and the tomato send button are replaced; "no black buttons" still holds). Titan's own colour stays tomato.

---

## 1. Principles

1. **Quiet confidence.** Greys do the work. The interface doesn't shout.
2. **Black is for reading.** Text, done marks, progress bars and the activity log. Never a button, never a selection.
3. **The gradient is for acting.** Approve, Send, the update pill, counts that need you, the running step. Everything else stays neutral.
4. **Agents have faces.** Each agent keeps its own colour for its eyes and dot (Titan tomato); at rest the eyes are grey.
5. **Sheets on grey.** The window is `--side` grey; the chat and the right panel are white sheets with a hairline and 12px top corners, 8px apart. Shadows only on floating things: the message box, menus, Ctrl K.
6. **Readable first.** Text on white is at least 4.5:1; state always has a label or icon as well as a colour.

---

## 2. Colour

### 2.1 Neutrals

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1f1f1f` | Body text, headings, done marks, progress bars (16.5:1 on white) |
| `--soft` | `#3c4043` | Secondary text in rows and steps (10.5:1) |
| `--muted` | `#5f6368` | Captions, icons at rest, the "worked for" line (6.1:1) |
| `--faint` | `#6c7277` | Hints, placeholders, section labels, ages (4.9:1 on white, 4.6:1 on `--side`). The agreed `#80868b` reads 3.7:1, so the app uses the nearest grey that passes |
| `--line` | `#e3e3e3` | Every hairline and outline |
| `--side` | `#f7f7f7` | The window, the sidebar, your message bubbles |
| `--hover` | `#ebebeb` | Hover on rows and icon buttons, empty meters |
| `--sel` | `#e9e9e9` | The selected row and tab |
| `--panel` | `#fafafa` | The right panel's Task tab |
| `--white` | `#ffffff` | The chat and right sheets, cards, the message box |
| Activity log | `#0f0f10` on, text `#d4d4d8` | The one black surface: a terminal-like log |

### 2.2 Accent: Azure

| Token | Value | Use |
|---|---|---|
| `--grad` | `linear-gradient(135deg, #5b9dff 0%, #3a86ff 50%, #2fb4f0 100%)` | Fills with white text: Approve, Send, Share, the update pill, counts, Needs you, the running status; the running step's dot and the "is working" text |
| `--accent` | `#2f7cf6` | Focus ring, checkboxes and switches (never text: 3.9:1) |
| `--accent-deep` | `#1a5fd0` | Links and blue text on white (5.9:1) |
| `--tint` | `#f1f7ff` | Approval cards, chosen chips |
| `--tint-line` | `#d2e4ff` | Outline of tinted cards |

**White text on the gradient** is the owner's choice and reads 2.4–3.5:1 (below 4.5:1), so it's used only at 11px and up, weight 600, on short labels. A deeper version that passes (`#1f6fe8 → #1a6ae0 → #0b78b5`, 4.7–5.0:1) stays on record as a one-line change; the owner kept the Azure gradient as it is (27 Nov 2026).

Red stays red: errors `#e24b4a` (text `#b42318`), the recording dot, removed lines in a diff, setup problems.

### 2.3 Agent colours

Only for an agent's own eyes, its dot and its icon, never for text, actions or large areas.

| Agent | Colour | Agent | Colour |
|---|---|---|---|
| Titan | `#ff6347` | Code builder | `#0db5ed` |
| Folder agent | `#2f6fed` | QA and tests | `#2a9a30` |
| Recorder | `#14a37f` | Marketing | `#ec4899` |
| Web watcher | `#8b5cf6` | SEO agent | `#7c3aed` |
| App builder | `#f6a825` | Promo video | `#e24b4a` |

### 2.4 Status

| State | Shown as |
|---|---|
| Idle | Grey eyes, no label; the task's age in the sidebar |
| Working | Eyes in the agent's colour, "thinking"; a gradient dot on the task's row; "Titan is working · step 3" in gradient text |
| Needs you | Eyes in the agent's colour, "notify"; a gradient dot on the task's row; the approvals count on the toolbar |
| Done | Black check marks; a green pill `#e3f3e4` / `#1c6b21` in the Task tab |
| Error | `#e24b4a` dot (text `#b42318`) |
| Waiting | Amber pill `#fdf0d9` / `#8a5300` |

---

## 3. Typography

**Figtree** (400, 500, 600) for everything; **Unbounded 600** for the TITAN117 wordmark only (website); `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for costs, file names, shortcuts and the activity log.

| Role | Size / line height | Weight |
|---|---|---|
| Start screen heading | 22px / 1.3 | 600, -0.02em |
| View title | 15px / 1.4 | 600, -0.01em |
| The answer | 13.5px / 1.6 | 400 |
| Body, steps, rows | 13px / 1.5 | 400 (500 for the selected row, the running step) |
| Breadcrumb | 13.5px | 400, the task title 500 |
| Captions, labels, ages | 12px | 400, `--faint` (labels are sentence case now, not uppercase) |
| Mono details | 10.5–12px | 400 |

---

## 4. Spacing, radius, elevation

- **Spacing:** 4px steps inside controls, 8px grid for layout (8, 12, 16, 24, 40). The two sheets are 8px apart.
- **Radius:** 7–9px on rows, buttons, chips and tabs; 12px on the sheets' top corners, cards and approvals; 16px on the message box and bubbles; 50% on dots, Send and avatars.
- **Elevation:** none for surfaces. The message box `0 8px 28px rgba(24,24,27,.08)`; menus and Ctrl K `0 18px 40px -18px rgba(0,0,0,.35)`.
- **Borders:** 1px `--line`.

---

## 5. Layout

The window is `--side` grey: a **toolbar** 44px across the top, then a grid of **sidebar** 252px, the **chat sheet**, and the **right sheet** 440px (380px below 1180px wide) with an 8px gap. The minimum window is 900 × 600; the usual sizes are 1280 × 800 (the default), 1440 × 900 and 1000 × 700.

### Toolbar
Titan's eyes (ink at rest; tomato while something works or waits), the sidebar toggle (Ctrl B), Back and Forward (Alt ← / →), search (Ctrl K); then the breadcrumb "folder / **task title**" (or the screen's name); on the right the update pill ("Restart to update →", gradient), approvals with a gradient count, and the right-panel toggle (Ctrl .).

### Sidebar (top to bottom)
1. **New task**: white, outlined with a hairline, `Ctrl N`. Not a filled button.
2. **Automations, Apps** (the user's sidebar apps nested under it), **Agents, Customize** ("memory, keys…").
3. **Folders**: each allowed folder (+ to allow one, × on hover to stop allowing it) with the tasks that worked in it nested below, each with its age on the right, or a dot when it works, needs you or failed.
4. **Tasks**: tasks that haven't worked in a folder.
5. **Foot:** Settings (account, engine and version, report a problem).

**Customize** gathers Memory, Connectors, Add-ons, Models, Keys, Web search, Remote control, Setup and Compare as cards, then "More screens": Approvals, Code, Documents, Artifacts and Marketing. **Ctrl K** searches tasks, screens, agents and folders.

### Chat sheet
The conversation in a centred column of 760px. The message box floats over the bottom of the sheet; the chat scrolls under it.

### Right sheet
Its own rounded white sheet. Tabs for each artifact and file the task made, then **Task**: status, the folder, agent and model, context used, cost so far, steps, what it made, the sites it reached, parts handed out, team talk and the activity log. A file tab shows what was written with Show in folder; an artifact tab shows the artifact with its tools. It opens on its own when an agent makes an artifact, and from a "files made" card's Open.

**The drawer:** opening and closing animates the grid column and slides the sheet 48px with a fade, in 0.4s with `cubic-bezier(.2, .8, .2, 1)` (the fade 0.25s). With `prefers-reduced-motion` it opens and closes at once. An artifact at full width takes the chat's column.

---

## 6. Components

**Buttons** (28–34px in the app)
- Primary: the gradient, white text, weight 600 (Approve, Share, Resume). Hover brightens 6%.
- Secondary: white, 1px `--line`, `--soft` text; hover `--hover`.
- Icon buttons: 28px, no fill; hover `--hover`.
- **Never** a black or `--ink` fill.

**Selection:** the selected row or tab is `--sel` grey, text `--ink` weight 500. No coloured bars, no black fills, no white-with-hairline (0.2).

**Your message:** a `--side` bubble, no hairline, right-aligned, radius 16px, at most 75% wide.

**Agent reply:** no bubble. One line, "● Titan worked for 48s · 6 steps · $0.004 ›" in `--muted` with the agent's dot; while it works, "Titan is working · step 2" in gradient text. The line folds the steps: folded when done, open while working. Steps sit on a 2px `--line` rail: a black check when done, a pulsing gradient dot when running, struck through in `--faint` when not run; words said between steps stay with them. Then the answer, at 13.5px.

**Files made:** a hairline card, "2 files made: `november-totals.csv`, `late-clients.md`" (names in mono, green) and Open, which opens the file in the right sheet.

**Approval card:** inline in the chat, `--tint` fill, `--tint-line` outline, a bold question, one line of what will happen, review folds, then Approve (gradient), Always in this task, Deny. Also listed in Approvals and counted on the toolbar.

**Start screen** (an agent with no task): Titan's eyes at 64px in tomato, "What should the … do?", one line on approvals, suggested prompts as cards.

**Message box:** floating, white, hairline, 16px radius, the soft shadow; a textarea ("Ask Titan anything…"), then: + (allow a folder, deep research), the agent picker with its dot, the model picker, the estimate in mono, the ask level ("🔒 Asks before changes": it says how approvals work; there is no setting to lower it), the microphone, and a round gradient Send (grey when empty; Stop while it works). As the box narrows the estimate goes first, then the ask level's words. Enter sends, Shift+Enter adds a line.

**Lists** (Approvals, Automations, Memory): white rows with a hairline and 12px radius: an icon tile, a title and one muted line, tags, actions.

**Cards** (Customize, Settings): white, hairline, 12px radius, an icon tile, a title and one muted line; hover `--side`.

**Menus and Ctrl K:** white, hairline, 12–14px radius, soft shadow; the active row in `--sel`.

---

## 7. Logo and Titan's eyes

- **Logo:** Titan's angry eyes (the bloub engine, MIT, `expression: "colere"`) beside **TITAN117** in Unbounded 600. Ink at rest, looking around on their own; tomato on hover (website). In the app's toolbar the eyes alone, ink at rest, tomato while working or waiting.
- **Agents:** the same eyes in each agent's colour (§2.3), animated by state (§2.4). Grey when idle.
- The shapes must still be restyled as our own and trademark-checked before beta (decisions §9).

---

## 8. Motion

| What | How |
|---|---|
| New messages, cards, opened steps | fade + 6px rise, .3–.35s |
| The right sheet (drawer) | grid column and 48px slide .4s `cubic-bezier(.2,.8,.2,1)`, fade .25s |
| Running step | gradient dot, pulse 1.2s |
| "Working" label | shimmer, 1.6s loop |
| The fold's › | turns 90°, .25s |
| Eyes | idle wander; "thinking" while working; "notify" when waiting |
| Progress and context meters | width eases .8s |

Easing `cubic-bezier(.2, .7, .2, 1)` unless said. `prefers-reduced-motion`: no animation or transition, the eyes hold still, state still shows by colour and label.

---

## 9. Accessibility

- Text on white at least 4.5:1: `--ink` 16.5, `--soft` 10.5, `--muted` 6.1, `--faint` 4.9, `--accent-deep` 5.9. `--accent` is never text. White on the gradient is the exception in §2.2, on the owner's word.
- State is always colour **and** a label or icon.
- Focus ring: 2px `--accent`, 2px offset.
- Keyboard: `Ctrl N` new task, `Ctrl K` search, `Ctrl B` sidebar, `Ctrl .` right panel, `Alt ←/→` back and forward, Enter to send; every control is a button with a name; the right panel's tabs are a tablist.
- Targets: 28px minimum in dense rows, 32px for Send.

---

## 10. Media

No product screenshots or video yet. The mockup `titan117-desktop/mockup/layout-v2/` is the reference until the real app's screenshots replace it.
