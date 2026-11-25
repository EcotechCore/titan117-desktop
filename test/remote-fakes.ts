// A fake of our cloud's /desktop/remote route (decisions §64) for the remote bridge's tests.
import { randomId } from '../src/shared/remote-protocol'

export interface CloudMessage {
  id: string
  from: string
  to: string
  kind: 'command' | 'event' | 'key'
  msgId: string
  notify?: boolean
  sealed: string
}

/** A fake of /desktop/remote with the rules that matter to the laptop. */
export type FakeCloud = {
  enabled: boolean
  laptopKey: string | null
  keys: { publicKey: string; name: string; kind: string }[]
  toLaptop: CloudMessage[]
  fromLaptop: CloudMessage[]
  pairings: { id: string; publicKey: string; name: string }[]
  openPairing: { id: string; expiresAt: number } | null
  revokedAllAt: number | null
  answers: unknown[]
  revoked: string[]
  calls: number
  fetch: typeof fetch
}

export function fakeCloud(): FakeCloud {
  const cloud = {
    enabled: false,
    laptopKey: null as string | null,
    keys: [] as { publicKey: string; name: string; kind: string }[],
    toLaptop: [] as CloudMessage[],
    fromLaptop: [] as CloudMessage[],
    pairings: [] as { id: string; publicKey: string; name: string }[],
    openPairing: null as { id: string; expiresAt: number } | null,
    revokedAllAt: null as number | null,
    answers: [] as unknown[],
    revoked: [] as string[],
    calls: 0,
    fetch: (async (_url: string, init: RequestInit) => {
      cloud.calls++
      const body = JSON.parse(String(init.body))
      if (!body.on) cloud.enabled = false
      if (body.laptopKey && cloud.enabled) cloud.laptopKey = body.laptopKey
      for (const m of body.outgoing ?? [])
        cloud.fromLaptop.push({ id: randomId(), from: cloud.laptopKey!, ...m })
      cloud.toLaptop = cloud.toLaptop.filter((m) => !(body.ack ?? []).includes(m.id))
      if (body.answerPairing) cloud.answers.push(body.answerPairing)
      if (body.revokeKeys) cloud.revoked.push(...body.revokeKeys)
      const openPairing = body.startPairing
        ? { id: 'pair_1', expiresAt: Date.now() + 300_000 }
        : null
      if (!cloud.enabled || !body.on)
        return Response.json({
          enabled: false,
          inbox: [],
          keys: [],
          pairings: [],
          openPairing: null,
          revokedAllAt: cloud.revokedAllAt
        })
      return Response.json({
        enabled: true,
        wakeAt: null,
        revokedAllAt: cloud.revokedAllAt,
        inbox: cloud.toLaptop,
        keys: cloud.keys,
        pairings: cloud.pairings,
        openPairing
      })
    }) as unknown as typeof fetch
  }
  return cloud
}
