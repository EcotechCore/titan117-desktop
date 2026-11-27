/**
 * Teams, roles, the audit log and white-label (feature map 11.6, 11.7;
 * decisions §68). Convex enforces every rule here on the server; the web app
 * and the desktop app use the same table to show only what a role may do.
 *
 * Our cloud sees that a team exists and who is in it, never what it shares
 * (decisions §32): agents, apps and their data travel end to end encrypted
 * under the team key, like sync between a user's own laptops (§65).
 *
 * The desktop repo keeps a byte-identical copy (src/shared/team-roles.ts).
 */

export const TEAM_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_ROLE_LABELS: Record<TeamRole, { name: string; what: string }> = {
  owner: { name: "Owner", what: "Pays for the team, sets the brand, and can do everything" },
  admin: { name: "Admin", what: "Invites and removes people, lets laptops in, sees the audit log" },
  member: { name: "Member", what: "Uses and shares agents and apps, and changes apps' data" },
  viewer: { name: "Viewer", what: "Uses shared agents and sees apps' data, without changing it" },
};

export const TEAM_ACTIONS = [
  "useItems",
  "writeData",
  "shareItems",
  "removeOthersItems",
  "invite",
  "removeMember",
  "setRole",
  "admitLaptop",
  "seeAudit",
  "setBrand",
  "manageTeam",
] as const;
export type TeamAction = (typeof TEAM_ACTIONS)[number];

const RANK: Record<TeamRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const NEEDS: Record<TeamAction, TeamRole> = {
  useItems: "viewer",
  writeData: "member",
  shareItems: "member",
  removeOthersItems: "admin",
  invite: "admin",
  removeMember: "admin",
  setRole: "admin",
  admitLaptop: "admin",
  seeAudit: "admin",
  setBrand: "owner",
  manageTeam: "owner",
};

/** Whether a role may do something at all. */
export function teamCan(role: TeamRole | null | undefined, action: TeamAction): boolean {
  return !!role && RANK[role] >= RANK[NEEDS[action]];
}

/**
 * Whether `actor` may give `target` the role `to` (or remove them, with
 * `to` null). Nobody changes the owner (ownership moves only by the owner's
 * own transfer); only the owner makes or unmakes admins; an admin manages
 * members and viewers.
 */
export function canChangeMember(actor: TeamRole, target: TeamRole, to: Exclude<TeamRole, "owner"> | null): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  if (actor !== "admin") return false;
  if (target === "admin") return false;
  return to === null || to === "member" || to === "viewer";
}

/** What may be invited: never a second owner, and an admin only by the owner. */
export function canInviteAs(actor: TeamRole, role: TeamRole): boolean {
  if (role === "owner") return false;
  if (role === "admin") return actor === "owner";
  return teamCan(actor, "invite");
}

/** The audit log's actions (decisions §68.4). Names of what is shared never appear here, only in the sealed note. */
export const TEAM_AUDIT_ACTIONS = [
  "team.created",
  "team.renamed",
  "team.deleted",
  "invite.created",
  "invite.revoked",
  "member.joined",
  "member.role",
  "member.removed",
  "member.left",
  "owner.transferred",
  "laptop.waiting",
  "laptop.admitted",
  "laptop.refused",
  "laptop.removed",
  "key.changed",
  "item.shared",
  "item.updated",
  "item.removed",
  "brand.changed",
  "upload.refused",
] as const;
export type TeamAuditAction = (typeof TEAM_AUDIT_ACTIONS)[number];

export const TEAM_AUDIT_LABELS: Record<TeamAuditAction, string> = {
  "team.created": "made the team",
  "team.renamed": "renamed the team",
  "team.deleted": "deleted the team",
  "invite.created": "made an invite",
  "invite.revoked": "cancelled an invite",
  "member.joined": "joined",
  "member.role": "changed a role",
  "member.removed": "removed someone",
  "member.left": "left the team",
  "owner.transferred": "handed the team over",
  "laptop.waiting": "asked to let a laptop in",
  "laptop.admitted": "let a laptop in",
  "laptop.refused": "refused a laptop",
  "laptop.removed": "removed a laptop",
  "key.changed": "changed the team key",
  "item.shared": "shared something",
  "item.updated": "updated something shared",
  "item.removed": "removed something shared",
  "brand.changed": "changed the brand",
  "upload.refused": "was refused a change their role doesn't allow",
};

/**
 * What a sealed team package holds, as its one routing field: `item` (an
 * agent or a sidebar app being shared, updated or removed) needs
 * `shareItems`; `data` (sidebar apps' records) needs `writeData`. The
 * receiving laptops check the sender's role again (it travels beside the
 * package), so a viewer's change is dropped even if a package got through.
 */
export const TEAM_PACKAGE_KINDS = ["item", "data"] as const;
export type TeamPackageKind = (typeof TEAM_PACKAGE_KINDS)[number];

export function actionForPackage(kind: TeamPackageKind): TeamAction {
  return kind === "item" ? "shareItems" : "writeData";
}

export const TEAM_LIMITS = {
  nameMax: 60,
  /** Invites last a week and are used once. */
  inviteDays: 7,
  openInvites: 20,
  /** Laptops per member in a team's key. */
  laptopsPerMember: 3,
  auditPage: 50,
} as const;

/** An invite link's code: 32 URL-safe characters (192 bits); we keep only its SHA-256. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function cleanTeamName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} &._()'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEAM_LIMITS.nameMax);
}

// ------------------------------------------------------------- white-label

/**
 * An agency's brand (11.7, decisions §68.7). It shows to the agency's clients:
 * on the pages they share and in their desktop app's header; the brand
 * rules themselves are the owner's to confirm (owner checklist).
 */
export interface TeamBrand {
  /** Shown instead of "Titan117" in the app's header and on shared pages. */
  name: string;
  /** Buttons and links: must read at 4.5:1 with white text and on white. */
  accent: string;
  /** "Made with Titan117" stays unless the owner's rules allow hiding it. */
  hideMadeWith: boolean;
}

export const BRAND_LOGO_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;
export const BRAND_LOGO_MAX_BYTES = 200_000;
const HEX = /^#[0-9a-f]{6}$/i;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Why a brand can't be saved, or null. White text on the accent must read (guardrails: design contrast). */
export function brandProblem(brand: TeamBrand): string | null {
  const name = cleanTeamName(brand.name);
  if (name.length < 2) return "Give the brand a name of at least two letters.";
  if (/titan\s*117/i.test(name)) return "The brand's name can't be Titan117's own.";
  if (!HEX.test(brand.accent)) return "The colour must look like #1a5fd0.";
  if (contrastRatio(brand.accent, "#ffffff") < 4.5) return "White text on this colour is hard to read; pick a darker one.";
  return null;
}
