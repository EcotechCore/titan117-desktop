/**
 * Setup and health (features 1.4, 1.12, 1.13, 1.16-1.18, 1.20, 1.21): what
 * this laptop has, what is ready, what is missing for what the user wants to
 * do, and what broke. Every item says how to fix it; nothing here changes
 * anything by itself.
 */
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs'
import { cpus, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'

import type {
  KeyProvider,
  SetupCheck,
  SetupComponent,
  SetupInterest,
  SetupState
} from '../../shared/protocol'
import type { Fetch } from './net'

export type { SetupCheck, SetupComponent, SetupInterest, SetupState }

const GB = 1024 ** 3
/** Below this the app warns; below the second it says work may fail (1.21). */
export const DISK_LOW = 10 * GB
export const DISK_CRITICAL = 2 * GB

/** A folder's size on disk, stopping early for huge trees. */
export function folderBytes(dir: string, limit = 200_000): number {
  let total = 0
  let seen = 0
  const stack = [dir]
  while (stack.length && seen < limit) {
    const current = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      seen++
      const p = join(current, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) {
        try {
          total += statSync(p).size
        } catch {
          // Gone while counting.
        }
      }
    }
  }
  return total
}

export function diskOf(dir: string): { freeBytes: number; totalBytes: number } | null {
  try {
    const s = statfsSync(dir)
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }
  } catch {
    return null
  }
}

/** How each saved model key is checked (the same calls as when it was saved, decisions §40). */
async function keyWorks(
  provider: KeyProvider,
  key: string,
  fetchFn: Fetch
): Promise<boolean | null> {
  const request: Record<string, [string, Record<string, string>]> = {
    openrouter: ['https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` }],
    openai: ['https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }],
    google: [
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
      { Authorization: `Bearer ${key}` }
    ],
    anthropic: [
      'https://api.anthropic.com/v1/models?limit=1',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    ]
  }
  const entry = request[provider]
  // Search keys are checked only by searching, which costs; they're left alone here.
  if (!entry) return null
  try {
    const res = await fetchFn(entry[0], { headers: entry[1] })
    if (res.ok) return true
    if ([400, 401, 403].includes(res.status)) return false
    return null
  } catch {
    return null
  }
}

const NAMES: Record<KeyProvider, string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  exa: 'Exa',
  tavily: 'Tavily',
  brave: 'Brave',
  cloudflare: 'Cloudflare',
  pagespeed: 'Google PageSpeed',
  brevo: 'Brevo',
  postmark: 'Postmark'
}

/** What the checklist reads; the engine fills it in. */
export interface SetupFacts {
  dataDir: string | null
  signedIn: boolean
  locked: boolean
  lockReason: string | null
  cloud: boolean
  defaultModel: string | null
  hardware: { ramBytes: number; vramBytes: number; gpu: string | null }
  localProblem: string | null
  localModels: { id: string; name: string; fit: string; state: string; sizeBytes: number }[]
  folders: string[]
  ownKeys: Partial<Record<KeyProvider, string>>
  browser: 'msedge' | 'chrome' | null
  connectors: { name: string; status: string; error: string | null }[]
  queuedReports: number
  errorsToday: number
  interests: SetupInterest[]
}

function gb(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** The setup checklist (1.20): ready, missing, a problem, or suggested next. */
export function checklist(
  f: SetupFacts,
  health: Partial<Record<KeyProvider, boolean>> = {}
): SetupCheck[] {
  const out: SetupCheck[] = []
  const wants = (i: SetupInterest): boolean => f.interests.length === 0 || f.interests.includes(i)

  out.push(
    f.signedIn && !f.locked
      ? {
          id: 'account',
          area: 'Account',
          title: 'Signed in to Titan117',
          status: 'ready',
          detail: '',
          fix: null
        }
      : {
          id: 'account',
          area: 'Account',
          title: f.signedIn ? 'Titan117 is locked' : 'Sign in to Titan117',
          status: 'problem',
          detail: f.lockReason ?? 'Your plan and credits come with your account.',
          fix: { kind: 'account', label: f.signedIn ? 'Renew' : 'Sign in' }
        }
  )

  const ready = f.localModels.filter((m) => m.state === 'ready')
  out.push(
    f.defaultModel
      ? {
          id: 'model',
          area: 'Models',
          title: 'A model is chosen',
          status: 'ready',
          detail: '',
          fix: null
        }
      : {
          id: 'model',
          area: 'Models',
          title: 'Choose a model',
          status: 'missing',
          detail:
            'Titan needs a model to think with: a local one, or a cloud one through credits or your own key.',
          fix: { kind: 'view', target: 'models', label: 'Choose' }
        }
  )
  if (f.localProblem)
    out.push({
      id: 'local',
      area: 'Models',
      title: 'Local models can’t run on this laptop',
      status: 'suggested',
      detail: `${f.localProblem} Cloud models work instead, through credits or your own key (1.18).`,
      // Microsoft's own permanent link to its Visual C++ runtime (decisions §49).
      fix: /Visual C\+\+/.test(f.localProblem)
        ? {
            kind: 'link',
            target: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
            label: 'Get the runtime'
          }
        : { kind: 'view', target: 'models', label: 'See cloud models' }
    })
  else if (!ready.length) {
    const best = [...f.localModels]
      .filter((m) => m.fit === 'runs well')
      .sort((a, b) => b.sizeBytes - a.sizeBytes)[0]
    out.push({
      id: 'local',
      area: 'Models',
      title: 'Download a local model to work offline',
      status: 'suggested',
      detail: best
        ? `${best.name} runs well on this laptop (${gb(best.sizeBytes)}). Free, private, and it works without internet.`
        : 'None of the catalogue runs well on this laptop; the small ones run slowly.',
      fix: { kind: 'view', target: 'models', label: 'Models' }
    })
  } else
    out.push({
      id: 'local',
      area: 'Models',
      title: `${ready.length} local model${ready.length === 1 ? '' : 's'} ready, also offline`,
      status: 'ready',
      detail: '',
      fix: null
    })

  out.push(
    f.cloud
      ? {
          id: 'cloud',
          area: 'Models',
          title: 'Cloud models can be used',
          status: 'ready',
          detail: '',
          fix: null
        }
      : {
          id: 'cloud',
          area: 'Models',
          title: 'No cloud models yet',
          status: 'suggested',
          detail:
            'Sign in to use credits, or add your own OpenRouter, Anthropic, OpenAI or Google key.',
          fix: { kind: 'view', target: 'models', label: 'Add a key' }
        }
  )

  for (const [provider, works] of Object.entries(health) as [KeyProvider, boolean][])
    if (works === false)
      out.push({
        id: `key-${provider}`,
        area: 'Models',
        title: `Your ${NAMES[provider]} key no longer works`,
        status: 'problem',
        detail:
          'It was refused just now: it may have expired or been revoked. Replace it, or remove it.',
        fix: {
          kind: 'view',
          target:
            provider === 'exa' ||
            provider === 'tavily' ||
            provider === 'brave' ||
            provider === 'pagespeed'
              ? 'search'
              : provider === 'cloudflare'
                ? 'apps'
                : 'models',
          label: 'Replace'
        }
      })

  if (wants('documents') || wants('everyday'))
    out.push(
      f.folders.length
        ? {
            id: 'folders',
            area: 'Files',
            title: `${f.folders.length} folder${f.folders.length === 1 ? '' : 's'} allowed`,
            status: 'ready',
            detail: '',
            fix: null
          }
        : {
            id: 'folders',
            area: 'Files',
            title: 'Allow a folder',
            status: wants('documents') && f.interests.length ? 'missing' : 'suggested',
            detail:
              'Titan can only see the folders you allow, and asks before changing anything in them.',
            fix: { kind: 'folder', label: 'Allow a folder' }
          }
    )

  if (wants('research')) {
    const searchKey = (['exa', 'tavily', 'brave'] as const).find((p) => f.ownKeys[p])
    out.push(
      f.cloud || searchKey
        ? {
            id: 'search',
            area: 'Web search',
            title: searchKey
              ? `Web search with your ${NAMES[searchKey]} key`
              : 'Web search through credits',
            status: 'ready',
            detail: '',
            fix: null
          }
        : {
            id: 'search',
            area: 'Web search',
            title: 'No web search yet',
            status: 'missing',
            detail: 'Sign in to search through credits, or add your own Exa, Tavily or Brave key.',
            fix: { kind: 'view', target: 'search', label: 'Web search' }
          }
    )
  }

  out.push(
    f.browser
      ? {
          id: 'browser',
          area: 'Browser',
          title: `The browser tool uses your ${f.browser === 'msedge' ? 'Edge' : 'Chrome'}`,
          status: 'ready',
          detail: '',
          fix: null
        }
      : {
          id: 'browser',
          area: 'Browser',
          title: 'No Edge or Chrome found',
          status: 'missing',
          detail:
            'The browser tool drives your own Edge or Chrome. Install one, then come back (1.14).',
          fix: { kind: 'link', target: 'https://www.google.com/chrome/', label: 'Get Chrome' }
        }
  )

  for (const c of f.connectors.filter((c) => c.status === 'error'))
    out.push({
      id: `connector-${c.name}`,
      area: 'Connectors',
      title: `${c.name} can’t connect`,
      status: 'problem',
      detail: c.error ?? 'It stopped answering.',
      fix: { kind: 'view', target: 'connectors', label: 'Connectors' }
    })

  if (f.dataDir) {
    const disk = diskOf(f.dataDir)
    if (disk && disk.freeBytes < DISK_LOW)
      out.push({
        id: 'disk',
        area: 'This laptop',
        title: `Only ${gb(disk.freeBytes)} free on the disk`,
        status: disk.freeBytes < DISK_CRITICAL ? 'problem' : 'suggested',
        detail:
          'Downloads, local models and builds need room. Remove local models you don’t use, or free some space.',
        fix: { kind: 'view', target: 'models', label: 'Local models' }
      })
  }

  if (f.queuedReports)
    out.push({
      id: 'reports',
      area: 'Error reports',
      title: `${f.queuedReports} error report${f.queuedReports === 1 ? '' : 's'} waiting to be sent`,
      status: 'suggested',
      detail: 'They go by themselves once you’re online and signed in.',
      fix: null
    })
  if (f.errorsToday)
    out.push({
      id: 'errors',
      area: 'Error reports',
      title: `${f.errorsToday} error${f.errorsToday === 1 ? '' : 's'} in the last day`,
      status: 'suggested',
      detail:
        'They’re in the local log. If something isn’t working, tell us; you’ll see the whole report first.',
      fix: { kind: 'report', label: 'Report a problem' }
    })

  return out
}

export interface SetupService {
  state(health?: Partial<Record<KeyProvider, boolean>>): Promise<SetupState>
  /** The health check (1.21): saved keys tried with their providers, then the checklist. */
  runHealth(): Promise<SetupState>
}

export function createSetupService(deps: {
  facts(): Promise<SetupFacts>
  fetch: Fetch
  done(): boolean
}): SetupService {
  let lastHealth: Partial<Record<KeyProvider, boolean>> = {}
  let checkedAt: number | null = null

  function components(dataDir: string | null): SetupComponent[] {
    if (!dataDir) return []
    const parts: [string, string, string][] = [
      ['models', 'Local models', join(dataDir, 'components', 'models')],
      ['speech', 'Speech model (Whisper)', join(dataDir, 'components', 'speech')],
      ['browser', 'Browser profile (your site sign-ins)', join(dataDir, 'browser-profile')],
      ['logs', 'Local log', join(dataDir, 'logs')]
    ]
    return parts
      .filter(([, , dir]) => existsSync(dir))
      .map(([id, name, dir]) => ({ id, name, bytes: folderBytes(dir) }))
  }

  const service: SetupService = {
    async state(health = lastHealth) {
      const f = await deps.facts()
      const disk = f.dataDir ? diskOf(f.dataDir) : null
      return {
        done: deps.done(),
        interests: f.interests,
        hardware: {
          os: `${platform()} ${release()}`,
          cpu: cpus()[0]?.model?.trim() ?? 'unknown',
          cores: cpus().length,
          ramBytes: f.hardware.ramBytes || totalmem(),
          vramBytes: f.hardware.vramBytes,
          gpu: f.hardware.gpu,
          diskFreeBytes: disk?.freeBytes ?? null,
          diskTotalBytes: disk?.totalBytes ?? null
        },
        checks: checklist(f, health),
        components: components(f.dataDir),
        checkedAt
      }
    },

    async runHealth() {
      const { ownKeys } = await deps.facts()
      const results: Partial<Record<KeyProvider, boolean>> = {}
      await Promise.all(
        (Object.entries(ownKeys) as [KeyProvider, string][]).map(async ([provider, key]) => {
          const works = await keyWorks(provider, key, deps.fetch)
          if (works !== null) results[provider] = works
        })
      )
      lastHealth = results
      checkedAt = Date.now()
      return service.state(results)
    }
  }
  return service
}
