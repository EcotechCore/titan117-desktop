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
  keychain: boolean
}

export interface TelegramView {
  connected: boolean
  botName: string | null
  linked: { name: string } | null
  code: { code: string; expiresAt: number } | null
  problem: string | null
}
