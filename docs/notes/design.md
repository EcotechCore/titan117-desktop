# design.md · Titan117 design system (desktop app)

Version 0.2 · 7 Nov 2026 (replaces 0.1 of 16 Oct 2026; decisions §19)

The desktop app's design rules, written from the clickable mockup in the desktop repo (`titan117-desktop/mockup/`), which grew out of the app window on the website. The website has its own system in [`homepage-grid/design.md`](../../homepage-grid/design.md); both share the colours, type and logo below.

**What changed from 0.1:** neon green `#c4f012` is gone. The one accent is **tomato `#ff6347`**, the font is Figtree, and the logo is Titan's angry eyes next to the TITAN117 wordmark. The rule that matters most stays: **no black buttons or selections in the app.**

---

## 1. Principles

1. **Quiet confidence.** White, light gray and black do the work. The interface doesn't shout.
2. **Black is for reading.** Text, done marks, progress bars and the activity log. Never a button, never a selection.
3. **Tomato is for acting.** New task, Approve, Send, the running step, counts that need you. Several actions may be tomato on one screen; everything else stays neutral.
4. **Agents have faces.** Each agent shows Titan's eyes in its own colour while it works; at rest the eyes are gray.
5. **Flat, with hairlines.** Surfaces separate by fill (gray sidebar, white workspace, `#fafafa` panels) and 1px hairlines. Shadows only on floating things: menus, the message box, product windows on the website.
6. **Readable first.** Body text near-black on white; state always has a label as well as a colour.

---

## 2. Colour

### 2.1 Neutrals

| Token | Value | Use |
|---|---|---|
| `--ink` | `#18181b` | Body text, headings, done marks, progress bars, the workspace initials tile |
| `--soft` | `#3f3f46` | Secondary text in rows and steps |
| `--muted` | `#71717a` | Captions, subtitles, icons at rest |
| `--faint` | `#a1a1aa` | Hints, placeholders, section labels, timestamps |
| `--line` | `#e7e7ea` | Every hairline and outline |
| `--side` | `#f4f4f5` | Sidebar, title bar, your message bubbles, segmented controls |
| `--hover` | `#ececee` | Hover on rows and icon buttons, empty progress tracks |
| `--panel` | `#fafafa` | The task details panel |
| `--white` | `#ffffff` | Workspace, cards, selected rows |
| Activity log | `#0f0f10` on, text `#d4d4d8` | The one black surface: a terminal-like log |

### 2.2 Accent: tomato

| Token | Value | Use |
|---|---|---|
| `--accent` | `#ff6347` | Primary actions (fill with white text), the running step, live dots, approval counts, focus ring |
| `--accent-deep` | `#c2361f` | Tomato text on white (labels, links that must read "brand") |
| `--tint` | `#fff3f0` | Approval cards, the running step's ring |
| `--tint-line` | `#ffd3c9` | Outline of tinted cards |

Tomato is never body text on white (2.9:1); use `--accent-deep` for tomato-coloured text. White text on a tomato fill is used only at 11px+ weight 500+ on buttons and pills.

### 2.3 Agent colours

Only for an agent's own eyes, its dot and its icon, never for text or large areas.

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
| Idle | Gray eyes `#b4b4bb`, no label |
| Working | Eyes in the agent's colour, "thinking" animation, a shimmering "Working" label |
| Needs you | Eyes in the agent's colour, "notify" animation, a tomato "Needs you" pill; a tomato dot on its tab; the approvals count |
| Done | Black check marks; a green dot `#2a9a30` in the details panel |
| Error | `#e24b4a` dot and label (text on white `#b42318`) |
| Offline | Gray `#8e8ea0` dot and "Offline" |

---

## 3. Typography

**Figtree** (400, 500, 600) for everything; **Unbounded 600** for the TITAN117 wordmark only; `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for times, costs, file names, shortcuts and the activity log.

| Role | Size / line height | Weight |
|---|---|---|
| Start screen heading | 22px / 1.3 | 600, -0.02em |
| View title | 15px / 1.4 | 600, -0.01em |
| Body, steps, rows | 13px / 1.5 | 400 (500 for the running step and row titles) |
| Captions, subtitles | 11–12px | 400 |
| Section labels | 10px, uppercase, 0.08em | 500, `--faint` |
| Mono details | 10–10.5px | 400 |

---

## 4. Spacing, radius, elevation

- **Spacing:** 4px steps inside controls, 8px grid for layout (8, 12, 16, 24, 40).
- **Radius:** 7–9px on rows, buttons and inputs; 12px on cards and panels; 14–16px on the message box and bubbles; 50% on dots and avatars.
- **Elevation:** none for surfaces. Menus `0 18px 40px -18px rgba(0,0,0,.25)`; the message box `0 4px 18px -10px rgba(0,0,0,.2)`; a selected row `0 1px 2px rgba(0,0,0,.05)`.
- **Borders:** 1px `--line`.

---

## 5. Layout

The window is a grid: **title bar** 40px across the top, then **sidebar** 252px, **workspace**, and the **task details** panel 320px (toggleable).

- Below 1180px wide the details panel hides; below 900px the mockup asks for a larger window.
- The workspace centres its content at 760px (tasks) or 820px (lists).
- Only the sidebar's agent list, the workspace and the details panel scroll; the title bar, the sidebar's top and foot, and the message box stay put.

### Title bar
Window dots, one tab per open task (white with a hairline when current, a tomato dot while it runs or waits, a close × on hover), a + for a new task, then on the right: memory, approvals (tomato count), and the details toggle.

### Sidebar (top to bottom)
1. **Workspace switcher:** a black initials tile, the workspace name and plan, ↕; opens a menu of workspaces.
2. **New task:** tomato fill, white text, `Ctrl N`.
3. **Search** (white, hairline, `Ctrl K`): filters the agents.
4. **Views:** Tasks, Approvals (tomato count), Automations, Memory.
5. **Agents:** Titan, then the teams, Operations (folder agent, recorder, web watcher), Build (app builder, code builder, QA), Growth (marketing, SEO, promo video), each row with the agent's eyes, its name and its state.
6. **Automations:** each scheduled run with its next time in mono; paused ones in `--faint`.
7. **Foot:** credits (used / monthly, a black bar) and the user with settings.

---

## 6. Components

**Buttons** (28–34px in the app)
- Primary: `--accent` fill, white text (New task, Approve, Send, Record new). Hover `#f4533a`.
- Secondary: white, 1px `--line`, `--soft` text; hover darkens the outline.
- Icon buttons: 28px, no fill; hover `--hover`.
- **Never** a black or `--ink` fill.

**Selection:** the selected row (view, agent, tab) is white with a 1px `--line` and a tiny shadow, text weight 500. No coloured bars, no black fills.

**Segmented control** (Local / Cloud): `--side` track, the chosen option white with a hairline.

**Your message:** a `--side` bubble with a hairline, right-aligned, radius 14/14/4/14.

**Agent reply:** the agent's icon in a small tile, its name with the model in `--faint`, then a **steps card** (white, hairline): done steps have a black check; the running step has a tomato ring with a spinner; denied steps are struck through in `--faint`; times in mono on the right.

**Approval card:** `--tint` fill, `--tint-line` outline, a bold question, one line of what will happen, then Approve (tomato), Review, Deny. Shown in the thread, listed in Approvals, counted on the bar and in the sidebar.

**Result:** a hairline row with the file icon in tomato and an Open button; a short "Done. …" line with a tomato check after an approval.

**Start screen** (an agent with no task): the agent's eyes at 64px following the cursor, "What should the … do?", one line on approvals, four suggested prompts as cards.

**Message box:** white, hairline, 16px radius, soft shadow; a textarea, then chips (Attach, the agent, the model), the estimated cost in mono, and a tomato send button (gray when empty). Enter sends, Shift+Enter adds a line.

**Lists** (Approvals, Automations, Memory): white rows with a hairline and 12px radius: an icon tile, a title and one muted line, tags, actions. Automations use a switch (tomato when on); memory rows have Forget; skills show their file name.

**Task details:** status pill (tomato running, amber `#ef9f27` waiting, green done), the result in large type, a black progress bar, agent / model / cost, "Uses" chips, the output, and the black activity log (time in gray, ✓ done, tomato ● running).

**Menus:** white, hairline, 12px radius, soft shadow; rows highlight in `--side`.

---

## 7. Logo and Titan's eyes

- **Logo:** Titan's angry eyes (the bloub engine, MIT, `expression: "colere"`) beside **TITAN117** in Unbounded 600. Ink at rest, looking around on their own; tomato on hover (website).
- **Agents:** the same eyes in each agent's colour (§2.3), animated by state (§2.4). Gray when idle.
- The shapes must still be restyled as our own and trademark-checked before beta (decisions §9).

---

## 8. Motion

| What | How |
|---|---|
| New messages, steps, cards | fade + 6px rise, .35–.4s |
| Running step | spinner in a tomato ring |
| "Working" label | shimmer, 1.6s loop |
| Eyes | idle wander; "thinking" while working; "notify" when waiting |
| Leaving a list | slide right and fade, .3s |
| Progress and credits bars | width eases .8s |

Easing `cubic-bezier(.2, .7, .2, 1)`. `prefers-reduced-motion`: no animation, the eyes hold still, state still shows by colour and label.

---

## 9. Accessibility

- Body text `#18181b` on white; secondary `#71717a`. Tomato text uses `#c2361f`.
- State is always colour **and** a label or icon.
- Focus ring: 2px tomato, 2px offset.
- Keyboard: `Ctrl N` new task, `Ctrl K` search, Enter to send; every control is a button with a name; tabs have close buttons with labels.
- Targets: 28px minimum in dense rows, 34px for primary actions.

---

## 10. Media

No product screenshots or video yet. The website's app window and this mockup are the reference until the real app exists.
