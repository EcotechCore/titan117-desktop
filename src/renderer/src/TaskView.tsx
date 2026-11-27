// One task: your messages, the agent's steps folded under one line, approval
// cards and the answer (design.md §6, layout v2, decisions §67).
import { useEffect, useRef, useState } from 'react'

import type { Approval, ApprovalAnswer, TaskDetail, ToolCall } from '../../shared/protocol'
import { diffCounts } from './code-lib'
import { Diff } from './Diff'
import { Linked } from './Linked'
import { pullRequestUrl } from './links-lib'
import { Icon } from './ui'
import type { EngineClient } from './engine'
import {
  age,
  callsOf,
  duration,
  filesMade,
  smallUsd,
  turns,
  turnSummary,
  type Turn
} from './layout-lib'

/** An image the task made (2.7), shown in the chat. */
function TaskImage({
  client,
  taskId,
  callId
}: {
  client: EngineClient
  taskId: string
  callId: string
}): React.JSX.Element | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    client
      .get<{ dataUrl: string }>(`/v1/tasks/${taskId}/image?call=${encodeURIComponent(callId)}`)
      .then((r) => setSrc(r.dataUrl))
      .catch(() => setSrc(null))
  }, [client, taskId, callId])
  return src ? <img className="task-image" src={src} alt="The image this task made" /> : null
}

const TOOL_LABEL: Record<string, string> = {
  list_folder: 'List folder',
  read_file: 'Read file',
  write_file: 'Write file',
  search_files: 'Search files',
  move_file: 'Move',
  make_folder: 'New folder',
  delete_file: 'Delete',
  run_command: 'Command',
  run_code: 'Script',
  web_fetch: 'Read page',
  browser_open: 'Browser',
  browser_view: 'Browser · read page',
  browser_click: 'Browser · click',
  browser_type: 'Browser · fill',
  browser_select: 'Browser · choose',
  browser_back: 'Browser · back',
  memory_search: 'Memory',
  memory_save: 'Remember',
  memory_forget: 'Forget',
  skill_read: 'Skill',
  skill_save: 'Save skill',
  past_tasks: 'Past tasks',
  speak: 'Read aloud',
  transcribe: 'Transcribe',
  code_task: 'Coding engine',
  git_status: 'Git status',
  git_diff: 'Git diff',
  git_branch: 'Branch',
  git_commit: 'Commit',
  git_push: 'Push',
  pull_request: 'Pull request'
}

/** The user's own coding tools (13.14), by the id code_task gets. */
const OWN_TOOL_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code (your plan)',
  codex: 'Codex (your plan)',
  cursor: 'Cursor’s agent (your plan)',
  grok: 'Grok (your plan)'
}

function stepLabel(call: ToolCall): string {
  const own = call.name === 'code_task' ? OWN_TOOL_LABEL[String(call.input.tool ?? '')] : undefined
  const what = own ?? TOOL_LABEL[call.name] ?? call.name.replace(/_/g, ' ')
  const detail = [
    'path',
    'command',
    'url',
    'query',
    'name',
    'text',
    'from',
    'request',
    'message',
    'title'
  ].map((k) => call.input[k])
  const first = detail.find((d) => typeof d === 'string' && d) as string | undefined
  return first ? `${what} · ${first.length > 90 ? `${first.slice(0, 90)}…` : first}` : what
}

export function ApprovalCard({
  approval,
  onAnswer
}: {
  approval: Approval
  onAnswer(id: string, answer: ApprovalAnswer): void
}): React.JSX.Element {
  const content = typeof approval.input.content === 'string' ? approval.input.content : null
  const code = typeof approval.input.code === 'string' ? approval.input.code : null
  const steps = typeof approval.input.steps === 'string' ? approval.input.steps : null
  const review = content ?? code ?? steps
  // A change from the coding engine: its diff, to review before saying yes (13.3).
  const diff =
    typeof approval.input.diff === 'string' && approval.input.diff ? approval.input.diff : null
  const body = typeof approval.input.body === 'string' ? approval.input.body : null
  // An app build's plan (6.7): read it before saying yes.
  const plan = typeof approval.input.plan === 'string' ? approval.input.plan : null
  const counts = diff ? diffCounts(diff) : null
  return (
    <div className="approval" role="group" aria-label="Approval needed">
      <p className="approval-q">
        {approval.risk === 'external' ? 'This always needs your OK:' : 'Allow this?'}
      </p>
      <p className="approval-what">{approval.summary}</p>
      {diff !== null && counts && (
        <details className="approval-review" open>
          <summary>
            Review the change · <span className="diff-add-n">+{counts.added}</span>{' '}
            <span className="diff-del-n">−{counts.removed}</span>
          </summary>
          <Diff text={diff} max={400} />
        </details>
      )}
      {plan !== null && (
        <details className="approval-review" open>
          <summary>Review the plan</summary>
          <pre className="cmd approval-plan">{plan}</pre>
        </details>
      )}
      {body !== null && (
        <details className="approval-review" open>
          <summary>Review the pull request</summary>
          <pre className="cmd">{body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body}</pre>
        </details>
      )}
      {review !== null && (
        <details className="approval-review" open={code !== null}>
          <summary>
            {code !== null
              ? 'Review the script'
              : steps !== null
                ? 'Review the skill'
                : 'Review what will be written'}
          </summary>
          <pre className="cmd">{review.length > 4000 ? `${review.slice(0, 4000)}\n…` : review}</pre>
        </details>
      )}
      <div className="approval-actions">
        <button className="btn btn-primary" onClick={() => onAnswer(approval.id, 'approve')}>
          Approve
        </button>
        {approval.canAlways && (
          <button className="btn" onClick={() => onAnswer(approval.id, 'always')}>
            {approval.alwaysLabel ?? 'Always in this task'}
          </button>
        )}
        <button className="btn" onClick={() => onAnswer(approval.id, 'deny')}>
          Deny
        </button>
      </div>
    </div>
  )
}

type StepState = 'done' | 'running' | 'waiting' | 'refused'

function Step({
  call,
  state,
  link
}: {
  call: ToolCall
  state: StepState
  /** Where the step's result lives, e.g. the pull request it opened. */
  link?: { url: string; label: string } | null
}): React.JSX.Element {
  return (
    <li className={`step step-${state}`}>
      <span className="step-mark" aria-hidden="true">
        {state === 'done' && <Icon name="check" />}
        {state === 'refused' && <Icon name="x" />}
      </span>
      <span className="step-text">{stepLabel(call)}</span>
      {link && (
        <a className="step-link" href={link.url} target="_blank" rel="noreferrer" title={link.url}>
          {link.label}
        </a>
      )}
      <span className="step-state">
        {state === 'done'
          ? 'Done'
          : state === 'refused'
            ? 'Not run'
            : state === 'waiting'
              ? 'Needs you'
              : 'Working'}
      </span>
    </li>
  )
}

/** One ask's answer: "Titan worked for 48s · 6 steps · $0.004 ›", the steps, then the answer. */
function Reply({
  turn,
  last,
  detail,
  agentColor,
  streaming,
  results,
  pending,
  onAnswer,
  onReadAloud,
  onOpenFile,
  client
}: {
  turn: Turn
  last: boolean
  detail: TaskDetail
  agentColor: string
  streaming: string
  results: Map<string, { isError: boolean; output: string }>
  pending: Map<string, Approval>
  onAnswer(id: string, answer: ApprovalAnswer): void
  onReadAloud?(text: string): void
  onOpenFile?(path: string): void
  client?: EngineClient | null
}): React.JSX.Element | null {
  const { task } = detail
  const active = last && (task.status === 'running' || task.status === 'waiting')
  // Folded once it's done; open while it works, so the running step shows.
  const [open, setOpen] = useState<boolean | null>(null)
  const unfolded = open ?? active
  const calls = callsOf(turn)
  const assistant = turn.replies.filter((m) => m.message.role === 'assistant')
  const final = assistant[assistant.length - 1]
  const finalMessage = final?.message.role === 'assistant' ? final.message : null
  const answer =
    finalMessage && !finalMessage.toolCalls?.length && finalMessage.text ? finalMessage.text : null
  // Words said between steps stay with the steps.
  const between = assistant.filter((m) => m !== final || !answer)
  const foldable =
    calls.length > 0 || between.some((m) => m.message.role === 'assistant' && m.message.text)
  const summary = turnSummary(turn, detail.activity, null)
  const files = filesMade(turn.replies)
  const head = active
    ? `${task.agent} is working${calls.length ? ` · step ${calls.length}` : ''}`
    : `${task.agent} ${calls.length ? 'worked for' : 'answered in'} ${duration(summary.seconds)}${
        calls.length ? ` · ${calls.length} step${calls.length === 1 ? '' : 's'}` : ''
      } · ${smallUsd(summary.costUsd)}`
  if (!turn.replies.length && !active) return null

  return (
    <div className="reply">
      <button
        className="worked"
        aria-expanded={foldable ? unfolded : undefined}
        disabled={!foldable}
        onClick={() => setOpen(!unfolded)}
      >
        <span className="agent-dot" style={{ background: agentColor }} />
        <span className={active ? 'worked-text grad-text' : 'worked-text'}>{head}</span>
        {foldable && (
          <span className={unfolded ? 'worked-chev open' : 'worked-chev'} aria-hidden="true">
            ›
          </span>
        )}
      </button>
      {unfolded && foldable && (
        <ul className="steps">
          {between.map((m) =>
            m.message.role !== 'assistant' ? null : (
              <li key={m.id} className="step-group">
                {m.message.text && <p className="step-say">{m.message.text}</p>}
                {(m.message.toolCalls ?? []).length > 0 && (
                  <ul>
                    {(m.message.toolCalls ?? []).map((call) => {
                      const result = results.get(call.id)
                      const state: StepState = result
                        ? result.isError
                          ? 'refused'
                          : 'done'
                        : pending.has(call.id)
                          ? 'waiting'
                          : active
                            ? 'running'
                            : 'refused'
                      // A pull request it opened or prepared: a link to it (GitHub's page).
                      const url =
                        result && !result.isError && call.name === 'pull_request'
                          ? (pullRequestUrl(result.output) ??
                            /https:\/\/github\.com\/\S+\/compare\/\S+/.exec(result.output)?.[0] ??
                            null)
                          : null
                      const link = url
                        ? {
                            url,
                            label: /\/pull\/\d+/.test(url) ? 'Open on GitHub' : 'Create on GitHub'
                          }
                        : null
                      return <Step key={call.id} call={call} state={state} link={link} />
                    })}
                  </ul>
                )}
              </li>
            )
          )}
        </ul>
      )}
      {client &&
        calls.map((call) =>
          call.name === 'image_create' && results.get(call.id)?.isError === false ? (
            <TaskImage key={`img-${call.id}`} client={client} taskId={task.id} callId={call.id} />
          ) : null
        )}
      {calls.map((call) => {
        const approval = pending.get(call.id)
        return approval ? (
          <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
        ) : null
      })}
      {answer && (
        <div className="reply-text">
          <Linked text={answer} />
        </div>
      )}
      {active && streaming && (
        <div className="reply-text">
          <Linked text={streaming} />
        </div>
      )}
      {files.length > 0 && (
        <div className="made-card">
          <Icon name="file" />
          <span className="made-text">
            {files.length === 1 ? '1 file made: ' : `${files.length} files made: `}
            {files.map((f, i) => (
              <span key={f.path}>
                {i > 0 && ', '}
                <span className="made-name mono" title={f.path}>
                  {f.name}
                </span>
              </span>
            ))}
          </span>
          {onOpenFile && (
            <button className="btn" onClick={() => onOpenFile(files[0].path)}>
              Open
            </button>
          )}
        </div>
      )}
      {answer && final && (
        <div className="reply-meta">
          {onReadAloud && (
            <button className="meta-btn" onClick={() => onReadAloud(answer)}>
              <Icon name="speaker" /> Read aloud
            </button>
          )}
          <span className="faint">{age(final.createdAt)}</span>
        </div>
      )}
    </div>
  )
}

export function TaskView({
  detail,
  streaming,
  agentColor,
  onAnswer,
  onReadAloud,
  onOpenFile,
  client
}: {
  detail: TaskDetail
  streaming: string
  /** The agent's own colour, for its dot (Titan's is tomato). */
  agentColor: string
  onAnswer(id: string, answer: ApprovalAnswer): void
  onReadAloud?(text: string): void
  /** Opens a file the task made in the right panel. */
  onOpenFile?(path: string): void
  /** Loads the images the task made; without it they aren't shown. */
  client?: EngineClient | null
}): React.JSX.Element {
  const { task, messages, approvals } = detail
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streaming, approvals.length, task.status])

  const results = new Map<string, { isError: boolean; output: string }>()
  for (const { message } of messages)
    if (message.role === 'tool')
      results.set(message.callId, { isError: !!message.isError, output: message.output })
  const pending = new Map(approvals.filter((a) => a.status === 'pending').map((a) => [a.callId, a]))
  const active = task.status === 'running' || task.status === 'waiting'
  const toolCallIds = new Set<string>()
  for (const { message } of messages)
    if (message.role === 'assistant')
      for (const call of message.toolCalls ?? []) toolCallIds.add(call.id)
  const all = turns(messages)

  return (
    <div className="thread">
      {all.map((turn, i) => (
        <div key={turn.ask?.id ?? turn.replies[0]?.id ?? i} className="turn">
          {turn.ask?.message.role === 'user' && (
            <div className="bubble">{turn.ask.message.text}</div>
          )}
          <Reply
            turn={turn}
            last={i === all.length - 1}
            detail={detail}
            agentColor={agentColor}
            streaming={streaming}
            results={results}
            pending={pending}
            onAnswer={onAnswer}
            onReadAloud={onReadAloud}
            onOpenFile={onOpenFile}
            client={client}
          />
        </div>
      ))}

      {/* Asks that aren't one of the agent's own steps: the coding engine's commands and changes. */}
      {approvals
        .filter((a) => a.status === 'pending' && !toolCallIds.has(a.callId))
        .map((approval) => (
          <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
        ))}

      {active && all.length === 0 && <p className="working">Working</p>}

      {task.note && (
        <p className={task.status === 'error' ? 'note note-error' : 'note'} role="status">
          {task.note}
        </p>
      )}
      <div ref={end} />
    </div>
  )
}
