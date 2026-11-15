/**
 * Speech as a tool (feature 3.14, decisions §34.3, §43), on the laptop:
 *
 *   speech to text   Whisper (OpenAI's model, Apache 2.0) through transformers.js
 *                    (Apache 2.0) and ONNX Runtime (MIT). The model (about
 *                    80 MB) downloads from Hugging Face the first time.
 *   text to speech   the operating system's own voices: Windows' speech
 *                    synthesizer, macOS's `say`. Nothing to download.
 *
 * Kokoro is not used yet: its phonemizer bundles eSpeak NG, which is GPL.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { FileAccess } from './folders'
import { PermissionError } from './folders'

export interface SpeechAccess {
  /** Read text aloud into a WAV file inside an allowed folder. Returns its length in seconds. */
  speak(text: string, path: string): Promise<{ path: string; seconds: number }>
  /** Turn a WAV recording inside an allowed folder into text. */
  transcribe(path: string): Promise<string>
}

export interface SpeechEngine {
  /** Text from 16 kHz mono samples. */
  transcribe(samples: Float32Array, language?: string): Promise<string>
  /** A WAV file of the text read aloud. */
  synthesize(text: string): Promise<Buffer>
  /** The access a tool gets, writing and reading through its file access. */
  access(files: FileAccess): SpeechAccess
}

export const WHISPER_MODEL = 'onnx-community/whisper-base'
const MAX_SPEAK_CHARS = 20_000
const MAX_SECONDS = 30 * 60

/** Samples from a WAV file (PCM 8/16/24/32-bit or 32-bit float), mixed to mono and resampled to 16 kHz. */
export function decodeWav(data: Buffer): { samples: Float32Array; seconds: number } {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Only WAV recordings can be transcribed for now.')
  let offset = 12
  let format = 0
  let channels = 1
  let rate = 16000
  let bits = 16
  let pcm: Buffer | null = null
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = data.readUInt16LE(body)
      channels = data.readUInt16LE(body + 2)
      rate = data.readUInt32LE(body + 4)
      bits = data.readUInt16LE(body + 14)
      if (format === 0xfffe) format = data.readUInt16LE(body + 24)
    } else if (id === 'data') {
      pcm = data.subarray(body, Math.min(body + size, data.length))
      break
    }
    offset = body + size + (size % 2)
  }
  if (!pcm || channels < 1) throw new Error('That WAV file has no sound in it.')
  const bytes = bits / 8
  const frames = Math.floor(pcm.length / (bytes * channels))
  if (frames / rate > MAX_SECONDS) throw new Error('That recording is longer than 30 minutes.')
  const read = (i: number): number => {
    if (format === 3 && bits === 32) return pcm!.readFloatLE(i)
    if (bits === 16) return pcm!.readInt16LE(i) / 32768
    if (bits === 8) return (pcm!.readUInt8(i) - 128) / 128
    if (bits === 24) return pcm!.readIntLE(i, 3) / 8388608
    if (bits === 32) return pcm!.readInt32LE(i) / 2147483648
    throw new Error(`WAV files with ${bits}-bit samples aren't supported.`)
  }
  const mono = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += read((f * channels + c) * bytes)
    mono[f] = sum / channels
  }
  return { samples: resample(mono, rate, 16000), seconds: frames / rate }
}

/** Linear resampling; good enough for speech recognition. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const length = Math.floor((input.length * to) / from)
  const out = new Float32Array(length)
  const ratio = from / to
  for (let i = 0; i < length; i++) {
    const at = i * ratio
    const left = Math.floor(at)
    const right = Math.min(left + 1, input.length - 1)
    const t = at - left
    out[i] = input[left] * (1 - t) + input[right] * t
  }
  return out
}

function run(program: string, args: string[], stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (errors += chunk))
    const timer = setTimeout(() => child.kill(), 120_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else
        reject(
          new Error(`The system voice failed${errors ? `: ${errors.trim().slice(0, 200)}` : '.'}`)
        )
    })
    child.stdin.end(stdin, 'utf8')
  })
}

export function createSpeechEngine(options: {
  /** Where the Whisper model is kept (the components folder). */
  modelsDir: string
  /** Scratch space for the system voice's output. */
  scratchDir: string
  platform?: NodeJS.Platform
}): SpeechEngine {
  const platform = options.platform ?? process.platform
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognizer: Promise<any> | null = null

  async function load(): Promise<
    (samples: Float32Array, opts: object) => Promise<{ text: string }>
  > {
    recognizer ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = options.modelsDir
      env.allowLocalModels = false
      return pipeline('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'q8' })
    })().catch((error) => {
      recognizer = null
      throw error
    })
    return recognizer
  }

  const engine: SpeechEngine = {
    async transcribe(samples, language) {
      if (samples.length === 0) return ''
      const recognize = await load()
      const result = await recognize(samples, {
        ...(language ? { language } : {}),
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      })
      return (Array.isArray(result) ? result[0]?.text : result.text)?.trim() ?? ''
    },

    async synthesize(text) {
      const clean = text.trim().slice(0, MAX_SPEAK_CHARS)
      if (!clean) throw new Error('Nothing to read aloud.')
      mkdirSync(options.scratchDir, { recursive: true })
      const out = join(options.scratchDir, `speech-${randomUUID()}.wav`)
      try {
        if (platform === 'win32') {
          // The text goes in through standard input, never into the command line.
          const script = [
            'Add-Type -AssemblyName System.Speech',
            '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
            `$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}')`,
            '$s.Speak([Console]::In.ReadToEnd())',
            '$s.Dispose()'
          ].join('; ')
          await run(
            'powershell.exe',
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
            clean
          )
        } else if (platform === 'darwin') {
          await run(
            '/usr/bin/say',
            ['--file-format=WAVE', '--data-format=LEI16@22050', '-o', out, '-f', '-'],
            clean
          )
        } else {
          throw new Error('Reading aloud needs Windows or macOS for now.')
        }
        return readFileSync(out)
      } finally {
        rmSync(out, { force: true })
      }
    },

    access(files) {
      return {
        async speak(text, path) {
          if (!/\.wav$/i.test(path)) throw new PermissionError('Save speech as a .wav file.')
          const wav = await engine.synthesize(text)
          await files.writeBytes(path, wav)
          const { seconds } = decodeWav(wav)
          return { path, seconds }
        },
        async transcribe(path) {
          const { samples } = decodeWav(await files.readBytes(path))
          return engine.transcribe(samples)
        }
      }
    }
  }
  return engine
}
