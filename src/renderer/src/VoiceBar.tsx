// What the message box shows while you speak: a live sound meter and a timer,
// so you can see the microphone is hearing you, with Cancel and Done (like
// the voice input in other chat apps). Enter finishes, Escape cancels.
import { useEffect, useRef, useState } from 'react'

import { Icon } from './ui'

const BARS = 64

export function VoiceBar({
  state,
  level,
  onDone,
  onCancel
}: {
  state: 'recording' | 'transcribing'
  /** The microphone's level now, 0 to 1. */
  level(): number
  onDone(): void
  onCancel(): void
}): React.JSX.Element {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0))
  const [seconds, setSeconds] = useState(0)
  const started = useRef(0)

  useEffect(() => {
    if (state !== 'recording') return
    started.current = Date.now()
    let frame = 0
    let last = 0
    const tick = (now: number): void => {
      // About 12 bars a second: the newest on the right, older ones move left.
      if (now - last > 80) {
        last = now
        const value = level()
        setLevels((current) => [...current.slice(1), value])
        setSeconds(Math.floor((Date.now() - started.current) / 1000))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state, level])

  useEffect(() => {
    if (state !== 'recording') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onDone()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, onDone, onCancel])

  if (state === 'transcribing')
    return (
      <div className="voice-bar" role="status">
        <span className="shimmer">Writing out what you said…</span>
      </div>
    )

  const heard = levels.some((l) => l > 0.08)
  return (
    <div className="voice-bar" role="group" aria-label="Recording">
      <span className="rec-dot" aria-hidden="true" />
      <span className="mono rec-time">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
      <div className="meter" aria-hidden="true">
        {levels.map((l, i) => (
          <span key={i} style={{ height: `${Math.max(8, Math.round(l * 100))}%` }} />
        ))}
      </div>
      <span className="rec-hint faint">{heard ? 'Listening' : 'Speak now'}</span>
      <button className="icon-btn" aria-label="Cancel recording" onClick={onCancel}>
        <Icon name="x" />
      </button>
      <button className="voice-done" aria-label="Done, write it out" onClick={onDone}>
        <Icon name="check" />
      </button>
    </div>
  )
}
