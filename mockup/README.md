# Titan117 desktop app mockup

A simple, clickable mockup of the desktop app, grown from the app window in the website's hero (`homepage-grid/` in `titan117-web`). Moved here from the web repo on 7 Nov 2026: it's the reference for the real desktop app. Static HTML, CSS and JavaScript; nothing is real, tasks are simulated.

```powershell
python -m http.server 4181 --directory mockup
```

Run it from the `titan117-desktop` folder, then open http://localhost:4181 (or start `desktop-mockup` from `.claude/launch.json`). Made for windows at least 900px wide; below 1180px the task details panel hides.

## What's in it

- **Title bar:** window dots, one tab per open task (a tomato dot while it runs or waits for you), new task, memory, approvals with a count, and a button that shows or hides the task details.
- **Sidebar:** workspace switcher (two example workspaces), New task, search (filters the agents), the views (Tasks, Approvals, Automations, Memory), Titan and the nine specialists in their teams with their eyes (gray at rest, in their colour while working or waiting for you), the automations with their next run, credits, and the user.
- **Tasks:** your request in a gray bubble, the agent's steps, an approval card (Approve, Review, Deny), the result. Type a task and press Enter: it plans, runs three steps, then waits for your approval if it sends, posts, publishes, schedules, deletes or uploads anything, or finishes. Clicking an agent with no task opens a start screen with its eyes and four suggested prompts.
- **Approvals:** every task waiting for you, approve or deny from the list.
- **Automations:** the scheduled runs, each with an on/off switch that also updates the sidebar.
- **Memory:** what the agents remember, with Forget, and the saved skills.
- **Task details:** status, result, model, cost, what the task uses, the output, and the black activity log.

Shortcuts: `Ctrl N` new task, `Ctrl K` search, `Enter` send, `Shift+Enter` new line.

## Design

Follows the website's app window (`homepage-grid/design.md` §7, in `titan117-web`): light-gray sidebar, white workspace, black only for text, done marks and the activity log; selected rows are white with a hairline (no black buttons or selections); actions are tomato (`--accent` in `app.css`). Titan's eyes come from `assets/bot.js` (the bloub engine, MIT; a copy of the website's). The icons are the website's set plus gear, clip, pause and panel.

The rules this mockup sets are written in `docs/notes/design.md` 0.2 (decisions §19).
