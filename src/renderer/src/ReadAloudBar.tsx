/**
 * Read aloud (feature 3.14): while Titan reads a reply, a small bar shows
 * where it is, with pause and resume, stop and the speed. Escape stops it.
 */
import { useEffect, useState } from 'react'

import { Icon } from './ui'
import { seekPlaying, setPlayingSpeed } from './voice'

export type Reading =
  { state: 'preparing' } | { state: 'playing' | 'paused'; audio: HTMLAudioElement }

const SPEEDS = [0.75, 1, 1.25, 1.5]

function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ReadAloudBar({
  reading,
  onPause,
  onResume,
  onStop
}: {
  reading: Reading
  onPause(): void
  onResume(): void
  onStop(): void
}): React.JSX.Element {
  const [, tick] = useState(0)
  const audio = reading.state === 'preparing' ? null : reading.audio

  // The time and the progress bar follow the audio.
  useEffect(() => {
    if (!audio) return
    const update = (): void => tick((n) => n + 1)
    audio.addEventListener('timeupdate', update)
    audio.addEventListener('loadedmetadata', update)
    return () => {
      audio.removeEventListener('timeupdate', update)
      audio.removeEventListener('loadedmetadata', update)
    }
  }, [audio])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onStop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStop])

  const duration = audio?.duration ?? 0
  const current = audio?.currentTime ?? 0
  return (
    <div className="read-bar" role="region" aria-label="Reading aloud">
      <Icon name="speaker" />
      {reading.state === 'preparing' ? (
        <span className="read-label">Preparing to read aloud…</span>
      ) : (
        <>
          <button
            className="icon-btn"
            aria-label={reading.state === 'playing' ? 'Pause' : 'Resume'}
            title={reading.state === 'playing' ? 'Pause' : 'Resume'}
            onClick={reading.state === 'playing' ? onPause : onResume}
          >
            <Icon name={reading.state === 'playing' ? 'pause' : 'play'} />
          </button>
          <span className="read-time mono">
            {clock(current)} / {clock(duration)}
          </span>
          <input
            className="read-progress"
            type="range"
            min={0}
            max={Number.isFinite(duration) && duration > 0 ? duration : 1}
            step={0.1}
            value={current}
            aria-label="Position"
            onChange={(e) => seekPlaying(Number(e.target.value))}
          />
          <label className="read-speed">
            <span className="sr">Speed</span>
            <select
              value={audio?.playbackRate ?? 1}
              onChange={(e) => {
                setPlayingSpeed(Number(e.target.value))
                tick((n) => n + 1)
              }}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button className="btn" onClick={onStop} title="Stop (Esc)">
        <Icon name="stop" /> Stop
      </button>
    </div>
  )
}
