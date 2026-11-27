// Layout v2 (decisions §67): what the sidebar, the chat's folded steps and the
// right panel show, worked out from the engine's state. Pure, so it's tested.
import type { Activity, CloudModel, StoredMessage, Task, ToolCall } from '../../shared/protocol'
import { CLOUD_MODEL_PREFIX } from '../../shared/protocol'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long ago, short: "now", "5m", "3h", "2d", "4w". */
export function age(at: number, now = Date.now()): string {
  const ms = Math.max(0, now - at)
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`
  return `${Math.floor(ms / (7 * DAY))}w`
}

function sameFolder(a: string, b: string): boolean {
  const norm = (p: string): string =>
    p
      .replace(/[\\/]+$/, '')
      .replace(/\\/g, '/')
      .toLowerCase()
  return norm(a) === norm(b)
}

/** Top-level tasks under the allowed folder they worked in; the rest are loose. */
export function groupTasks(
  tasks: Task[],
  folders: string[]
): { folders: { folder: string; tasks: Task[] }[]; loose: Task[] } {
  const top = tasks.filter((t) => !t.parentId)
  const grouped = folders.map((folder) => ({
    folder,
    tasks: top.filter((t) => t.folder && sameFolder(t.folder, folder))
  }))
  const placed = new Set(grouped.flatMap((g) => g.tasks.map((t) => t.id)))
  return { folders: grouped, loose: top.filter((t) => !placed.has(t.id)) }
}

/** The allowed folder a task sits under, if any. */
export function folderOf(task: Task, folders: string[]): string | null {
  return (task.folder && folders.find((f) => sameFolder(f, task.folder!))) ?? null
}

export interface Turn {
  /** What the user asked; null for a task that started without a message here. */
  ask: StoredMessage | null
  /** The agent's messages and tool results until the next ask. */
  replies: StoredMessage[]
}

/** The conversation as turns: each ask with everything the agent did for it. */
export function turns(messages: StoredMessage[]): Turn[] {
  const out: Turn[] = []
  for (const m of messages) {
    if (m.message.role === 'user') out.push({ ask: m, replies: [] })
    else if (out.length === 0) out.push({ ask: null, replies: [m] })
    else out[out.length - 1].replies.push(m)
  }
  return out
}

export function callsOf(turn: Turn): ToolCall[] {
  return turn.replies.flatMap((m) =>
    m.message.role === 'assistant' ? (m.message.toolCalls ?? []) : []
  )
}

/** "worked for 48s · 6 steps · $0.004": the time, steps and cost of one turn. */
export function turnSummary(
  turn: Turn,
  activity: Activity[],
  end: number | null
): { seconds: number; steps: number; costUsd: number } {
  const start = turn.ask?.createdAt ?? turn.replies[0]?.createdAt ?? 0
  const last = turn.replies[turn.replies.length - 1]?.createdAt ?? start
  const until = end ?? last
  const costUsd = activity
    .filter((a) => a.at >= start && a.at <= until + 1000)
    .reduce((n, a) => n + a.costUsd, 0)
  return {
    seconds: Math.max(0, Math.round((until - start) / 1000)),
    steps: callsOf(turn).length,
    costUsd
  }
}

/** "48s", "3m 05s", "1h 02m". */
export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
}

/** A cost with enough digits to mean something for small amounts: "$0.004". */
export function smallUsd(n: number): string {
  if (n <= 0) return 'free'
  if (n < 0.001) return '<$0.001'
  return n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

function results(messages: StoredMessage[]): Map<string, boolean> {
  const ok = new Map<string, boolean>()
  for (const { message } of messages)
    if (message.role === 'tool') ok.set(message.callId, !message.isError)
  return ok
}

export interface MadeFile {
  /** The path as the agent gave it (relative to the first allowed folder, or absolute). */
  path: string
  name: string
  /** What was written, when the call carried it (write_file). */
  content: string | null
}

const MAKES_FILES = new Set(['write_file', 'artifact_save'])

/** Files the task wrote, each once, newest content last. */
export function filesMade(messages: StoredMessage[]): MadeFile[] {
  const ok = results(messages)
  const byPath = new Map<string, MadeFile>()
  for (const { message } of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      const path = call.input.path
      if (!MAKES_FILES.has(call.name) || typeof path !== 'string' || !ok.get(call.id)) continue
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
      const content = typeof call.input.content === 'string' ? call.input.content : null
      byPath.delete(path)
      byPath.set(path, { path, name, content })
    }
  }
  return [...byPath.values()]
}

/** Where a made file is, for Show in folder: relative paths sit in the first allowed folder. */
export function fullPath(path: string, folders: string[]): string {
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path) || !folders[0]) return path
  const base = folders[0].replace(/[\\/]+$/, '')
  const sep = base.includes('\\') ? '\\' : '/'
  return `${base}${sep}${path.replace(/^\.[\\/]/, '').replace(/[\\/]/g, sep)}`
}

const READS_SITES = new Set(['web_fetch', 'read_site', 'browser_open'])

/** The sites the task reached (host names), and whether it searched the web. */
export function sitesReached(messages: StoredMessage[]): { hosts: string[]; searched: boolean } {
  const ok = results(messages)
  const hosts = new Set<string>()
  let searched = false
  for (const { message } of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      if (!ok.get(call.id)) continue
      if (call.name === 'web_search') searched = true
      const url = call.input.url
      if (!READS_SITES.has(call.name) || typeof url !== 'string') continue
      try {
        hosts.add(new URL(url).hostname)
      } catch {
        // Not a URL the tool could have opened either.
      }
    }
  }
  return { hosts: [...hosts], searched }
}

/** Roughly how much of the model's context the conversation fills (four characters a token). */
export function contextUse(
  messages: StoredMessage[],
  model: string,
  cloud: CloudModel[]
): { tokens: number; limit: number | null } {
  let chars = 0
  for (const { message } of messages) {
    if (message.role === 'user') chars += message.text.length
    else if (message.role === 'tool') chars += message.output.length
    else chars += message.text.length + JSON.stringify(message.toolCalls ?? []).length
  }
  const id = model.startsWith(CLOUD_MODEL_PREFIX) ? model.slice(CLOUD_MODEL_PREFIX.length) : null
  const limit = (id && cloud.find((m) => m.id === id)?.contextLength) || null
  return { tokens: Math.ceil(chars / 4), limit }
}

/** "12k", "850". */
export function tokensLabel(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}
