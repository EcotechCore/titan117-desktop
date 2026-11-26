// Laptop-only approvals answered remotely after a second factor (decisions
// §65.7; guardrails §9): Convex's signed proof is checked on the laptop, and
// the permission layer accepts such an answer only for a category the user
// switched on, never for tools marked laptop-only for anything else.
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { Risk } from '../src/shared/protocol'
import { openDb } from '../src/engine/lib/db'
import { createLogger } from '../src/engine/lib/log'
import {
  createPermissionLayer,
  type PermissionLayer,
  type RemoteCategory
} from '../src/engine/permissions'
import { createStore } from '../src/engine/store'
import { createRegistry } from '../src/engine/tools'
import { defineTool } from '../src/engine/tools/lib/define-tool'
import { verifySecondFactorProof } from '../src/main/lease'
import { until } from './helpers'

const NOW = Date.UTC(2026, 10, 26, 12)
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KEYS = [publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]
const b64url = (b: Buffer): string => b.toString('base64url')

function signed(payload: object, prefix = 'titan117 second-factor|'): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = sign('sha256', Buffer.from(prefix + body), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  })
  return `${body}.${b64url(sig)}`
}

const good = {
  v: 1,
  kind: 'second-factor',
  sub: 'user_1',
  key: 'K'.repeat(43),
  approval: 'ap_1',
  iat: NOW,
  exp: NOW + 5 * 60_000
}
const expectFor = {
  account: 'user_1',
  deviceKey: 'K'.repeat(43),
  approvalId: 'ap_1',
  now: NOW + 1000
}

describe('second-factor proofs', () => {
  it('accept our proof for this account, device and approval, before it expires', () => {
    expect(verifySecondFactorProof(signed(good), expectFor, KEYS)).toMatchObject({
      approval: 'ap_1'
    })
  })

  it('refuse anything else', () => {
    const v = (proof: string, e = expectFor): unknown => verifySecondFactorProof(proof, e, KEYS)
    expect(v(signed({ ...good, sub: 'user_2' }))).toBeNull()
    expect(v(signed({ ...good, key: 'X'.repeat(43) }))).toBeNull()
    expect(v(signed({ ...good, approval: 'ap_2' }))).toBeNull()
    expect(v(signed(good), { ...expectFor, now: NOW + 5 * 60_000 + 1 })).toBeNull()
    expect(v(signed({ ...good, exp: NOW + 60 * 60_000 }))).toBeNull()
    expect(v(signed({ ...good, kind: 'lease' }))).toBeNull()
    // Signed the way a lease is (no prefix): never a proof.
    expect(v(signed(good, ''))).toBeNull()
    // Signed by a key that isn't ours.
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    expect(
      verifySecondFactorProof(signed(good), expectFor, [
        other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
      ])
    ).toBeNull()
    expect(v('not.a.proof')).toBeNull()
  })
})

function tool(
  name: string,
  risk: Risk,
  ran: string[],
  laptopOnly?: boolean
): ReturnType<typeof defineTool> {
  return defineTool({
    name,
    description: name,
    params: {
      type: 'object',
      properties: { what: { type: 'string', description: 'what' } },
      required: []
    },
    risk,
    permissions: {},
    ...(laptopOnly === undefined ? {} : { laptopOnly }),
    describe: () => name,
    async run() {
      ran.push(name)
      return { output: 'ok', summary: `${name} done` }
    }
  })
}

function setup(categories: RemoteCategory[]): {
  layer: PermissionLayer
  ran: string[]
  exec(name: string): ReturnType<PermissionLayer['execute']>
  pending(): Promise<string>
} {
  const ran: string[] = []
  const db = openDb(':memory:')
  const store = createStore(db, () => undefined)
  const layer = createPermissionLayer({
    tools: createRegistry([
      tool('send_email', 'external', ran),
      tool('make_agent', 'write', ran, true),
      tool('change', 'write', ran)
    ]),
    store,
    log: createLogger(db, null),
    folders: () => ({ allowed: [], core: [] }),
    remoteSecondFactor: () => categories
  })
  const task = store.createTask({ title: 't', agent: 'Titan', model: 'm' })
  const abort = new AbortController()
  let n = 0
  const exec = (name: string): ReturnType<typeof layer.execute> =>
    layer.execute(
      { id: `c${++n}`, name, input: {} },
      { taskId: task.id, agent: 'Titan', model: 'm', signal: abort.signal }
    )
  const pending = async (): Promise<string> =>
    (await until(() => store.listApprovals({ taskId: task.id, status: 'pending' })[0])).id
  return { layer, ran, exec, pending }
}

describe('laptop-only approvals with a second factor', () => {
  it('are refused while the category is off, even with a checked second factor', async () => {
    const s = setup([])
    const outcome = s.exec('send_email')
    const id = await s.pending()
    expect(s.layer.laptopOnly(id)).toBe(true)
    expect(s.layer.secondFactorAllowed(id)).toBe(false)
    expect(() => s.layer.answer(id, 'approve', 'remote-second-factor')).toThrow(/laptop/)
    s.layer.answer(id, 'deny', 'window')
    await outcome
    expect(s.ran).toEqual([])
  })

  it('are accepted for a category switched on, only with the second factor', async () => {
    const s = setup(['external'])
    const outcome = s.exec('send_email')
    const id = await s.pending()
    expect(s.layer.secondFactorAllowed(id)).toBe(true)
    expect(() => s.layer.answer(id, 'approve', 'remote')).toThrow(/laptop/)
    s.layer.answer(id, 'approve', 'remote-second-factor')
    expect((await outcome).status).toBe('done')
    expect(s.ran).toEqual(['send_email'])
  })

  it('never for a tool marked laptop-only for anything else, whatever is switched on', async () => {
    const s = setup(['external', 'commands'])
    const outcome = s.exec('make_agent')
    const id = await s.pending()
    expect(s.layer.secondFactorAllowed(id)).toBe(false)
    expect(() => s.layer.answer(id, 'approve', 'remote-second-factor')).toThrow(/laptop/)
    s.layer.answer(id, 'deny', 'window')
    await outcome
    expect(s.ran).toEqual([])
  })
})
