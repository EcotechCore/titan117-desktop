// One task: your messages, Titan's steps, approval cards and the answer
// (design.md §6).
import { useEffect, useRef } from 'react'

import type { Approval, ApprovalAnswer, TaskDetail, ToolCall } from '../../shared/protocol'
import { diffCounts } from './code-lib'
import { Diff } from './Diff'
import { Linked } from './Linked'
import { pullRequestUrl } from './links-lib'
import { modelName } from './format'
import { Eyes, Icon } from './ui'
import type { EngineState } from '../../shared/protocol'

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
        {approval.risk === 'external' ? 'This always needs your OK:' : 'Allow Titan to do this?'}
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

export function TaskView({
  detail,
  streaming,
  engine,
  onAnswer,
  onReadAloud
}: {
  detail: TaskDetail
  streaming: string
  engine: EngineState | null
  onAnswer(id: string, answer: ApprovalAnswer): void
  onReadAloud?(text: string): void
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

  return (
    <div className="thread">
      {messages.map(({ id, message }) => {
        if (message.role === 'user')
          return (
            <div key={id} className="bubble">
              {message.text}
            </div>
          )
        if (message.role !== 'assistant') return null
        return (
          <div key={id} className="reply">
            <div className="reply-head">
              <span className="agent-tile">
                <Eyes state="working" />
              </span>
              <strong>Titan</strong>
              <span className="faint">{modelName(task.model, engine)}</span>
            </div>
            {message.toolCalls && (
              <ul className="steps">
                {message.toolCalls.map((call) => {
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
            {message.toolCalls?.map((call) => {
              const approval = pending.get(call.id)
              return approval ? (
                <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
              ) : null
            })}
            {message.text && (
              <div className="reply-text">
                <Linked text={message.text} />
              </div>
            )}
            {message.text && onReadAloud && (
              <button className="read-aloud" onClick={() => onReadAloud(message.text)}>
                <Icon name="speaker" /> Read aloud
              </button>
            )}
          </div>
        )
      })}

      {/* Asks that aren't one of Titan's own steps: the coding engine's commands and changes. */}
      {approvals
        .filter((a) => a.status === 'pending' && !toolCallIds.has(a.callId))
        .map((approval) => (
          <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
        ))}

      {active && (
        <div className="reply">
          {streaming ? (
            <div className="reply-text">
              <Linked text={streaming} />
            </div>
          ) : (
            task.status === 'running' && <p className="working">Working</p>
          )}
        </div>
      )}

      {task.note && (
        <p className={task.status === 'error' ? 'note note-error' : 'note'} role="status">
          {task.note}
        </p>
      )}
      <div ref={end} />
    </div>
  )
}
