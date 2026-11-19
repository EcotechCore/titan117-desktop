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
  chevron: 'M6 9l6 6 6-6',
  brain:
    'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7z',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'
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
