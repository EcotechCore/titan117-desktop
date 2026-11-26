/**
 * The licence lease (decisions §17, §39): our server signs it, this app
 * checks it. Plain functions, so tests can run them without Electron.
 *
 * A lease is `payload.signature`, both base64url; the payload is JSON, the
 * signature ECDSA P-256 / SHA-256 in IEEE P1363 form (r and s, 64 bytes).
 */
import { createPublicKey, verify } from 'node:crypto'

import {
  SECOND_FACTOR_PROOF_PREFIX,
  SECOND_FACTOR_PROOF_TTL_MS,
  type SecondFactorProof
} from '../shared/remote-protocol'

/**
 * Public half of the lease signing key on the Convex development deployment.
 * Replaced by the production key (and kept alongside it during a change of
 * keys) before the first external testers (phase 18).
 */
export const LEASE_PUBLIC_KEYS = [
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE20a/QKk1/0o4Vsgm1Cn33Q7A4JRzQWU7uQOz+Y0b2r5V0TZOPU4x/+t17VREighZv4VW0IfMMVuS6+3vv7/XYg=='
]

/** Days before expiry when the app starts asking to connect (decisions §17). */
export const WARN_DAYS = 3
const DAY = 24 * 60 * 60 * 1000

export interface Lease {
  v: 1
  sub: string
  dev: string
  plan: 'starter' | 'pro' | 'max' | 'custom' | null
  devices: number
  iat: number
  exp: number
}

function fromBase64url(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** The lease's contents if one of our keys signed it, else null. Never throws. */
export function verifyLease(lease: string, keys: string[] = LEASE_PUBLIC_KEYS): Lease | null {
  const [body, sig, extra] = lease.split('.')
  if (!body || !sig || extra !== undefined) return null
  const signed = keys.some((spki) => {
    try {
      const key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' })
      return verify(
        'sha256',
        Buffer.from(body),
        { key, dsaEncoding: 'ieee-p1363' },
        fromBase64url(sig)
      )
    } catch {
      return false
    }
  })
  if (!signed) return null
  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf8')) as Lease
    if (payload.v !== 1 || typeof payload.exp !== 'number' || typeof payload.iat !== 'number')
      return null
    return payload
  } catch {
    return null
  }
}

export type LockReason = 'signedOut' | 'noPlan' | 'expired'

export interface AccountStatus {
  signedIn: boolean
  locked: boolean
  reason: LockReason | null
  plan: Lease['plan']
  /** When the app locks if it can't reach us before then. */
  expiresAt: number | null
  /** True in the last days before that: "Connect to the internet to keep using Titan117". */
  warn: boolean
}

/**
 * What the app may do now. `now` is the latest time this app has seen: the
 * clock, the last time it remembers, or the lease's own signing time,
 * whichever is latest, so setting the clock back doesn't extend a lease.
 */
export function accountStatus(input: {
  signedIn: boolean
  lease: Lease | null
  now: number
}): AccountStatus {
  const { signedIn, lease, now } = input
  if (!signedIn)
    return { signedIn, locked: true, reason: 'signedOut', plan: null, expiresAt: null, warn: false }
  if (!lease || lease.plan === null)
    return { signedIn, locked: true, reason: 'noPlan', plan: null, expiresAt: null, warn: false }
  const effectiveNow = Math.max(now, lease.iat)
  if (effectiveNow >= lease.exp)
    return {
      signedIn,
      locked: true,
      reason: 'expired',
      plan: lease.plan,
      expiresAt: lease.exp,
      warn: false
    }
  return {
    signedIn,
    locked: false,
    reason: null,
    plan: lease.plan,
    expiresAt: lease.exp,
    warn: lease.exp - effectiveNow <= WARN_DAYS * DAY
  }
}

/**
 * Convex's proof of a fresh second factor for one remote answer to one
 * laptop-only approval (decisions §65.7). Signed with the lease key over the
 * prefix `SECOND_FACTOR_PROOF_PREFIX`, so a lease can never pass for a proof.
 * Returns the proof's contents when it is ours, for this account, from this
 * device, for this approval and not expired; else null. Never throws.
 */
export function verifySecondFactorProof(
  proof: string,
  expect: { account: string; deviceKey: string; approvalId: string; now: number },
  keys: string[] = LEASE_PUBLIC_KEYS
): SecondFactorProof | null {
  const [body, sig, extra] = proof.split('.')
  if (!body || !sig || extra !== undefined) return null
  const signed = keys.some((spki) => {
    try {
      const key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' })
      return verify(
        'sha256',
        Buffer.from(SECOND_FACTOR_PROOF_PREFIX + body),
        { key, dsaEncoding: 'ieee-p1363' },
        fromBase64url(sig)
      )
    } catch {
      return false
    }
  })
  if (!signed) return null
  try {
    const p = JSON.parse(fromBase64url(body).toString('utf8')) as SecondFactorProof
    const ok =
      p.v === 1 &&
      p.kind === 'second-factor' &&
      p.sub === expect.account &&
      p.key === expect.deviceKey &&
      p.approval === expect.approvalId &&
      typeof p.exp === 'number' &&
      typeof p.iat === 'number' &&
      p.exp > expect.now &&
      p.iat <= expect.now + 60_000 &&
      p.exp - p.iat <= SECOND_FACTOR_PROOF_TTL_MS
    return ok ? p : null
  } catch {
    return null
  }
}
