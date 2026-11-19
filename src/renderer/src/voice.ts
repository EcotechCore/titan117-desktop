// Voice input and reading aloud (feature 3.14). The microphone records in the
// window; the sound is turned into 16 kHz mono samples here and transcribed by
// the engine on this laptop. Nothing leaves the laptop.

export interface Recording {
  /** Stop and return the recording as 16 kHz mono 16-bit samples, base64. */
  stop(): Promise<string>
  cancel(): void
  /** How loud the microphone is right now, 0 to 1: drives the sound bars. */
  level(): number
}

export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  recorder.start()
  // A live meter, so the user can see the microphone is hearing them.
  const meter = new AudioContext()
  const analyser = meter.createAnalyser()
  analyser.fftSize = 1024
  meter.createMediaStreamSource(stream).connect(analyser)
  const wave = new Uint8Array(analyser.fftSize)
  const release = (): void => {
    stream.getTracks().forEach((t) => t.stop())
    void meter.close().catch(() => undefined)
  }

  return {
    level() {
      analyser.getByteTimeDomainData(wave)
      let sum = 0
      for (const v of wave) sum += ((v - 128) / 128) ** 2
      // Speech sits around 0.02-0.2 RMS; scale it so normal talking fills the bars.
      return Math.min(1, Math.sqrt(sum / wave.length) * 6)
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
    async stop() {
      const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))
      if (recorder.state !== 'inactive') recorder.stop()
      await done
      release()
      const encoded = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer()
      const decoded = await new AudioContext().decodeAudioData(encoded)
      // Mixed to mono and resampled to 16 kHz by the browser's own audio engine.
      const frames = Math.ceil(decoded.duration * 16000)
      const offline = new OfflineAudioContext(1, Math.max(frames, 1), 16000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const samples = (await offline.startRendering()).getChannelData(0)
      const ints = new Int16Array(samples.length)
      for (let i = 0; i < samples.length; i++)
        ints[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
      const bytes = new Uint8Array(ints.buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(binary)
    }
  }
}

let playing: HTMLAudioElement | null = null

/**
 * Play a WAV (base64) the engine made; a new one stops the last. Returns the
 * audio, so the window can pause, resume, seek, change the speed and stop it.
 */
export function play(wavBase64: string, onEnd?: () => void): HTMLAudioElement {
  stopPlaying()
  const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  const audio = new Audio(url)
  audio.onended = () => {
    URL.revokeObjectURL(url)
    if (playing === audio) playing = null
    onEnd?.()
  }
  playing = audio
  void audio.play()
  return audio
}

/** Stop whatever is being read aloud. */
export function stopPlaying(): void {
  if (!playing) return
  playing.pause()
  if (playing.src.startsWith('blob:')) URL.revokeObjectURL(playing.src)
  playing = null
}

/** Move the voice being read aloud to a time, in seconds. */
export function seekPlaying(seconds: number): void {
  if (playing) playing.currentTime = seconds
}

/** Read aloud faster or slower (1 is normal). */
export function setPlayingSpeed(rate: number): void {
  if (playing) playing.playbackRate = rate
}
