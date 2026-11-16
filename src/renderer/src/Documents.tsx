/**
 * Documents (features 7.1, 7.4, 7.7, 7.8; decisions §51): which allowed
 * folders the folder agent reads, whether agents may change them, whether
 * they're for local models only, how far reading has got, and a search to try.
 */
import { useEffect, useState } from 'react'

import type { DocFolderStatus, DocHit, EngineState } from '../../shared/protocol'
import type { EngineClient } from './engine'
import { folderName } from './format'

export function DocumentsView({
  client,
  engine,
  changed,
  onProblem
}: {
  client: EngineClient | null
  engine: EngineState
  changed: number
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [folders, setFolders] = useState<DocFolderStatus[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocHit[] | null>(null)

  useEffect(() => {
    let live = true
    client
      ?.get<{ folders: DocFolderStatus[] }>('/v1/documents')
      .then((r) => live && setFolders(r.folders))
      .catch(onProblem)
    return () => {
      live = false
    }
  }, [client, changed, engine.folders, onProblem])

  async function set(path: string, change: Record<string, boolean>): Promise<void> {
    try {
      const r = await client!.send<{ folders: DocFolderStatus[] }>('PUT', '/v1/documents', {
        path,
        ...change
      })
      setFolders(r.folders)
    } catch (error) {
      onProblem(error)
    }
  }

  async function search(): Promise<void> {
    if (!query.trim()) return
    try {
      const r = await client!.send<{ hits: DocHit[] }>('POST', '/v1/documents/search', { query })
      setHits(r.hits)
    } catch (error) {
      onProblem(error)
    }
  }

  return (
    <div className="list-view">
      <h1 className="view-title">Documents</h1>
      <p className="muted">
        Turn on a folder and Titan reads its PDFs, Word, Excel and PowerPoint files and emails, so
        you can ask about them and get answers with the file and page. New and changed files are
        read by themselves. Everything stays on this laptop.
      </p>
      {engine.folders.length === 0 && (
        <p className="empty">Allow a folder first (in the sidebar), then turn it on here.</p>
      )}
      {engine.folders.map((path) => {
        const f = folders.find((x) => x.path === path)
        const on = !!f?.indexed
        return (
          <div key={path} className={on ? 'row row-tint doc-folder' : 'row doc-folder'}>
            <div className="row-main">
              <p className="row-title" title={path}>
                {folderName(path)}
                {f?.progress && (
                  <span className="tag">
                    Reading {f.progress.done} of {f.progress.total}
                  </span>
                )}
              </p>
              {on && f && (
                <p className="muted">
                  {f.ok} files, {f.passages} passages
                  {f.passages > 0 && f.withMeaning < f.passages
                    ? f.withMeaning
                      ? ' · search by meaning partly ready'
                      : ' · search by meaning not ready yet (its model downloads once, about 120 MB)'
                    : ''}
                  {f.problems ? ` · ${f.problems} could not be read` : ''}
                  {f.scannedPages
                    ? ` · ${f.scannedPages} scanned pages without text (OCR comes later)`
                    : ''}
                </p>
              )}
              {on && f && f.errors.length > 0 && (
                <details>
                  <summary className="muted">Files that could not be read</summary>
                  <ul className="muted">
                    {f.errors.map((e) => (
                      <li key={e.path}>
                        {e.path}: {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {on && f && (
                <div className="doc-flags">
                  <label>
                    <input
                      type="checkbox"
                      checked={f.readOnly}
                      onChange={(e) => void set(path, { readOnly: e.target.checked })}
                    />{' '}
                    Read-only for agents
                  </label>
                  <label title="What is in this folder may go to local models only, never to a cloud model">
                    <input
                      type="checkbox"
                      checked={f.localOnly}
                      onChange={(e) => void set(path, { localOnly: e.target.checked })}
                    />{' '}
                    Local models only
                  </label>
                </div>
              )}
            </div>
            {on && (
              <button
                className="btn"
                onClick={() =>
                  void client!.send('POST', '/v1/documents/reindex', { path, full: true })
                }
              >
                Read again
              </button>
            )}
            <button
              className={on ? 'btn' : 'btn btn-primary'}
              onClick={() => void set(path, { indexed: !on })}
            >
              {on ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        )
      })}

      {folders.some((f) => f.indexed) && (
        <>
          <h2 className="section">Try a search</h2>
          <form
            className="share-link"
            onSubmit={(e) => {
              e.preventDefault()
              void search()
            }}
          >
            <input
              value={query}
              placeholder="e.g. how much is the rent for the warehouse"
              aria-label="Search the documents"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn btn-primary">Search</button>
          </form>
          {hits && hits.length === 0 && <p className="empty">Nothing found.</p>}
          {hits?.map((h, i) => (
            <div key={i} className="row">
              <div className="row-main">
                <p className="row-title">
                  {h.file}
                  <span className="tag">{h.label}</span>
                </p>
                <p className="muted doc-passage">{h.text.slice(0, 400)}</p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
