/**
 * Remote control's protocol (decisions §64; security.md A1, A2): the commands
 * a paired browser, phone or chat channel may send to a laptop, the events a
 * laptop sends back, and how both are sealed end to end.
 *
 * Sealing uses only Web Crypto (X25519, HKDF-SHA-256, AES-256-GCM), which the
 * browser, Node and Convex all have, so one implementation serves every side
 * and a browser's private key can stay non-extractable. Convex never seals or
 * opens anything: it routes ciphertext.
 *
 * The desktop repo keeps a byte-identical copy (src/shared/remote-protocol.ts);
 * the test vectors in remote.test.ts are checked on both sides.
 */

export const REMOTE_PROTOCOL_VERSION = 1;

/** A command waits this long for an offline laptop, then expires (decisions §64.9). */
export const REMOTE_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
/** Sealed size limit for one message, below Convex's 1 MB document limit. */
export const REMOTE_MAX_SEALED_BYTES = 700 * 1024;
/** A file sent with "add a file" (decisions §64.7), inside one message for now. */
export const REMOTE_MAX_FILE_BYTES = 512 * 1024;
/** Pairing links live five minutes and are used once (decisions §64.6). */
export const PAIRING_TTL_MS = 5 * 60 * 1000;
/** Switching on, pairing and remote laptop-only answers need a second factor this fresh (decisions §64.4). */
export const SECOND_FACTOR_MAX_MINUTES = 10;
/** A proof of a fresh second factor for one remote answer lives this long (decisions §65.7). */
export const SECOND_FACTOR_PROOF_TTL_MS = 5 * 60 * 1000;
/**
 * Signed before a proof's body, so a proof can never pass for a lease and a
 * lease never for a proof (both are signed with the lease key).
 */
export const SECOND_FACTOR_PROOF_PREFIX = "titan117 second-factor|";
/** Sync between laptops (decisions §65.6): one sealed package at most. */
export const SYNC_MAX_PACKAGE_BYTES = 8_000_000;

/**
 * What Convex signs after checking a fresh second factor (decisions §65.7):
 * one answer, from one paired device, to one approval, for five minutes.
 */
export interface SecondFactorProof {
  v: 1;
  kind: "second-factor";
  /** The account (Convex user id), as in the lease's `sub`. */
  sub: string;
  /** The paired device's public key that may send this answer. */
  key: string;
  approval: string;
  iat: number;
  exp: number;
}

// ------------------------------------------------------------------ commands

/**
 * Everything a remote device can ask a laptop (decisions §64.7, guardrails §9:
 * the web and phone send every type a chat channel can). Unknown types are
 * refused by `parseCommand`.
 */
export const REMOTE_COMMAND_TYPES = [
  "task.start",
  "task.list",
  "task.get",
  "approval.answer",
  "task.cancel",
  "file.add",
] as const;
export type RemoteCommandType = (typeof REMOTE_COMMAND_TYPES)[number];

export type RemoteCommand =
  | { type: "task.start"; text: string; agent?: string }
  | { type: "task.list" }
  | { type: "task.get"; taskId: string }
  | {
      type: "approval.answer";
      approvalId: string;
      answer: "approve" | "deny";
      /** Convex's signed proof of a fresh second factor, for a laptop-only approval (decisions §65.7). */
      proof?: string;
    }
  | { type: "task.cancel"; taskId: string }
  | { type: "file.add"; name: string; data: string };

/** Every command travels in this envelope, inside the sealed part. */
export interface RemoteCommandEnvelope {
  v: typeof REMOTE_PROTOCOL_VERSION;
  /** Unique per command; the laptop refuses one it has seen (no replays). */
  id: string;
  /** Milliseconds; the laptop refuses an expired command. */
  sentAt: number;
  expiresAt: number;
  command: RemoteCommand;
}

const isStr = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
/** A signed proof: base64url body, a dot, base64url signature. */
const PROOF = /^[A-Za-z0-9_-]{10,1500}\.[A-Za-z0-9_-]{60,120}$/;

/** A file name that can't leave its folder: no separators, no dots in front, no reserved characters. */
export function safeFileName(name: string): string | null {
  const clean = [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(ch))
    .join("")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 120);
  return clean.length > 0 ? clean : null;
}

/** Checks a decrypted command against its schema; null for anything else. */
export function parseCommand(value: unknown): RemoteCommand | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  switch (c.type) {
    case "task.start":
      if (!isStr(c.text, 20_000)) return null;
      if (c.agent !== undefined && !(typeof c.agent === "string" && ID.test(c.agent))) return null;
      return c.agent === undefined ? { type: "task.start", text: c.text } : { type: "task.start", text: c.text, agent: c.agent };
    case "task.list":
      return { type: "task.list" };
    case "task.get":
    case "task.cancel":
      return typeof c.taskId === "string" && ID.test(c.taskId) ? { type: c.type, taskId: c.taskId } : null;
    case "approval.answer":
      if (!(typeof c.approvalId === "string" && ID.test(c.approvalId))) return null;
      if (c.answer !== "approve" && c.answer !== "deny") return null;
      if (c.proof !== undefined && !(typeof c.proof === "string" && PROOF.test(c.proof))) return null;
      return c.proof === undefined
        ? { type: "approval.answer", approvalId: c.approvalId, answer: c.answer }
        : { type: "approval.answer", approvalId: c.approvalId, answer: c.answer, proof: c.proof };
    case "file.add": {
      if (!isStr(c.name, 200) || typeof c.data !== "string") return null;
      const name = safeFileName(c.name);
      // base64 of at most REMOTE_MAX_FILE_BYTES
      if (!name || c.data.length > Math.ceil(REMOTE_MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(c.data)) return null;
      return { type: "file.add", name, data: c.data };
    }
    default:
      return null;
  }
}

export function parseCommandEnvelope(value: unknown, now: number): RemoteCommandEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (e.v !== REMOTE_PROTOCOL_VERSION || typeof e.id !== "string" || !ID.test(e.id)) return null;
  if (typeof e.sentAt !== "number" || typeof e.expiresAt !== "number") return null;
  if (e.expiresAt <= now || e.expiresAt - e.sentAt > REMOTE_MESSAGE_TTL_MS) return null;
  const command = parseCommand(e.command);
  return command ? { v: REMOTE_PROTOCOL_VERSION, id: e.id, sentAt: e.sentAt, expiresAt: e.expiresAt, command } : null;
}

// ------------------------------------------------------------------ events

/** A task as remote devices see it: enough to list, watch and answer. */
export interface RemoteTask {
  id: string;
  title: string;
  status: string;
  agent: string | null;
  updatedAt: number;
  /** Where it was started: "laptop", or the remote device's name. */
  startedFrom: string | null;
  /** The last answer or step in a line, for lists and notifications. */
  lastLine: string | null;
}

export interface RemoteApproval {
  id: string;
  taskId: string;
  tool: string;
  summary: string;
  /** Can only be answered on the laptop (guardrails §9), unless `secondFactor` says otherwise. */
  laptopOnly: boolean;
  /**
   * A laptop-only approval whose category the user lets be answered remotely
   * with a fresh second factor (decisions §65.7): the answer must carry a proof.
   */
  secondFactor?: boolean;
}

export interface RemoteStep {
  at: number;
  kind: string;
  text: string;
}

/** What a laptop sends back, sealed to each paired device. */
export type RemoteEvent =
  | { type: "state"; laptop: string; tasks: RemoteTask[]; approvals: RemoteApproval[] }
  | { type: "task"; task: RemoteTask; steps: RemoteStep[]; result: string | null; approvals: RemoteApproval[] }
  | { type: "done"; commandId: string; ok: true; taskId?: string }
  | { type: "done"; commandId: string; ok: false; error: string }
  | { type: "alert"; text: string }
  /** A ready post whose time has come, for the phone's share sheet (decisions §64.13, §62.5). */
  | {
      type: "share";
      postId: string;
      platform: string;
      text: string;
      files: { name: string; type: string; data: string }[];
      /** Media too large to send, by name: they stay on the laptop. */
      left: string[];
    };

export interface RemoteEventEnvelope {
  v: typeof REMOTE_PROTOCOL_VERSION;
  id: string;
  sentAt: number;
  event: RemoteEvent;
}

// ------------------------------------------------------------------ encoding

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A public key on the wire: 32 bytes, base64url, 43 characters. */
export const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ------------------------------------------------------------------ keys

const X25519 = { name: "X25519" } as const;

/** A new device key pair. In a browser pass `extractable: false` and keep the CryptoKeys in IndexedDB. */
export async function generateDeviceKey(extractable: boolean): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey(X25519, extractable, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) };
}

export async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) throw new Error("Not a public key.");
  return crypto.subtle.importKey("raw", fromBase64Url(publicKey) as BufferSource, X25519, true, []);
}

const PKCS8_X25519_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

/** A laptop keeps its private key as 32 bytes in the OS keychain and imports it non-extractable to use it. */
export async function importPrivateKey(raw32: Uint8Array): Promise<CryptoKey> {
  if (raw32.length !== 32) throw new Error("Not a private key.");
  return crypto.subtle.importKey("pkcs8", concat(PKCS8_X25519_PREFIX, raw32) as BufferSource, X25519, false, ["deriveBits"]);
}

export async function exportPrivateKey(key: CryptoKey): Promise<Uint8Array> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key));
  return pkcs8.slice(pkcs8.length - 32);
}

export async function publicKeyOf(privateRaw32: Uint8Array): Promise<string> {
  // Web Crypto can't derive a public key from a private one directly; JWK export of the pair can.
  const key = await crypto.subtle.importKey("pkcs8", concat(PKCS8_X25519_PREFIX, privateRaw32) as BufferSource, X25519, true, ["deriveBits"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.x) throw new Error("No public key.");
  return jwk.x;
}

async function dh(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256));
}

// ------------------------------------------------------------------ sealing

/**
 * Routing fields Convex sees. They are the authenticated data of every sealed
 * message, so changing one (another recipient, an older version) makes it
 * impossible to open.
 */
export interface SealHeader {
  v: typeof REMOTE_PROTOCOL_VERSION;
  /** Sender's and recipient's public keys (their ids on the wire are these keys). */
  from: string;
  to: string;
  /** "sync": the account's sync key sealed to a laptop joining sync (decisions §65.4). */
  kind: "command" | "event" | "key" | "sync";
  /** Unique message id. */
  id: string;
}

const INFO = enc.encode("titan117 remote v1");
const PAD = 1024;

function headerBytes(h: SealHeader): Uint8Array {
  return enc.encode(`${h.v}|${h.from}|${h.to}|${h.kind}|${h.id}`);
}

async function messageKey(
  ephemeralShared: Uint8Array,
  staticShared: Uint8Array,
  ephemeralPublic: Uint8Array,
  h: SealHeader,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", concat(ephemeralShared, staticShared) as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(ephemeralPublic, headerBytes(h)) as BufferSource, info: INFO as BufferSource },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seals `payload` from the sender's key to the recipient's (decisions §64.3):
 * a fresh X25519 key per message, AES-256-GCM under HKDF over both
 * Diffie-Hellman results, so only the recipient can open it and it proves
 * which paired key wrote it. Padded to a multiple of 1 KB.
 *
 * Wire form: base64url(ephemeral public 32 ‖ iv 12 ‖ ciphertext with tag).
 * `testOnly` fixes the random parts for the cross-repo test vectors.
 */
export async function seal(
  header: SealHeader,
  payload: unknown,
  senderPrivate: CryptoKey,
  testOnly?: { ephemeral: CryptoKey; ephemeralPublic: string; iv: Uint8Array },
): Promise<string> {
  const recipient = await importPublicKey(header.to);
  const eph = testOnly
    ? { privateKey: testOnly.ephemeral, publicKey: testOnly.ephemeralPublic }
    : await generateDeviceKey(false);
  const ephPublic = fromBase64Url(eph.publicKey);
  const key = await messageKey(await dh(eph.privateKey, recipient), await dh(senderPrivate, recipient), ephPublic, header);

  const body = enc.encode(JSON.stringify(payload));
  const padded = new Uint8Array(Math.ceil((body.length + 4) / PAD) * PAD);
  new DataView(padded.buffer).setUint32(0, body.length);
  padded.set(body, 4);

  const iv = testOnly?.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: headerBytes(header) as BufferSource }, key, padded as BufferSource),
  );
  return toBase64Url(concat(ephPublic, iv, ct));
}

/** Opens a sealed message addressed to `recipientPrivate`; null when it was changed, misrouted or not from `header.from`. */
export async function open(header: SealHeader, sealed: string, recipientPrivate: CryptoKey): Promise<unknown> {
  try {
    const bytes = fromBase64Url(sealed);
    if (bytes.length < 32 + 12 + 16 + PAD) return null;
    const ephPublic = bytes.slice(0, 32);
    const iv = bytes.slice(32, 44);
    const ct = bytes.slice(44);
    const eph = await importPublicKey(toBase64Url(ephPublic));
    const sender = await importPublicKey(header.from);
    const key = await messageKey(await dh(recipientPrivate, eph), await dh(recipientPrivate, sender), ephPublic, header);
    const padded = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: headerBytes(header) as BufferSource }, key, ct as BufferSource),
    );
    const length = new DataView(padded.buffer).getUint32(0);
    if (length > padded.length - 4) return null;
    return JSON.parse(dec.decode(padded.slice(4, 4 + length)));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ pairing

/** Letters and digits without look-alikes (no 0/O, 1/I/L). */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * The 6-character code both screens show while pairing (decisions §64.6):
 * from SHA-256 of both public keys, laptop first, so a server that swapped a
 * key in the middle would show a different code. Written "7KQ-M4P".
 */
export async function pairingCode(laptopPublicKey: string, devicePublicKey: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(`titan117 pairing|${laptopPublicKey}|${devicePublicKey}`) as BufferSource),
  );
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[digest[i]! % CODE_ALPHABET.length];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** A random message or command id. */
export function randomId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function sealedByteLength(sealed: string): number {
  return Math.floor((sealed.length * 3) / 4);
}

