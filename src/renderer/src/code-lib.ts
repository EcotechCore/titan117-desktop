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

/** A review of the uncommitted changes or the whole branch (13.10). */
export function reviewRequest(folder: string, scope: 'changes' | 'branch'): string {
  return `Review the ${scope === 'branch' ? 'current branch against the main branch' : 'uncommitted changes'} in the project folder ${folder} for bugs, with the code review tool (code_review, scope "${scope}"). Tell me what it finds; don't change anything.`
}

/** What Titan is asked to do; the tools and approvals do the rest. */
export function codeRequest(
  folder: string,
  request: string,
  mode: 'plan' | 'build',
  tool: { id: string; name: string } | null = null
): string {
  const engine = tool
    ? `my own ${tool.name} (code_task with tool "${tool.id}")`
    : 'the coding engine (code_task)'
  return mode === 'plan'
    ? `In the project folder ${folder}: ${request.trim()}\n\nUse ${engine} in plan mode: read the code and propose a plan, listing the files it would change. Don't change anything yet.`
    : `In the project folder ${folder}: ${request.trim()}\n\nUse ${engine} in build mode, and run the project's tests if it has them. When it's done, tell me what changed. Don't commit, push or open a pull request unless I ask.`
}
