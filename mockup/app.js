// Titan117 desktop app mockup. One state object, rendered on every change.
// Tasks are simulated: steps appear one by one, then the task finishes or waits for your approval.
// Plain JS, no dependencies; assets/bot.js (Titan's eyes) loads first.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ic = (id, style = "") => `<svg class="icon"${style ? ` style="${style}"` : ""}><use href="#i-${id}"/></svg>`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const now = () => new Date().toTimeString().slice(0, 5);

/* ---------- data ---------- */
const AGENTS = {
  titan: { name: "Titan", icon: "sparkles", color: "#ff6347", tag: "General assistant",
    prompts: ["Sort my Downloads folder and delete duplicates.", "Make an Excel report from this month's invoices.", "Convert the videos in /Shoot to MP4.", "Summarise what the agents did this week."] },
  folder: { name: "Folder agent", icon: "folder", color: "#2f6fed", tag: "Your documents",
    prompts: ["Which contracts renew before March?", "Total the invoices from Q1 per client.", "What did we agree with Delta Parts about penalties?", "Find every document with the old address."] },
  recorder: { name: "Recorder", icon: "record", color: "#14a37f", tag: "Repeat it for me",
    prompts: ["Record the weekly stock export.", "Download last month's utility invoices on the 2nd.", "Upload this week's listings to the portal.", "Check the courier site every morning."] },
  watcher: { name: "Web watcher", icon: "eye", color: "#8b5cf6", tag: "Changes that matter",
    prompts: ["Watch environmental law changes daily.", "Tell me when a competitor changes prices.", "Check the tax authority's news every morning.", "Alert me when building rules change."] },
  app: { name: "App builder", icon: "code", color: "#f6a825", tag: "Web, mobile, desktop",
    prompts: ["Build a booking app for my salon.", "Make a simple CRM and add it to the sidebar.", "Create an inventory app for phones.", "Turn my price list into an ordering site."] },
  code: { name: "Code builder", icon: "terminal", color: "#0db5ed", tag: "For developers",
    prompts: ["Fix the failing test in the payments module.", "Add dark mode to the settings page.", "Review this pull request for bugs.", "Upgrade the project's framework."] },
  qa: { name: "QA and tests", icon: "bug", color: "#2a9a30", tag: "Websites and apps",
    prompts: ["Test the checkout on phone and desktop.", "Check my site for accessibility problems.", "Run the tests every night.", "Find the slowest pages on my site."] },
  marketing: { name: "Marketing", icon: "megaphone", color: "#ec4899", tag: "Posts and campaigns",
    prompts: ["Plan a month of LinkedIn posts.", "Write this week's newsletter.", "Turn our blog post into five posts.", "Post our three new products."] },
  seo: { name: "SEO agent", icon: "chart", color: "#7c3aed", tag: "Search visibility",
    prompts: ["Audit my website and fix broken links.", "Which pages lost clicks this month?", "Write a page per service in two languages.", "Check our Google Business Profile."] },
  video: { name: "Promo video", icon: "video", color: "#e24b4a", tag: "Website to video",
    prompts: ["Make a 30-second promo from our website.", "Make a vertical tour of this listing.", "Cut a 15-second ad for the sale.", "A short video for each new product."] },
};
const TEAMS = [["Operations", ["folder", "recorder", "watcher"]], ["Build", ["app", "code", "qa"]], ["Growth", ["marketing", "seo", "video"]]];
const IDLE = "#b4b4bb";

// the open tasks: two waiting for you, one done, one running in the background
let nextId = 1;
const task = (t) => ({ id: nextId++, log: [], ...t });
const done = (t, time = "") => ({ st: "done", t, time });
const S = {
  view: "task",
  current: null,          // task id, or null for a new task
  draftAgent: "titan",    // agent picked for a new task
  insp: true,
  ws: 0,
  credits: 1240,
  tasks: [
    task({ agent: "titan", title: "Invoice report", model: "Qwen 7B · local", status: "wait",
      prompt: "Make an Excel report from this month's invoices folder, flag anything overdue, and send it to me on Telegram.",
      steps: [done("Read 42 invoices in /Invoices/March", "6s"), done("Computed totals and due dates", "2s"), done("Flagged 3 overdue clients", "1s")],
      approve: ["Send the report on Telegram?", "invoices-march.xlsx to your linked Telegram. Nothing else leaves the laptop."],
      big: "42 invoices", out: ["file", "invoices-march.xlsx"], cost: 0,
      uses: [["brain", "Memory: clients"], ["send", "Telegram"], ["sparkles", "Saved as a skill"]] }),
    task({ agent: "marketing", title: "March calendar", model: "Cloud · auto", status: "wait",
      prompt: "Plan a month of posts for LinkedIn and Instagram from our brand kit, around the spring launch.",
      steps: [done("Read brand kit from memory", "1s"), done("Planned 18 posts around 3 dates", "22s"), done("Made images and captions", "2m")],
      approve: ["Add 18 posting reminders?", "LinkedIn × 8, Instagram × 10, ready to post. Each reminder copies the post and opens the platform."],
      big: "18 posts", out: ["calendar", "March content calendar"], cost: 96,
      uses: [["palette", "Brand kit"], ["video", "Promo video"], ["calendar", "Posting reminders"]] }),
    task({ agent: "folder", title: "Contracts", model: "Qwen 7B · local", status: "done",
      prompt: "Which supplier contracts renew automatically before March, and what is the notice period?",
      steps: [done("Indexed /Contracts · 214 files", "38s"), done("OCR on 31 scanned PDFs", "1m"), done("Found 7 matching clauses", "3s")],
      answer: "Seven contracts renew automatically before March. Five need 60 days' notice, two need 30. The earliest is Nord Supply, notice due 1 December.",
      big: "7 contracts", out: ["file", "Nord_supply_2024.pdf · p. 4, §9.2"], cost: 0,
      uses: [["lock", "Never leaves the laptop"], ["brain", "Memory scope: legal"], ["file", "OCR"]] }),
  ],
  background: { watcher: "working" }, // agents busy outside the open tabs
  automations: [
    { name: "Stock export", agent: "recorder", icon: "record", when: "Every Monday 08:00", next: "Mon 08:00", last: "Succeeded", on: true },
    { name: "Law watch", agent: "watcher", icon: "eye", when: "Daily 07:00", next: "Daily 07:00", last: "2 changes found", on: true },
    { name: "SEO re-audit", agent: "seo", icon: "chart", when: "Fridays 18:00", next: "Fri 18:00", last: "14 issues, 9 fixed", on: true },
    { name: "Weekly summary", agent: "titan", icon: "sparkles", when: "Fridays 17:00", next: "Fri 17:00", last: "Sent on Telegram", on: true },
    { name: "Nightly tests", agent: "qa", icon: "bug", when: "Every night 02:00", next: "Paused", last: "48 of 48 passed", on: false },
  ],
  memory: [
    { text: "Atelier Nord makes handmade furniture in Cluj and sells online and in one shop.", scope: "Company" },
    { text: "Invoices are saved in D:/Invoices, one folder per month.", scope: "Titan" },
    { text: "Brand voice: warm, plain, short sentences. No exclamation marks.", scope: "Marketing" },
    { text: "/Contracts is confidential: local models only.", scope: "Folder agent" },
    { text: "Preferred supplier for hardware: Delta Parts.", scope: "Company" },
  ],
  skills: ["Invoice folder → Excel report", "Weekly stock export", "Monthly post calendar"],
};
S.current = S.tasks[0].id;
S.tasks.forEach((t) => (t.log = t.steps.map((s) => [s.st, s.t])));

const WORKSPACES = [["AN", "Atelier Nord", "Pro · 3 devices", ""], ["DP", "Delta Parts", "Starter · 2 devices", "alt"]];

/* ---------- helpers ---------- */
const cur = () => S.tasks.find((t) => t.id === S.current);
const waiting = () => S.tasks.filter((t) => t.status === "wait");
function agentState(id) {
  const ts = S.tasks.filter((t) => t.agent === id);
  if (ts.some((t) => t.status === "wait")) return "approval";
  if (ts.some((t) => t.status === "run")) return "working";
  return S.background[id] || null;
}
const fmt = (n) => n.toLocaleString("en-US");

/* ---------- sidebar: agents (mounted once; their eyes change with state) ---------- */
const bots = {};
function buildAgents() {
  const row = (id) => `<button class="ag" data-ag="${id}"><svg class="bot" aria-hidden="true"></svg><span class="nm">${AGENTS[id].name}</span><span class="ag-st"></span></button>`;
  $("#agents").innerHTML = row("titan") +
    TEAMS.map(([team, ids]) => `<div class="team-label" data-team>${team}<span>${ids.length}</span></div>` + ids.map(row).join("")).join("") +
    `<div class="team-label">Automations<span id="auto-count"></span></div><div id="auto-list"></div>`;
  if (window.TitanBot) $$("#agents .ag").forEach((r) => {
    bots[r.dataset.ag] = TitanBot.mount($("svg", r), { expression: "colere", color: IDLE, follow: false, still: reduced });
  });
  $$("#agents .ag").forEach((r) => r.addEventListener("click", () => openAgent(r.dataset.ag)));
}

function renderSide() {
  const active = S.view === "task" ? (cur()?.agent ?? S.draftAgent) : null;
  $$("#agents .ag").forEach((r) => {
    const id = r.dataset.ag, st = agentState(id), lab = $(".ag-st", r);
    r.classList.toggle("on", id === active);
    lab.className = "ag-st" + (st ? " " + st : "");
    lab.textContent = st === "working" ? "Working" : st === "approval" ? "Needs you" : "";
    bots[id]?.setColor(st ? AGENTS[id].color : IDLE);
    bots[id]?.setState(st === "working" ? "thinking" : st === "approval" ? "notify" : "idle");
  });
  $("#auto-list").innerHTML = S.automations.map((a) =>
    `<div class="auto-row${a.on ? "" : " off"}">${ic(a.icon)}${a.name}<small>${a.on ? a.next : "Paused"}</small></div>`).join("");
  $("#auto-count").textContent = S.automations.filter((a) => a.on).length;
  $$(".nav-row").forEach((b) => b.classList.toggle("on", b.dataset.view === S.view));
  const n = waiting().length || "";
  $("#nav-approvals").textContent = n;
  $("#bar-approvals").textContent = n;
  $("#credits").textContent = `${fmt(S.credits)} / 1,500`;
  $("#credits-bar").style.width = `${Math.round((S.credits / 1500) * 100)}%`;
}

/* ---------- title bar tabs ---------- */
function renderTabs() {
  $("#bar-tabs").innerHTML = S.tasks.map((t) => `
    <div class="bar-tab${t.id === S.current && S.view === "task" ? " on" : ""}" role="tab" data-tab="${t.id}">
      ${t.status === "run" || t.status === "wait" ? '<i class="run"></i>' : ic(AGENTS[t.agent].icon)}
      <span>${esc(t.title)}</span><button class="x" data-close="${t.id}" aria-label="Close ${esc(t.title)}">${ic("x")}</button>
    </div>`).join("") + (S.current === null && S.view === "task" ? `<div class="bar-tab on"><span>New task</span></div>` : "");
  $$("[data-tab]").forEach((el) => el.addEventListener("click", () => { S.view = "task"; S.current = +el.dataset.tab; render(); }));
  $$("[data-close]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = +b.dataset.close, i = S.tasks.findIndex((t) => t.id === id);
    S.tasks.splice(i, 1);
    if (S.current === id) S.current = S.tasks[Math.max(0, i - 1)]?.id ?? null;
    render();
  }));
}

/* ---------- main views ---------- */
function stepHTML(s) {
  const mark = s.st === "done" ? "✓" : s.st === "denied" ? "×" : "";
  return `<div class="step ${s.st}"><i>${mark}</i>${esc(s.t)}<small>${s.time || ""}</small></div>`;
}

function taskView(t) {
  const a = AGENTS[t.agent];
  const helper = t.status === "run" ? "working" : t.status === "wait" ? "waiting for you" : "done";
  let tail = "";
  if (t.status === "wait") tail = `<div class="approve"><b>${esc(t.approve[0])}</b><p>${esc(t.approve[1])}</p>
      <div class="approve-row"><button class="btn primary" data-act="approve">${ic("check")}Approve</button><button class="btn" data-act="review">Review</button><button class="btn" data-act="deny">Deny</button></div></div>`;
  if (t.status === "done" && t.out) tail = `<div class="out">${ic(t.out[0])}${esc(t.out[1])}<button class="btn">Open</button></div>`;
  return `
    <div class="head">
      <div><h1>${esc(t.title)}</h1><small>${a.name} · ${helper}</small></div>
      <div class="seg"><button class="${t.model.includes("local") ? "on" : ""}">Local</button><button class="${t.model.includes("local") ? "" : "on"}">Cloud</button></div>
    </div>
    <div class="scroll" id="scroll"><div class="thread">
      <div class="msg-me">${esc(t.prompt)}</div>
      <div class="msg-ai">
        <span class="who" style="color:${a.color}">${ic(a.icon)}</span>
        <div class="body">
          <span class="name">${a.name}<small>${t.model}</small></span>
          <div class="card"><h5>Steps</h5>${t.steps.map(stepHTML).join("")}</div>
          ${t.answer && t.status === "done" ? `<p>${esc(t.answer)}</p>` : ""}
          ${tail}
          ${t.result ? `<div class="done-note">${ic("check")}${esc(t.result)}</div>` : ""}
        </div>
      </div>
    </div></div>
    ${composer(t.agent, t.model)}`;
}

function helloView() {
  const a = AGENTS[S.draftAgent];
  return `
    <div class="head"><div><h1>New task</h1><small>${a.name} · ${a.tag}</small></div>
      <div class="seg"><button class="on">Local</button><button>Cloud</button></div></div>
    <div class="scroll"><div class="thread">
      <div class="hello"><svg class="bot" id="hello-bot" aria-hidden="true"></svg>
        <h2>What should ${a.name === "Titan" ? "Titan" : "the " + (/^[A-Z]{2}/.test(a.name) ? a.name : a.name[0].toLowerCase() + a.name.slice(1))} do?</h2>
        <p>${a.name === "Titan" ? "Ask for anything on your computer. Big jobs go to the right specialist." : `Hand ${a.name} a job, or ask Titan and it will route it.`} Anything that leaves the laptop waits for your OK.</p>
      </div>
      <div class="suggest">${a.prompts.map((p) => `<button data-prompt="${esc(p)}">${ic("chat")}${esc(p)}</button>`).join("")}</div>
    </div></div>
    ${composer(S.draftAgent, "Qwen 7B · local")}`;
}

function composer(agent, model) {
  return `<div class="composer-wrap"><div class="composer">
    <textarea id="input" rows="2" placeholder="Ask ${AGENTS[agent].name} anything…  (Enter to send, Shift+Enter for a new line)"></textarea>
    <div class="composer-row">
      <button class="chip">${ic("clip")}Attach</button>
      <button class="chip">${ic(AGENTS[agent].icon)}${AGENTS[agent].name}</button>
      <button class="chip">${ic("cpu")}${model}</button>
      <span class="cost">${model.includes("local") ? "est. 0 credits" : "est. 20–60 credits"}</span>
      <button class="send" id="send" disabled aria-label="Send">${ic("arrow-up")}</button>
    </div></div></div>`;
}

function approvalsView() {
  const list = waiting();
  return `<div class="head"><div><h1>Approvals</h1><small>Nothing leaves your laptop until you say so</small></div></div>
    <div class="scroll"><div class="list">
      ${list.length ? list.map((t) => `
        <div class="row" data-row="${t.id}">
          <span class="who" style="color:${AGENTS[t.agent].color}">${ic(AGENTS[t.agent].icon)}</span>
          <div class="txt"><b>${esc(t.approve[0])}</b><small>${AGENTS[t.agent].name} · ${esc(t.title)} · ${esc(t.approve[1])}</small></div>
          <div class="acts"><button class="btn" data-open="${t.id}">Open</button><button class="btn" data-deny="${t.id}">Deny</button><button class="btn primary" data-approve="${t.id}">Approve</button></div>
        </div>`).join("")
      : `<div class="empty">${ic("shield")}<b>All clear</b><span>No task is waiting for you.</span></div>`}
    </div></div>`;
}

function automationsView() {
  return `<div class="head"><div><h1>Automations</h1><small>Run while the app is open; missed runs catch up on the next launch</small></div>
      <button class="btn primary">${ic("record")}Record new</button></div>
    <div class="scroll"><div class="list">
      ${S.automations.map((a, k) => `
        <div class="row">
          <span class="who" style="color:${AGENTS[a.agent].color}">${ic(a.icon)}</span>
          <div class="txt"><b>${a.name}</b><small>${AGENTS[a.agent].name} · ${a.when} · last run: ${a.last}</small></div>
          <span class="tag">${ic("clock", "width:11px;height:11px")}${a.on ? a.next : "Paused"}</span>
          <button class="switch" role="switch" aria-checked="${a.on}" aria-label="Run ${a.name}" data-auto="${k}"></button>
        </div>`).join("")}
    </div></div>`;
}

function memoryView() {
  return `<div class="head"><div><h1>Memory</h1><small>What your agents remember. Edit or forget anything.</small></div></div>
    <div class="scroll"><div class="list">
      ${S.memory.map((m, k) => `
        <div class="row" data-mem="${k}">
          <span class="who">${ic("brain")}</span>
          <div class="txt"><b>${esc(m.text)}</b></div>
          <span class="tag">${esc(m.scope)}</span>
          <button class="btn" data-forget="${k}">Forget</button>
        </div>`).join("") || `<div class="empty">${ic("brain")}<b>Nothing remembered</b></div>`}
      <div class="list-head" style="margin-top:14px"><div><b>Skills</b><p>How Titan does things it has done before. Plain files you can edit.</p></div></div>
      ${S.skills.map((s) => `<div class="row"><span class="who">${ic("sparkles")}</span><div class="txt"><b>${esc(s)}</b><small>skills/${esc(s.toLowerCase().replace(/[^a-z]+/g, "-"))}.md</small></div><button class="btn">Edit</button></div>`).join("")}
    </div></div>`;
}

/* ---------- inspector ---------- */
function renderInsp() {
  const t = S.view === "task" ? cur() : null;
  if (!t) {
    const working = Object.keys(AGENTS).filter((id) => agentState(id) === "working").length;
    $("#insp").innerHTML = `
      <h4>Today</h4>
      <div class="insp-block"><div class="kv">Open tasks<b>${S.tasks.length}</b></div><div class="kv">Waiting for you<b>${waiting().length}</b></div>
        <div class="kv">Agents working<b>${working}</b></div><div class="kv">Automations on<b>${S.automations.filter((a) => a.on).length}</b></div></div>
      <h4>Credits</h4>
      <div class="insp-block"><div class="big">${fmt(S.credits)}</div><div class="bar-meter"><div style="width:${Math.round((S.credits / 1500) * 100)}%"></div></div>
        <p class="help">Local models, previews and tests never use credits.</p></div>`;
    return;
  }
  const label = { run: "Running", wait: "Needs approval", done: "Done" }[t.status];
  const pct = t.status === "done" ? 100 : Math.min(95, 20 + t.steps.length * 22);
  $("#insp").innerHTML = `
    <h4>Task</h4>
    <div class="insp-block">
      <span class="status ${t.status}"><i></i>${label}</span>
      <div class="big">${esc(t.big || t.title)}</div>
      <div class="bar-meter"><div style="width:${pct}%"></div></div>
      <div class="kv">Agent<b>${AGENTS[t.agent].name}</b></div>
      <div class="kv">Model<b>${t.model}</b></div>
      <div class="kv">Cost<b>${t.cost} credits</b></div>
    </div>
    <h4>Uses</h4>
    <div class="uses">${(t.uses || []).map(([i, x]) => `<span>${ic(i)}${esc(x)}</span>`).join("")}</div>
    ${t.out ? `<h4>Output</h4><div class="out" style="animation:none">${ic(t.out[0])}${esc(t.out[1])}</div>` : ""}
    <h4>Activity</h4>
    <div class="term">${t.log.map(([st, x], k) => `<div><em>09:${String(12 + k * 2).padStart(2, "0")}</em> ${st === "done" ? "✓" : st === "denied" ? "×" : "<b>●</b>"} ${esc(x.toLowerCase())}</div>`).join("")}</div>`;
}

/* ---------- render ---------- */
function render() {
  const main = $("#main");
  const t = cur();
  main.innerHTML = S.view === "approvals" ? approvalsView()
    : S.view === "automations" ? automationsView()
    : S.view === "memory" ? memoryView()
    : t ? taskView(t) : helloView();
  if (S.view === "task" && !t && window.TitanBot) TitanBot.mount($("#hello-bot"), { expression: "colere", color: AGENTS[S.draftAgent].color, follow: !reduced, still: reduced });
  renderTabs(); renderSide(); renderInsp();
  wireMain();
  const sc = $("#scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
}

function wireMain() {
  const input = $("#input"), send = $("#send");
  if (input) {
    input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input.value); } });
    send.addEventListener("click", () => submit(input.value));
  }
  $$("[data-prompt]").forEach((b) => b.addEventListener("click", () => submit(b.dataset.prompt)));
  $$("[data-act]").forEach((b) => b.addEventListener("click", () => {
    const t = cur();
    if (b.dataset.act === "approve") decide(t, true);
    if (b.dataset.act === "deny") decide(t, false);
    if (b.dataset.act === "review") b.textContent = "Opened in preview";
  }));
  $$("[data-approve],[data-deny]").forEach((b) => b.addEventListener("click", () => {
    const id = +(b.dataset.approve || b.dataset.deny), row = b.closest(".row");
    row.classList.add("leaving");
    setTimeout(() => decide(S.tasks.find((t) => t.id === id), !!b.dataset.approve), reduced ? 0 : 280);
  }));
  $$("[data-open]").forEach((b) => b.addEventListener("click", () => { S.view = "task"; S.current = +b.dataset.open; render(); }));
  $$("[data-auto]").forEach((b) => b.addEventListener("click", () => { const a = S.automations[+b.dataset.auto]; a.on = !a.on; render(); }));
  $$("[data-forget]").forEach((b) => b.addEventListener("click", () => { S.memory.splice(+b.dataset.forget, 1); render(); }));
}

/* ---------- actions ---------- */
function decide(t, yes) {
  if (!t || t.status !== "wait") return;
  t.steps.push(yes ? done("Approved by you", now()) : { st: "denied", t: "Denied by you", time: now() });
  t.log.push(yes ? ["done", "approved by you"] : ["denied", "denied by you"]);
  t.status = "done";
  t.result = yes ? "Done. " + t.approve[0].replace(/\?$/, "").replace(/^(\w+)/, (w) => ({ Send: "Sent", Schedule: "Scheduled", Publish: "Published", Open: "Opened" }[w] || w)) + "." : "Stopped. Nothing left the laptop.";
  if (!yes) t.out = null;
  render();
}

function openAgent(id) {
  const t = [...S.tasks].reverse().find((x) => x.agent === id);
  S.view = "task";
  if (t) S.current = t.id; else { S.current = null; S.draftAgent = id; }
  render();
}

// a simulated run: plan, three steps, then an approval for anything outward-facing
function submit(text) {
  text = (text || "").trim();
  if (!text) return;
  const agent = cur()?.agent ?? S.draftAgent;
  const outward = /\b(send|post|publish|email|schedule|delete|upload|open a pull)\w*/i.test(text);
  const local = !/\b(app|video|posts?|newsletter|campaign)\b/i.test(text);
  const t = task({
    agent, title: text.replace(/[.?!].*$/, "").split(" ").slice(0, 4).join(" "), prompt: text,
    model: local ? "Qwen 7B · local" : "Cloud · auto", status: "run", steps: [], cost: 0, big: null,
    approve: outward ? [text.match(/\b(send|post|publish|email|schedule|delete|upload)\w*/i)[0].replace(/^\w/, (c) => c.toUpperCase()) + " it now?", "Titan prepared everything. Approve to let it leave the laptop."] : null,
    out: ["file", "result-" + now().replace(":", "") + (local ? ".xlsx" : ".pdf")],
    uses: [["brain", "Memory"], ["shield", outward ? "Needs approval" : "Read-only"], ["cpu", local ? "Local model" : "OpenRouter"]],
  });
  S.tasks.push(t); S.view = "task"; S.current = t.id;
  render();
  const plan = [
    [`Planned it · 3 steps`, "2s"],
    [`${AGENTS[agent].name === "Titan" ? "Worked through" : "Handed to " + AGENTS[agent].name + ":"} ${text.split(" ").slice(0, 5).join(" ").toLowerCase()}…`, "6s"],
    ["Checked the result", "1s"],
  ];
  let k = 0;
  const tick = () => {
    if (!S.tasks.includes(t)) return; // closed meanwhile
    if (k > 0) { t.steps[k - 1].st = "done"; t.log[k - 1][0] = "done"; }
    if (k < plan.length) {
      t.steps.push({ st: "run", t: plan[k][0], time: plan[k][1] }); t.log.push(["run", plan[k][0]]); k++;
      render(); setTimeout(tick, reduced ? 150 : 1100);
      return;
    }
    if (!local) { t.cost = 24; S.credits -= 24; }
    t.big = t.approve ? "Ready" : "Done";
    if (t.approve) { t.status = "wait"; t.log.push(["run", "waiting for your approval"]); }
    else { t.status = "done"; t.answer = "Done. The result is saved on your laptop and listed below."; }
    render();
  };
  setTimeout(tick, reduced ? 100 : 500);
}

/* ---------- chrome wiring ---------- */
$$("[data-view]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; if (S.view === "task" && !cur()) S.current = S.tasks.at(-1)?.id ?? null; render(); }));
const newTask = () => { S.view = "task"; S.current = null; S.draftAgent = "titan"; render(); $("#input")?.focus(); };
$("#new-task").addEventListener("click", newTask);
$("#new-tab").addEventListener("click", newTask);
$("#toggle-inspector").addEventListener("click", (e) => {
  S.insp = !S.insp; $("#win").classList.toggle("no-insp", !S.insp); e.currentTarget.setAttribute("aria-pressed", S.insp);
});
$("#ws").addEventListener("click", (e) => {
  const m = $("#ws-menu"); m.hidden = !m.hidden; e.currentTarget.setAttribute("aria-expanded", !m.hidden);
});
$$("[data-ws]").forEach((b) => b.addEventListener("click", () => {
  const [ini, name, plan, cls] = WORKSPACES[+b.dataset.ws];
  $("#ws-ic").textContent = ini; $("#ws-ic").className = "ws-ic " + cls; $("#ws-name").textContent = name; $("#ws-plan").textContent = plan;
  $("#ws-menu").hidden = true;
}));
document.addEventListener("click", (e) => { if (!e.target.closest(".ws-wrap")) $("#ws-menu").hidden = true; });
$(".search input").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  $$("#agents .ag").forEach((r) => { r.hidden = q && !$(".nm", r).textContent.toLowerCase().includes(q); });
  $$("#agents [data-team]").forEach((l) => { l.hidden = !!q; });
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newTask(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $(".search input").focus(); }
});

buildAgents();
render();
