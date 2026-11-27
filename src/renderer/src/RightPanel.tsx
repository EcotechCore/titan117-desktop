// The right panel (layout v2, decisions §67): its own sheet beside the chat,
// opened and closed like a drawer, with a tab for each artifact and file the
// task made and a Task tab with the folder, agent, model, context, cost and
// the sites it reached.
import { useEffect, useState } from 'react'

import type { Artifact, CloudModel, EngineState, Task, TaskDetail } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { clock, folderName, modelName, usd } from './format'
import {
  contextUse,
  filesMade,
  folderOf,
  fullPath,
  sitesReached,
  smallUsd,
  tokensLabel
} from './layout-lib'
import type { RightTab } from './state'
import { Icon } from './ui'

const STATUS: Record<Task['status'], string> = {
  running: 'Running',
  waiting: 'Needs you',
  done: 'Done',
  stopped: 'Stopped',
  error: 'Error'
}

export function RightPanel({
  client,
  engine,
  cloud,
  detail,
  parts,
  artifactId,
  artifactsChanged,
  tab,
  artifactPanel,
  onTab,
  onArtifact,
  onClose,
  onOpenTask,
  onReport
}: {
  client: EngineClient | null
  engine: EngineState
  cloud: CloudModel[]
  /** The open task, if any. */
  detail: TaskDetail | null
  /** Parts of the task handed to other agents (4.6). */
  parts: Task[]
  /** The artifact open beside the chat (17.1), if any. */
  artifactId: string | null
  artifactsChanged: number
  tab: RightTab
  /** The artifact panel (Artifacts.tsx), drawn by the window. */
  artifactPanel: React.ReactNode
  onTab(tab: RightTab): void
  onArtifact(id: string): void
  onClose(): void
  onOpenTask(id: string): void
  onReport(errorRef: string): void
}): React.JSX.Element {
  const taskId = detail?.task.id ?? null
  const [all, setAll] = useState<Artifact[]>([])
  useEffect(() => {
    if (!client) return
    let live = true
    client
      .get<{ artifacts: Artifact[] }>('/v1/artifacts')
      .then((r) => live && setAll(r.artifacts))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, taskId, artifactId, artifactsChanged])

  const made = taskId ? all.filter((a) => a.taskId === taskId) : []
  const open = artifactId ? all.find((a) => a.id === artifactId) : undefined
  const artifacts = open && !made.some((a) => a.id === open.id) ? [open, ...made] : made
  const files = detail ? filesMade(detail.messages) : []
  const file = tab.startsWith('file:') ? files.find((f) => `file:${f.path}` === tab) : undefined
  const shown: RightTab =
    tab === 'artifact' && artifactId ? 'artifact' : file ? tab : detail ? 'task' : 'artifact'

  return (
    <section className="right" aria-label="What the task made">
      <div className="right-tabs" role="tablist">
        {artifacts.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={shown === 'artifact' && artifactId === a.id}
            className="right-tab"
            title={a.title}
            onClick={() => onArtifact(a.id)}
          >
            <Icon name="file" />
            <span className="right-tab-text">{a.title}</span>
          </button>
        ))}
        {artifactId && !open && (
          <button role="tab" aria-selected={shown === 'artifact'} className="right-tab">
            <Icon name="file" />
            <span className="right-tab-text">Artifact</span>
          </button>
        )}
        {files.map((f) => (
          <button
            key={f.path}
            role="tab"
            aria-selected={shown === `file:${f.path}`}
            className="right-tab"
            title={f.path}
            onClick={() => onTab(`file:${f.path}`)}
          >
            <Icon name="folder" />
            <span className="right-tab-text">{f.name}</span>
          </button>
        ))}
        {detail && (
          <button
            role="tab"
            aria-selected={shown === 'task'}
            className="right-tab right-tab-task"
            onClick={() => onTab('task')}
          >
            <Icon name="list" />
            <span className="right-tab-text">Task</span>
          </button>
        )}
        <button className="icon-btn right-close" aria-label="Close the panel" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>

      <div className="right-pane" role="tabpanel">
        {shown === 'artifact' && artifactPanel}
        {file && (
          <div className="file-pane">
            <div className="file-path">
              <span className="muted">
                {folderName(fullPath(file.path, engine.folders).replace(/[\\/][^\\/]*$/, ''))} ›
              </span>
              <b className="mono">{file.name}</b>
              <span className="grow" />
              <button
                className="btn"
                onClick={() =>
                  void window.titan117.files
                    .reveal(fullPath(file.path, engine.folders))
                    .catch(() => undefined)
                }
              >
                Show in folder
              </button>
            </div>
            {file.content !== null ? (
              <pre className="file-body">
                {file.content.length > 20000 ? `${file.content.slice(0, 20000)}\n…` : file.content}
              </pre>
            ) : (
              <p className="hint file-hint">
                Saved from an artifact. Open it from its folder to see it.
              </p>
            )}
          </div>
        )}
        {shown === 'task' && detail && (
          <TaskInfo
            detail={detail}
            engine={engine}
            cloud={cloud}
            parts={parts}
            artifacts={made}
            onArtifact={onArtifact}
            onFile={(path) => onTab(`file:${path}`)}
            onOpenTask={onOpenTask}
            onReport={onReport}
          />
        )}
      </div>
    </section>
  )
}

function TaskInfo({
  detail,
  engine,
  cloud,
  parts,
  artifacts,
  onArtifact,
  onFile,
  onOpenTask,
  onReport
}: {
  detail: TaskDetail
  engine: EngineState
  cloud: CloudModel[]
  parts: Task[]
  artifacts: Artifact[]
  onArtifact(id: string): void
  onFile(path: string): void
  onOpenTask(id: string): void
  onReport(errorRef: string): void
}): React.JSX.Element {
  const { task } = detail
  const folder = folderOf(task, engine.folders)
  const context = contextUse(detail.messages, task.model, cloud)
  const share = context.limit
    ? Math.min(100, Math.round((context.tokens / context.limit) * 100))
    : null
  const files = filesMade(detail.messages)
  const sites = sitesReached(detail.messages)
  const errorRef = task.status === 'error' ? /ref ([0-9a-f]{8})/.exec(task.note ?? '')?.[1] : null

  return (
    <div className="task-info">
      <span className={`status status-${task.status}`}>{STATUS[task.status]}</span>

      <p className="info-label">This task</p>
      <div className="kv" title={folder ?? undefined}>
        <Icon name="folder" />
        <span className="grow">{folder ? folderName(folder) : 'No folder yet'}</span>
        {folder && <span className="faint">allowed folder</span>}
      </div>
      <div className="kv">
        <Icon name="users" />
        <span className="grow">
          {task.agent} · {modelName(task.model, engine)}
        </span>
      </div>
      <div className="kv">
        <span className="kv-key">Context</span>
        {share !== null ? (
          <>
            <span
              className="ctx-meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={share}
              aria-label="Context used"
            >
              <i style={{ width: `${share}%` }} />
            </span>
            <span className="mono">{share}%</span>
          </>
        ) : (
          <span className="grow mono">about {tokensLabel(context.tokens)} tokens</span>
        )}
      </div>
      <div className="kv">
        <span className="kv-key grow">Cost so far</span>
        <b className="mono">{smallUsd(task.costUsd)}</b>
      </div>
      <div className="kv">
        <span className="kv-key grow">Steps</span>
        <span className="mono">{task.steps}</span>
      </div>
      {task.syncedFrom && (
        <div className="kv">
          <span className="kv-key grow">From</span>
          <span>{task.syncedFrom}</span>
        </div>
      )}
      {errorRef && (
        <button className="btn" onClick={() => onReport(errorRef)}>
          Send a report about this
        </button>
      )}

      <p className="info-label">Made</p>
      {files.length === 0 && artifacts.length === 0 && <p className="hint">Nothing yet.</p>}
      {artifacts.map((a) => (
        <button key={a.id} className="kv kv-btn" onClick={() => onArtifact(a.id)}>
          <Icon name="file" />
          <span className="grow">{a.title}</span>
        </button>
      ))}
      {files.map((f) => (
        <button key={f.path} className="kv kv-btn" title={f.path} onClick={() => onFile(f.path)}>
          <Icon name="folder" />
          <span className="grow mono">{f.name}</span>
        </button>
      ))}

      <p className="info-label">Sites it reached</p>
      {sites.hosts.length === 0 && !sites.searched && <p className="hint">None (local only).</p>}
      {sites.searched && (
        <div className="kv">
          <Icon name="globe" />
          <span className="grow">Web search</span>
        </div>
      )}
      {sites.hosts.map((h) => (
        <div key={h} className="kv">
          <Icon name="globe" />
          <span className="grow mono">{h}</span>
        </div>
      ))}

      {parts.length > 0 && (
        <>
          <p className="info-label">Parts handed out</p>
          <ul className="parts">
            {parts.map((p) => (
              <li key={p.id}>
                <button className="link" onClick={() => onOpenTask(p.id)}>
                  <span className={`dot dot-${p.status}`} aria-label={p.status} /> {p.agent}
                </button>
                <span className="mono muted"> {usd(p.costUsd)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {task.parentId && (
        <button className="link" onClick={() => onOpenTask(task.parentId!)}>
          ← The task this is a part of
        </button>
      )}
      {(detail.talk?.length ?? 0) > 0 && (
        <>
          <p className="info-label">Team talk</p>
          <ol className="talk">
            {detail.talk!.map((m) => (
              <li key={m.id} className={`talk-${m.kind}`}>
                <span className="talk-who">
                  {m.from} → {m.to}
                </span>
                <span className="talk-text">{m.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="info-label">Activity</p>
      <ol className="log">
        {detail.activity.map((a) => (
          <li key={a.id} className={`log-${a.kind}`}>
            <span className="log-time">{clock(a.at)}</span>
            <span>
              {a.summary}
              {a.costUsd > 0 && ` · ${usd(a.costUsd)}`}
              {a.approvedBy && ` · approved by ${a.approvedBy}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
