// A unified diff, line by line: added lines in green, removed in red,
// file headers bold (feature 13.3, design.md: no black blocks).
export function Diff({ text, max = 4000 }: { text: string; max?: number }): React.JSX.Element {
  const lines = text.split(/\r?\n/)
  const shown = lines.slice(0, max)
  return (
    <pre className="diff" aria-label="Changes">
      {shown.map((line, i) => {
        const kind = /^(diff --git|index |\+\+\+ |--- )/.test(line)
          ? 'diff-file'
          : line.startsWith('@@')
            ? 'diff-hunk'
            : line.startsWith('+')
              ? 'diff-add'
              : line.startsWith('-')
                ? 'diff-del'
                : 'diff-ctx'
        return (
          <span key={i} className={kind}>
            {line}
            {'\n'}
          </span>
        )
      })}
      {lines.length > max && <span className="diff-hunk">… {lines.length - max} more lines</span>}
    </pre>
  )
}
