// Helpers for the code builder screen and diffs (kept apart from components for fast refresh).

/** Counts of added and removed lines in a diff. */
export function diffCounts(text: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

/** What Titan is asked to do; the tools and approvals do the rest. */
export function codeRequest(folder: string, request: string, mode: 'plan' | 'build'): string {
  return mode === 'plan'
    ? `In the project folder ${folder}: ${request.trim()}\n\nUse the coding engine (code_task) in plan mode: read the code and propose a plan, listing the files it would change. Don't change anything yet.`
    : `In the project folder ${folder}: ${request.trim()}\n\nUse the coding engine (code_task) in build mode, and run the project's tests if it has them. When it's done, tell me what changed. Don't commit, push or open a pull request unless I ask.`
}
