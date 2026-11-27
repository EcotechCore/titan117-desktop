/** What the window sees of remote control and the chat channels (decisions §64). Never a key or a token. */
import type { TeamRole } from './team-roles'

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

/** Teams on this laptop (decisions §68; main/lib/team-sync.ts). */
export interface TeamBrandView {
  name: string
  accent: string
  hideMadeWith: boolean
  logoUrl: string | null
}

export interface TeamView {
  id: string
  name: string
  role: TeamRole
  /** The owner's plan covers this person. */
  active: boolean
  on: boolean
  status: 'off' | 'joining' | 'waiting' | 'in'
  problem: string | null
  laptops: {
    id: string
    name: string
    person: string
    role: TeamRole | null
    me: boolean
    code: string | null
  }[]
  waiting: { id: string; name: string; person: string; code: string }[]
  confirm: { by: string; code: string } | null
  sharedAgents: string[]
  sharedApps: string[]
  /** Apps whose source this person shared with the team. */
  sharedAppCode: string[]
  /** What the team shared, opened from the audit log's sealed notes (owners and admins). */
  activity: { at: number; who: string; action: string; what: string }[]
  inbox: {
    id: string
    /** An agent to add, or a sidebar app's source to copy into a folder (decisions §68.13). */
    type: 'agent' | 'app'
    name: string
    /** For an app: its id, the folder name it keeps so its records match the team's. */
    appId?: string
    /** For an app: what its data asks to read and change, and whether it asks the AI model. */
    asks?: { reads: string[]; writes: string[]; ai: boolean }
    from: string
    role: TeamRole
    at: number
    update: boolean
  }[]
  lastSyncAt: number | null
}

export interface TeamsView {
  signedIn: boolean
  keychain: boolean
  problem: string | null
  brand: TeamBrandView | null
  teams: TeamView[]
}
