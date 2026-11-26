/**
 * `titan.json`, the add-on manifest (features 10.1, 10.2, 18.5; decisions
 * §66.2): what an add-on is, what it brings and what it asks for. Read by
 * Convex when it lists a repository in the marketplace and by the laptop
 * before anything is installed. Plain checks, no dependencies.
 *
 * The desktop repo keeps a byte-identical copy (src/shared/addon-manifest.ts);
 * the cases in addons.test.ts are checked on both sides.
 */

/** The manifest format this code reads. */
export const ADDON_FORMAT = 1;

/** The GitHub topic that puts a repository in the marketplace's index (decisions §66.3). */
export const ADDON_TOPIC = "titan117-addon";

export const ADDON_TYPES = ["agent", "skill", "tool", "app-template", "sidebar-app", "mcp-server", "workflow"] as const;
export type AddonType = (typeof ADDON_TYPES)[number];

export const ADDON_RISKS = ["read", "write", "external"] as const;
export type AddonRisk = (typeof ADDON_RISKS)[number];

export interface AddonParam {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
}

export interface AddonToolSpec {
  /** Lower case, digits and underscores. */
  name: string;
  description: string;
  risk: AddonRisk;
  params: { type: "object"; properties: Record<string, AddonParam>; required: string[] };
}

export interface AddonManifest {
  titan: 1;
  type: AddonType;
  /** A slug: the add-on's id on the laptop. */
  name: string;
  title: string;
  version: string;
  description: string;
  /** The licence the author declares (an SPDX id); the laptop also reads the licence file. */
  license: string | null;
  /** type "agent": the agent file (decisions §59.1). */
  agent: string | null;
  /** type "agent" or "skill": skill files. */
  skills: string[];
  /** type "tool": one JavaScript file, the hosts it may reach, and its tools. */
  tool: { main: string; hosts: string[]; tools: AddonToolSpec[] } | null;
  /** type "app-template" or "sidebar-app": the folder with the app's files. */
  app: { dir: string } | null;
  /**
   * type "mcp-server" (decisions §66.21): a connector, either an address or an
   * npm package pinned to an exact version, and the secrets the user must give.
   */
  mcp: { url: string; npm: null; args: string[]; secrets: string[] } | { url: null; npm: string; args: string[]; secrets: string[] } | null;
  /** type "workflow" (decisions §66.21): a schedule that starts a task for an agent. */
  workflow: { when: AddonWhen; agent: string; prompt: string } | null;
}

/** When a workflow runs: the schedule kinds an add-on may bring (no folders, no one-offs). */
export type AddonWhen =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string; days?: number[] }
  | { kind: "monthly"; day: number; time: string };

export type ManifestResult = { ok: true; manifest: AddonManifest } | { ok: false; error: string };

const NAME = /^[a-z][a-z0-9-]{1,29}$/;
const TOOL = /^[a-z][a-z0-9_]{1,25}$/;
const PARAM = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z.-]{1,20})?$/;
const SPDX = /^[A-Za-z0-9.+-]{2,40}$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_TOOLS = 20;
const MAX_HOSTS = 10;
const MAX_SKILLS = 20;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,40}$/;
const ARG = /^[A-Za-z0-9_\-./:=@]{1,100}$/;
const NPM_PINNED = /^(@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,100}@\d{1,6}\.\d{1,6}\.\d{1,8}(-[0-9A-Za-z.-]{1,30})?$/;

/** A path inside the add-on: forward slashes, no `..`, nothing absolute or hidden. */
export function safeAddonPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const p = path.trim().replace(/^\.\//, "");
  if (!p || p.length > 200 || p.includes("\\") || p.includes("\0") || p.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return p === "." ? "." : null;
  return p;
}

/** A public host name an add-on tool may reach; never an address, a port or `localhost`. */
export function addonHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase();
  if (!HOST.test(host)) return null;
  if (host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  return host;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\p{Cc}+/gu, " ").trim().slice(0, max) : "";
}

function fail(error: string): ManifestResult {
  return { ok: false, error };
}

/** Names that act outside are "external" whatever the tool says (decisions §28, §66.6). */
const EXTERNAL_VERB =
  /(^|_)(send|post|publish|delete|remove|destroy|pay|charge|refund|transfer|invite|share|reply|forward|archive|trash|merge|push|tweet|comment|cancel)(_|$)/;

export function addonToolRisk(name: string, declared: AddonRisk): AddonRisk {
  return EXTERNAL_VERB.test(name) ? "external" : declared;
}

function parseTool(raw: unknown, index: number): AddonToolSpec | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `Tool ${index + 1} isn't an object.`;
  const t = raw as Record<string, unknown>;
  const name = typeof t.name === "string" ? t.name : "";
  if (!TOOL.test(name)) return `Tool ${index + 1} needs a name of 2 to 26 small letters, digits and underscores.`;
  const description = text(t.description, 500);
  if (!description) return `Say what the tool ${name} does.`;
  if (!ADDON_RISKS.includes(t.risk as AddonRisk))
    return `The tool ${name} must say its risk: "read", "write" or "external".`;
  const params = (t.params ?? { type: "object", properties: {}, required: [] }) as Record<string, unknown>;
  if (!params || typeof params !== "object" || params.type !== "object")
    return `The tool ${name}'s params must be an object schema.`;
  const props = (params.properties ?? {}) as Record<string, unknown>;
  if (!props || typeof props !== "object" || Array.isArray(props)) return `The tool ${name}'s params are malformed.`;
  const properties: Record<string, AddonParam> = {};
  for (const [key, value] of Object.entries(props).slice(0, 30)) {
    if (!PARAM.test(key)) return `The tool ${name} has a parameter with a bad name.`;
    const p = (value ?? {}) as Record<string, unknown>;
    if (!["string", "number", "boolean"].includes(p.type as string))
      return `The parameter ${key} of ${name} must be a string, number or boolean.`;
    const param: AddonParam = { type: p.type as AddonParam["type"], description: text(p.description, 300) };
    if (Array.isArray(p.enum)) param.enum = p.enum.filter((e): e is string => typeof e === "string").slice(0, 50);
    properties[key] = param;
  }
  const required = Array.isArray(params.required)
    ? params.required.filter((r): r is string => typeof r === "string" && r in properties)
    : [];
  return {
    name,
    description,
    risk: addonToolRisk(name, t.risk as AddonRisk),
    params: { type: "object", properties, required },
  };
}

/** Check a parsed `titan.json`; returns it cleaned, or why it can't be used. */
export function parseAddonManifest(raw: unknown): ManifestResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("titan.json must be a JSON object.");
  const m = raw as Record<string, unknown>;
  if (m.titan !== ADDON_FORMAT) return fail(`titan.json must say "titan": ${ADDON_FORMAT}.`);
  if (!ADDON_TYPES.includes(m.type as AddonType))
    return fail(`"type" must be one of: ${ADDON_TYPES.join(", ")}.`);
  const type = m.type as AddonType;
  const name = typeof m.name === "string" ? m.name : "";
  if (!NAME.test(name)) return fail('"name" must be 2 to 30 small letters, digits or dashes, starting with a letter.');
  const title = text(m.title, 60) || name;
  const version = typeof m.version === "string" ? m.version.trim() : "";
  if (!VERSION.test(version)) return fail('"version" must look like 1.0.0.');
  const description = text(m.description, 500);
  if (!description) return fail('Add a "description": what the add-on does, in a sentence.');
  const license = typeof m.license === "string" && SPDX.test(m.license.trim()) ? m.license.trim() : null;

  const manifest: AddonManifest = {
    titan: 1,
    type,
    name,
    title,
    version,
    description,
    license,
    agent: null,
    skills: [],
    tool: null,
    app: null,
    mcp: null,
    workflow: null,
  };

  // Fields a type can't have are refused, so nothing is asked for silently.
  const allowed: Record<AddonType, string[]> = {
    agent: ["agent", "skills"],
    skill: ["skills"],
    tool: ["tool"],
    "app-template": ["app"],
    "sidebar-app": ["app"],
    "mcp-server": ["mcp"],
    workflow: ["workflow"],
  };
  for (const field of ["agent", "skills", "tool", "app", "mcp", "workflow"])
    if (m[field] !== undefined && !allowed[type].includes(field))
      return fail(`An add-on of type "${type}" can't have "${field}".`);

  if (m.skills !== undefined) {
    if (!Array.isArray(m.skills) || m.skills.length > MAX_SKILLS) return fail(`"skills" lists up to ${MAX_SKILLS} files.`);
    for (const s of m.skills) {
      const path = safeAddonPath(s);
      if (!path || !path.endsWith(".md")) return fail("Each skill is a .md file inside the add-on.");
      manifest.skills.push(path);
    }
  }

  if (type === "agent") {
    const path = safeAddonPath(m.agent);
    if (!path || !path.endsWith(".md")) return fail('An agent add-on names its agent file: "agent": "agent.md".');
    manifest.agent = path;
  }
  if (type === "skill" && manifest.skills.length === 0) return fail('A skill add-on lists its files in "skills".');

  if (type === "tool") {
    const t = (m.tool ?? null) as Record<string, unknown> | null;
    if (!t || typeof t !== "object") return fail('A tool add-on has a "tool" object.');
    const main = safeAddonPath(t.main);
    if (!main || !/\.(m?js)$/.test(main)) return fail('"tool.main" is the add-on\'s JavaScript file, like "tool.js".');
    const hostsRaw = t.hosts ?? [];
    if (!Array.isArray(hostsRaw) || hostsRaw.length > MAX_HOSTS)
      return fail(`"tool.hosts" lists up to ${MAX_HOSTS} host names.`);
    const hosts: string[] = [];
    for (const h of hostsRaw) {
      const host = addonHost(h);
      if (!host) return fail(`"${String(h).slice(0, 60)}" isn't a public host name (like api.example.com).`);
      if (!hosts.includes(host)) hosts.push(host);
    }
    if (!Array.isArray(t.tools) || t.tools.length === 0 || t.tools.length > MAX_TOOLS)
      return fail(`"tool.tools" lists 1 to ${MAX_TOOLS} tools.`);
    const tools: AddonToolSpec[] = [];
    for (const [i, raw] of t.tools.entries()) {
      const tool = parseTool(raw, i);
      if (typeof tool === "string") return fail(tool);
      if (tools.some((x) => x.name === tool.name)) return fail(`Two tools are called ${tool.name}.`);
      tools.push(tool);
    }
    manifest.tool = { main, hosts, tools };
  }

  if (type === "app-template" || type === "sidebar-app") {
    const a = (m.app ?? { dir: "." }) as Record<string, unknown>;
    const dir = safeAddonPath(a?.dir ?? ".");
    if (!dir) return fail('"app.dir" is a folder inside the add-on.');
    manifest.app = { dir };
  }

  if (type === "mcp-server") {
    const m2 = (m.mcp ?? null) as Record<string, unknown> | null;
    if (!m2 || typeof m2 !== "object") return fail('An MCP server add-on has an "mcp" object.');
    const secretsRaw = m2.secrets ?? [];
    if (!Array.isArray(secretsRaw) || secretsRaw.length > 10) return fail('"mcp.secrets" lists up to 10 names.');
    const secrets: string[] = [];
    for (const x of secretsRaw) {
      if (typeof x !== "string" || !SECRET_NAME.test(x)) return fail('Each secret is a name like GITHUB_TOKEN.');
      secrets.push(x);
    }
    const argsRaw = m2.args ?? [];
    if (!Array.isArray(argsRaw) || argsRaw.length > 10) return fail('"mcp.args" lists up to 10 arguments.');
    const args: string[] = [];
    for (const a of argsRaw) {
      if (typeof a !== "string" || !ARG.test(a)) return fail("An argument may have letters, digits and - _ . / : = @ only.");
      args.push(a);
    }
    if (typeof m2.url === "string" && m2.npm === undefined) {
      let url: URL;
      try {
        url = new URL(m2.url);
      } catch {
        return fail('"mcp.url" isn\'t an address.');
      }
      if (url.protocol !== "https:" || !addonHost(url.hostname) || url.username || url.password)
        return fail('"mcp.url" must be a public https:// address.');
      manifest.mcp = { url: url.toString(), npm: null, args: [], secrets };
    } else if (typeof m2.npm === "string" && m2.url === undefined) {
      if (!NPM_PINNED.test(m2.npm)) return fail('"mcp.npm" is a package at an exact version, like @acme/mcp-server@1.2.3.');
      manifest.mcp = { url: null, npm: m2.npm, args, secrets };
    } else return fail('"mcp" has either "url" or "npm".');
  }

  if (type === "workflow") {
    const w = (m.workflow ?? null) as Record<string, unknown> | null;
    if (!w || typeof w !== "object") return fail('A workflow add-on has a "workflow" object.');
    const agent = text(w.agent, 40) || "Titan";
    const prompt = typeof w.prompt === "string" ? w.prompt.trim() : "";
    if (!prompt || prompt.length > 4000) return fail('"workflow.prompt" is the task, up to 4,000 characters.');
    const when = (w.when ?? null) as Record<string, unknown> | null;
    if (!when || typeof when !== "object") return fail('"workflow.when" says when it runs.');
    const time = typeof when.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(when.time) ? when.time : null;
    if (when.kind === "interval" && Number.isInteger(when.minutes) && (when.minutes as number) >= 15 && (when.minutes as number) <= 10080)
      manifest.workflow = { when: { kind: "interval", minutes: when.minutes as number }, agent, prompt };
    else if (when.kind === "daily" && time) {
      const days = Array.isArray(when.days) ? when.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : undefined;
      manifest.workflow = { when: days && days.length ? { kind: "daily", time, days } : { kind: "daily", time }, agent, prompt };
    } else if (when.kind === "monthly" && time && Number.isInteger(when.day) && (when.day as number) >= 1 && (when.day as number) <= 31)
      manifest.workflow = { when: { kind: "monthly", day: when.day as number, time }, agent, prompt };
    else return fail('"workflow.when" is every N minutes (15 at least), daily at a time, or monthly on a day at a time.');
  }

  return { ok: true, manifest };
}

/** What the add-on may do, in plain words, for the card before installing (decisions §66.5). */
export function describeAddon(manifest: AddonManifest): string[] {
  const lines: string[] = [];
  if (manifest.type === "agent")
    lines.push("Adds an agent. It can use only the tool groups its file names, and every call asks as usual.");
  if (manifest.skills.length) lines.push(`Adds ${manifest.skills.length} skill${manifest.skills.length > 1 ? "s" : ""} (text only).`);
  if (manifest.tool) {
    lines.push(
      manifest.tool.hosts.length
        ? `Its tools may reach only: ${manifest.tool.hosts.join(", ")} (through the task's network policy).`
        : "Its tools can't reach the internet.",
    );
    lines.push("It can't read or write files, run commands or start programs.");
    for (const t of manifest.tool.tools)
      lines.push(
        `${t.name}: ${t.risk === "read" ? "runs without asking" : t.risk === "write" ? "asks first" : "asks every time, on the laptop"}`,
      );
  }
  if (manifest.type === "app-template")
    lines.push("Copies an app's files into a folder you choose. Nothing runs until the app builder checks it.");
  if (manifest.mcp)
    lines.push(
      manifest.mcp.url
        ? `Adds a connector to ${new URL(manifest.mcp.url).hostname}. Its tools join Titan's: reading runs at once; sending, posting and deleting always ask.`
        : `Adds a connector that runs the npm package ${manifest.mcp.npm} as a program on this laptop, with your user's rights and not in the add-on sandbox. Install it only if you trust its author. Its tools then ask as connectors do.`,
      ...(manifest.mcp.secrets.length ? [`It needs: ${manifest.mcp.secrets.join(", ")} (you enter them on Connectors; they stay in the keychain).`] : []),
    );
  if (manifest.workflow) {
    const w = manifest.workflow.when;
    const when =
      w.kind === "interval" ? `every ${w.minutes} minutes` : w.kind === "daily" ? `every day at ${w.time}${w.days ? " on chosen days" : ""}` : `monthly on day ${w.day} at ${w.time}`;
    lines.push(`Adds a schedule: ${when}, ${manifest.workflow.agent} does this, with the usual approvals: “${manifest.workflow.prompt.slice(0, 300)}”`);
  }
  if (manifest.type === "sidebar-app")
    lines.push("Copies a sidebar app's files into a folder you choose. Adding it to the sidebar asks again, with what data it reads.");
  return lines;
}
