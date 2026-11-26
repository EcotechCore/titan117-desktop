/**
 * Runs remote commands on this laptop (decisions §64.7), whoever sent them:
 * a paired browser or phone (remote.ts) or a linked chat (telegram.ts). One
 * list of commands for all of them (guardrails §9: the web and phone can do
 * everything a chat can), and every one goes through the engine's own local
 * API, so a remote task gets exactly the approvals a local one gets. Answers
 * are always marked remote: the permission layer refuses them for laptop-only
 * approvals.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { extname, join, basename, resolve, sep } from 'node:path'

import {
  safeFileName,
  type RemoteApproval,
  type RemoteCommand,
  type RemoteStep,
  type RemoteTask
} from '../../shared/remote-protocol'

export type EngineCall = <T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown
) => Promise<T>

interface EngineTask {
  id: string
  title: string
  agent: string
  status: string
  note: string | null
  updatedAt: number
}

interface EngineTaskDetail {
  task: EngineTask
  messages: { message: { role: string; text?: string } }[]
  activity: { at: number; kind: string; summary: string }[]
}

export interface RemoteState {
  tasks: RemoteTask[]
  approvals: RemoteApproval[]
}

export type CommandResult =
  { ok: true; taskId?: string; text?: string } | { ok: false; error: string }

/** Telegram allows 20 MB downloads (core.telegram.org/bots/faq); our own sealed files are smaller. */
export const CHANNEL_MAX_FILE_BYTES = 20 * 1024 * 1024

export class RemoteCommands {
  /** Which tasks were started remotely, and from where (shown on every device). */
  private readonly startedFrom = new Map<string, string>()

  constructor(
    private readonly deps: {
      engine: EngineCall
      /** The folder files sent from a phone or chat are saved in; one of the allowed folders. */
      inboxFolder(): string | null
      /** A quiet notification on the laptop (decisions §64.8). */
      notify(title: string, body: string): void
      /** Tell the other paired devices and channels a task started remotely. */
      alertOthers(text: string, except: string): void
    }
  ) {}

  sourceOf(taskId: string): string | null {
    return this.startedFrom.get(taskId) ?? null
  }

  /**
   * `secondFactor`: the sender's proof of a fresh second factor was checked
   * (remote.ts); the engine still accepts it only for a category switched on.
   */
  async run(
    command: RemoteCommand,
    source: string,
    checked: { secondFactor?: boolean } = {}
  ): Promise<CommandResult> {
    try {
      switch (command.type) {
        case 'task.start': {
          // The laptop's default model (Models screen), as for a task typed on the laptop.
          const { defaultModel } = await this.deps.engine<{ defaultModel: string | null }>(
            'GET',
            '/v1/state'
          )
          if (!defaultModel)
            return { ok: false, error: 'Choose a default model on the laptop first.' }
          const body: Record<string, unknown> = { text: command.text, model: defaultModel }
          if (command.agent) body['agent'] = command.agent
          const { task } = await this.deps.engine<{ task: EngineTask }>('POST', '/v1/tasks', body)
          this.startedFrom.set(task.id, source)
          const text = `Task started from ${source}: ${task.title}`
          this.deps.notify('Remote task started', text)
          this.deps.alertOthers(text, source)
          return { ok: true, taskId: task.id }
        }
        case 'task.list':
        case 'task.get':
          return { ok: true }
        case 'approval.answer':
          await this.deps.engine(
            'POST',
            `/v1/remote-approvals/${encodeURIComponent(command.approvalId)}`,
            {
              answer: command.answer,
              ...(checked.secondFactor ? { secondFactor: true } : {})
            }
          )
          return { ok: true }
        case 'task.cancel':
          await this.deps.engine('POST', `/v1/tasks/${encodeURIComponent(command.taskId)}/cancel`)
          return { ok: true }
        case 'file.add': {
          const bytes = Buffer.from(command.data, 'base64')
          const saved = await this.saveFile(command.name, bytes)
          return { ok: true, text: `Saved as ${saved}` }
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'That didn’t work.' }
    }
  }

  /**
   * A file the user sent from their phone or chat, saved as their own file in
   * the inbox folder, never over another file and never outside the folder.
   */
  async saveFile(name: string, bytes: Uint8Array): Promise<string> {
    const folder = this.deps.inboxFolder()
    if (!folder) throw new Error('Choose an inbox folder for remote files on the laptop first.')
    const { folders } = await this.deps.engine<{ folders: string[] }>('GET', '/v1/state')
    const root = resolve(folder)
    if (!folders.some((f) => root === resolve(f) || root.startsWith(resolve(f) + sep)))
      throw new Error('The inbox folder is no longer one of the allowed folders.')
    if (bytes.length > CHANNEL_MAX_FILE_BYTES) throw new Error('That file is too large.')
    const clean = safeFileName(name) ?? 'file'
    const ext = extname(clean)
    const stem = basename(clean, ext)
    let target = join(root, clean)
    for (let i = 2; existsSync(target); i++) target = join(root, `${stem} (${i})${ext}`)
    if (!resolve(target).startsWith(root + sep)) throw new Error('Not a file name.')
    writeFileSync(target, bytes, { flag: 'wx' })
    return basename(target)
  }

  /** Whether a task is a schedule's run (Automations, decisions §61), and the schedule's name. */
  async scheduleOf(taskId: string): Promise<string | null> {
    const { schedules } = await this.deps.engine<{
      schedules: { name: string; lastTaskId: string | null }[]
    }>('GET', '/v1/automations')
    return schedules.find((s) => s.lastTaskId === taskId)?.name ?? null
  }

  /** Ready posts whose time has come, with the pictures that fit (decisions §64.13). */
  async shareable(): Promise<
    {
      id: string
      platform: string
      text: string
      files: { name: string; type: string; data: string }[]
      left: string[]
    }[]
  > {
    const { posts } = await this.deps.engine<{
      posts: {
        id: string
        platform: string
        text: string
        files: { name: string; type: string; data: string }[]
        left: string[]
      }[]
    }>('GET', '/v1/remote-share')
    return posts
  }

  async state(): Promise<RemoteState> {
    const s = await this.deps.engine<{
      tasks: EngineTask[]
      approvals: RemoteApproval[]
    }>('GET', '/v1/remote')
    return {
      tasks: s.tasks.map((t) => this.toRemote(t)),
      approvals: s.approvals
    }
  }

  async task(taskId: string): Promise<{
    task: RemoteTask
    steps: RemoteStep[]
    result: string | null
    approvals: RemoteApproval[]
  }> {
    const detail = await this.deps.engine<EngineTaskDetail>(
      'GET',
      `/v1/tasks/${encodeURIComponent(taskId)}`
    )
    const { approvals } = await this.state()
    return {
      task: this.toRemote(detail.task, lastAnswer(detail)),
      steps: detail.activity
        .slice(-30)
        .map((a) => ({ at: a.at, kind: a.kind, text: a.summary.slice(0, 300) })),
      result: lastAnswer(detail),
      approvals: approvals.filter((a) => a.taskId === taskId)
    }
  }

  private toRemote(t: EngineTask, lastLine: string | null = null): RemoteTask {
    return {
      id: t.id,
      title: t.title.slice(0, 200),
      status: t.status,
      agent: t.agent ?? null,
      updatedAt: t.updatedAt,
      startedFrom: this.startedFrom.get(t.id) ?? null,
      lastLine:
        (lastLine ?? t.note ?? null)
          ?.split('\n')
          .find((l) => l.trim())
          ?.slice(0, 300) ?? null
    }
  }
}

/** The agent's last answer in a task, in text. */
export function lastAnswer(detail: EngineTaskDetail): string | null {
  for (let i = detail.messages.length - 1; i >= 0; i--) {
    const m = detail.messages[i]!.message
    if (m.role !== 'assistant') continue
    const text = typeof m.text === 'string' ? m.text : ''
    if (text.trim()) return text.trim().slice(0, 4000)
  }
  return null
}
