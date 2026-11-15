// Voice input and reading aloud (feature 3.14). The microphone records in the
// window; the sound is turned into 16 kHz mono samples here and transcribed by
// the engine on this laptop. Nothing leaves the laptop.

export interface Recording {
  /** Stop and return the recording as 16 kHz mono 16-bit samples, base64. */
  stop(): Promise<string>
  cancel(): void
}

export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  recorder.start()
  const release = (): void => stream.getTracks().forEach((t) => t.stop())

  return {
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

/** Play a WAV (base64) the engine made; a new one stops the last. */
export function play(wavBase64: string): void {
  playing?.pause()
  const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  const audio = new Audio(url)
  audio.onended = () => URL.revokeObjectURL(url)
  playing = audio
  void audio.play()
}
