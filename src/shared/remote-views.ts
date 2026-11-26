/** What the window sees of remote control and the chat channels (decisions §64). Never a key or a token. */

export interface TrustedDevice {
  publicKey: string
  name: string
  kind: string
  pairedAt: number
}

export interface RemoteView {
  /** The laptop's own setting. */
  on: boolean
  /** Convex confirmed it after the second factor. */
  confirmed: boolean
  problem: string | null
  devices: TrustedDevice[]
  /** A pairing link to show as a QR, while one is open. */
  pairing: { link: string; expiresAt: number } | null
  /** Devices that claimed a pairing and wait for Allow, with the code to compare. */
  waiting: { pairingId: string; name: string; code: string }[]
  inboxFolder: string | null
  /** Results of scheduled runs go to the phone and chat too. */
  scheduleResults: boolean
  keychain: boolean
}

export interface TelegramView {
  connected: boolean
  botName: string | null
  linked: { name: string } | null
  code: { code: string; expiresAt: number } | null
  problem: string | null
}

export interface SlackView {
  connected: boolean
  team: string | null
  linked: { name: string } | null
  code: { code: string; expiresAt: number } | null
  problem: string | null
  /** The app manifest to paste in Slack's "From a manifest". */
  manifest: string
}

/** Sync between laptops, as the window shows it (decisions §65). */
export interface SyncView {
  on: boolean
  /** joining: asking Convex; waiting: a laptop already in has to let this one in; in: syncing. */
  status: 'off' | 'joining' | 'waiting' | 'in'
  problem: string | null
  /** The laptops in, with the code this laptop shares with each (null for this one). */
  laptops: { id: string; name: string; me: boolean; code: string | null }[]
  /** Laptops asking to join that this one can let in. */
  waiting: { id: string; name: string; code: string }[]
  /** A key from a laptop this one hasn't checked a code with: confirm the code first. */
  confirm: { by: string; code: string } | null
  /** Conversations too long to send (more than 4 MB sealed). */
  tooLong: number
  lastSyncAt: number | null
  keychain: boolean
}
