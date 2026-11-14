// One task: your messages, Titan's steps, approval cards and the answer
// (design.md §6).
import { useEffect, useRef } from 'react'

import type { Approval, ApprovalAnswer, TaskDetail, ToolCall } from '../../shared/protocol'
import { modelName } from './format'
import { Eyes, Icon } from './ui'
import type { EngineState } from '../../shared/protocol'

const TOOL_LABEL: Record<string, string> = {
  list_folder: 'List folder',
  read_file: 'Read file',
  write_file: 'Write file'
}

function stepLabel(call: ToolCall): string {
  const what = TOOL_LABEL[call.name] ?? call.name
  const path = typeof call.input.path === 'string' ? call.input.path : ''
  return path ? `${what} · ${path}` : what
}

export function ApprovalCard({
  approval,
  onAnswer
}: {
  approval: Approval
  onAnswer(id: string, answer: ApprovalAnswer): void
}): React.JSX.Element {
  const content = typeof approval.input.content === 'string' ? approval.input.content : null
  return (
    <div className="approval" role="group" aria-label="Approval needed">
      <p className="approval-q">Allow Titan to do this?</p>
      <p className="approval-what">{approval.summary}</p>
      {content !== null && (
        <details className="approval-review">
          <summary>Review what will be written</summary>
          <pre>{content.length > 4000 ? `${content.slice(0, 4000)}\n…` : content}</pre>
        </details>
      )}
      <div className="approval-actions">
        <button className="btn btn-primary" onClick={() => onAnswer(approval.id, 'approve')}>
          Approve
        </button>
        {approval.canAlways && (
          <button className="btn" onClick={() => onAnswer(approval.id, 'always')}>
            Always in this task
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

function Step({ call, state }: { call: ToolCall; state: StepState }): React.JSX.Element {
  return (
    <li className={`step step-${state}`}>
      <span className="step-mark" aria-hidden="true">
        {state === 'done' && <Icon name="check" />}
        {state === 'refused' && <Icon name="x" />}
      </span>
      <span className="step-text">{stepLabel(call)}</span>
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
  onAnswer
}: {
  detail: TaskDetail
  streaming: string
  engine: EngineState | null
  onAnswer(id: string, answer: ApprovalAnswer): void
}): React.JSX.Element {
  const { task, messages, approvals } = detail
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streaming, approvals.length, task.status])

  const results = new Map<string, { isError: boolean }>()
  for (const { message } of messages)
    if (message.role === 'tool') results.set(message.callId, { isError: !!message.isError })
  const pending = new Map(approvals.filter((a) => a.status === 'pending').map((a) => [a.callId, a]))
  const active = task.status === 'running' || task.status === 'waiting'

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
                  return <Step key={call.id} call={call} state={state} />
                })}
              </ul>
            )}
            {message.toolCalls?.map((call) => {
              const approval = pending.get(call.id)
              return approval ? (
                <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
              ) : null
            })}
            {message.text && <div className="reply-text">{message.text}</div>}
          </div>
        )
      })}

      {active && (
        <div className="reply">
          {streaming ? (
            <div className="reply-text">{streaming}</div>
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
