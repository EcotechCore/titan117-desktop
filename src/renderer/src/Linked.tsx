// Text with its https links clickable; they open in the user's own browser
// (the window turns a new-window link into shell.openExternal, https only).
import { splitLinks } from './links-lib'

export function Linked({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {splitLinks(text).map((piece, i) =>
        'url' in piece ? (
          <a key={i} href={piece.url} target="_blank" rel="noreferrer" className="reply-link">
            {piece.url}
          </a>
        ) : (
          <span key={i}>{piece.text}</span>
        )
      )}
    </>
  )
}
