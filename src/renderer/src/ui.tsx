// Small shared pieces: icons and Titan's eyes.
const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  send: 'M5 12h14M13 6l6 6-6 6',
  stop: 'M7 7h10v10H7z',
  tasks: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z',
  chip: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M7 7h10v10H7z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  panel: 'M4 5h16v14H4zM15 5v14',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  down: 'M12 4v12M6 11l6 6 6-6M5 20h14',
  chevron: 'M6 9l6 6 6-6'
}

export function Icon({ name }: { name: keyof typeof PATHS }): React.JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export type EyesState = 'idle' | 'working' | 'needs-you'

/** Titan's eyes: gray at rest, tomato while working or waiting (design.md §2.4). */
export function Eyes({
  state,
  size = 'small'
}: {
  state: EyesState
  size?: 'small' | 'large'
}): React.JSX.Element {
  return (
    <svg className={`eyes eyes-${size} eyes-${state}`} viewBox="0 0 40 20" aria-hidden="true">
      <path d="M3 5l13 4v5a6 6 0 0 1-13 0z" />
      <path d="M37 5L24 9v5a6 6 0 0 0 13 0z" />
    </svg>
  )
}
