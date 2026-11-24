// Fakes for the network, the browser and speech, so tool tests run offline
// and still go through the real network policy.
import type { BrowserAccess, BrowserHost, PageView } from '../src/engine/lib/browser'
import type { RunResult } from '../src/engine/lib/automation/recorder'
import type { FileAccess } from '../src/engine/lib/folders'
import type { SpeechAccess } from '../src/engine/lib/speech'
import type { TaskNet } from '../src/engine/lib/web'

export interface FakeWeb {
  fetch: typeof fetch
  requests: { url: string; body: string | null }[]
  /** Pages by address; anything else is a 404. */
  pages: Map<string, string>
}

export function fakeWeb(pages: Record<string, string> = {}): FakeWeb {
  const requests: FakeWeb['requests'] = []
  const map = new Map(Object.entries(pages))
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, body: typeof init?.body === 'string' ? init.body : null })
    const page = map.get(url)
    if (page === undefined)
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }) as typeof fetch
  return { fetch: fake, requests, pages: map }
}

export interface FakeBrowser {
  host: BrowserHost
  opened: string[]
  clicked: string[]
  typed: { ref: string; text: string }[]
  labels: Map<string, string>
  /** What open() shows for an address. */
  pages: Map<string, string>
  /** What a download control hands over, by ref. */
  downloads: Map<string, { name: string; data: Buffer; url: string }>
}

/** A browser that checks every address and field with the task's network policy, like the real one. */
export function fakeBrowser(): FakeBrowser {
  const state: FakeBrowser = {
    opened: [],
    clicked: [],
    typed: [],
    labels: new Map(),
    pages: new Map(),
    downloads: new Map(),
    host: undefined as unknown as BrowserHost
  }
  let current = 'about:blank'
  const view = (): PageView => ({
    url: current,
    title: 'Fake page',
    text: state.pages.get(current) ?? 'A page.',
    controls: [...state.labels.entries()]
      .map(([ref, label]) => `[${ref}] button "${label}"`)
      .join('\n'),
    captcha: false
  })
  state.host = {
    forTask(_taskId: string, net: TaskNet): BrowserAccess {
      return {
        async open(url) {
          await net.check(url, null, 'navigate')
          state.opened.push(url)
          current = url
          return view()
        },
        view: async () => view(),
        label: async (ref) => state.labels.get(ref) ?? '',
        async click(ref) {
          state.clicked.push(ref)
          return view()
        },
        async type(ref, text) {
          await net.check(
            current === 'about:blank' ? 'https://page.example/' : current,
            text,
            'resource'
          )
          state.typed.push({ ref, text })
          return view()
        },
        select: async () => view(),
        back: async () => view(),
        async download(ref) {
          const file = state.downloads.get(ref)
          if (!file) throw new Error('Nothing downloaded.')
          state.clicked.push(ref)
          await net.check(file.url, null, 'resource')
          return file
        },
        async replay(recording, hooks) {
          await net.check(recording.url, null, 'navigate')
          state.opened.push(recording.url)
          current = recording.url
          let done = 0
          const result = (failed: string | null): RunResult => ({
            name: recording.name,
            passed: failed === null,
            done,
            failedStep: failed === null ? null : done + 1,
            error: failed,
            url: current,
            title: 'Fake page',
            ms: 1
          })
          for (const step of recording.steps) {
            if (step.action === 'click') {
              const label = step.target.name ?? step.target.text ?? ''
              await hooks.beforeClick(label)
              state.clicked.push(label)
            }
            if (step.action === 'fill') state.typed.push({ ref: 'replay', text: step.value })
            if (step.action === 'fill_login') {
              if (!hooks.login(step.site))
                return result(`There is no saved login for ${step.site}.`)
              state.typed.push({ ref: 'login', text: step.field })
            }
            if (step.action === 'pause') await hooks.pause(step.note)
            done++
          }
          return result(null)
        }
      }
    },
    release: async () => undefined,
    close: async () => undefined
  }
  return state
}

/** Speech without models: "speaks" a tiny WAV and "hears" a fixed sentence. */
export function fakeSpeech(files: FileAccess): SpeechAccess {
  return {
    async speak(_text, path) {
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(36, 4)
      header.write('WAVE', 8)
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(1, 22)
      header.writeUInt32LE(16000, 24)
      header.writeUInt32LE(32000, 28)
      header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36)
      header.writeUInt32LE(0, 40)
      await files.writeBytes(path, header)
      return { path, seconds: 0 }
    },
    async transcribe(path) {
      await files.readBytes(path)
      return 'hello from the recording'
    }
  }
}
