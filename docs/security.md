# Security

7 Nov 2026. Titan117's threat model and security rules, in two parts: **protecting our users** (their data, laptop and account) and **protecting us** (our money, product and infrastructure). The enforceable rules, each with what enforces it, are in [guardrails.md](guardrails.md); the decisions behind this page are in [decisions §23](notes/decisions.md#23-security-model).

**Principle:** safe by default, and as easy as possible. Every protection that adds a step has to earn it; most of them are invisible.

---

## Part A · Protecting our users

What an attacker could want from a Titan117 user: their files and documents, their accounts and API keys, their money (payments, ad accounts), or their laptop itself (to run commands). Titan117 is attractive because its agents can act on the computer, so the app must never become a way in.

### A1. Account takeover and remote control

Remote control means a task started on the web, the phone or in chat runs on the user's laptop. If someone takes over the account (a reused password, phishing), that would be "run code on my laptop from the internet". So:

| Rule | How it stays easy |
|---|---|
| **Remote control is off by default**, switched on per laptop, in the desktop app | One toggle in Settings and in the setup checklist; it explains in one line what it does |
| **Two-factor sign-in is required to switch it on** (Clerk MFA) | The toggle opens Clerk's setup right there; a **passkey** (fingerprint, face or phone) is suggested first, an authenticator app second. Done once |
| **Pairing is confirmed on the laptop's screen** | Scan the QR in the web or phone app; the laptop shows the same 6-character code and "Allow this device?" |
| **A few approvals are laptop-only**: deleting files, payments and purchases, sending files or data out of the laptop, installing add-ons or marketplace items, changing allowed folders or permissions, pairing devices | Everything else can be approved anywhere. A laptop-only approval waits with a notification; the user can also switch a category to "approve remotely after a second factor" (Clerk re-verification, one tap with a passkey) |
| **Alerts on every remote task**: a notification on the laptop and the user's other devices ("Task started from Chrome on Windows") | Quiet, not a modal; grouped when several run |
| **Revoke all devices** in one click, from the web app, the desktop app, or the link in the alert email | Signs out every web and phone session and unpairs every device; the laptop keeps working locally |

**Web app and phone app can do everything chat can do** (and more): start a task, watch its steps, answer approvals, cancel, read the result summary, add a file. Chat channels are a convenience, never the only way.

### A2. Messages between devices: end-to-end encryption (V1)

Requests, step summaries and results travel between the user's devices and their laptop through our cloud (Convex). They're encrypted end to end so **only the user's own devices can read them**: not us, not someone who breaks into our database.

- **Keys:** every device (each laptop, each browser, each phone) has its own key pair, made on the device. Private keys never leave it: the OS keychain on desktop and phone, a non-extractable key in the browser.
- **Pairing:** the new device and the laptop swap public keys through Convex; the user confirms the matching 6-character code on the laptop (A1), so a server in the middle can't swap in its own key.
- **Messages:** a command is encrypted to the target laptop's key; events and results to every paired device of the account. Library: libsodium (ISC), X25519 key exchange with XChaCha20-Poly1305.
- **What our servers still see:** the minimum needed to route and limit, never content: which device, the command type, times, sizes and status.
- **Removing a device:** its key is dropped from the account; the laptop rotates its own key and re-shares it with the remaining devices, so the removed device can't read anything new. "Revoke all devices" does this for all of them.
- **A browser that loses its storage** (cleared data, private window) simply pairs again.
- **Not end-to-end:** chat channels. Telegram and WhatsApp carry messages through their own servers, so the app says so when a channel is linked ("Messages here are visible to Telegram").

### A3. Agents and browsing: no quiet data leaks

A tricked agent doesn't need to "send" anything; opening a web address with private data in it is enough. Approvals cover sending, posting and uploading; the network policy covers the rest. This follows how Claude Code, OpenAI Codex, Cursor and the browser agents handle it (site allow lists, asking before new sites, internet off unless needed).

- **Every task has a site list.** Tasks that don't need the internet get none. Tasks that do start from the sites they're about (the URL you gave, the tools' declared hosts); the user can allow more once or always.
- **New site after private data:** if a task has read the user's files, memory or a confidential folder and then wants a site it hasn't used, it **asks first** ("Open example.com? This task has read your files").
- **Requests carrying private content are blocked:** web addresses, form fields and uploads are checked for passages of the files, memory or secrets the task has seen; a match is blocked and shown to the user.
- **Content is data, never instructions** (guardrails §5): instructions found on pages are shown, not followed; the prompt-injection suite includes exfiltration attempts.
- Local-only tasks (documents, "local models only" folders) have no network at all.

### A4. Chat channels

- A channel is linked to an account with a **one-time code** from the desktop app; only that linked chat counts as the user.
- **Private chats only in V1.** No group chats, where other people's messages would reach the agent.
- Laptop-only approvals (A1) stay laptop-only in chat.
- The app shows linked channels with "Unlink", and unlinks them with "Revoke all devices".

- **The user's own bot** (decisions §28): bot tokens live in the laptop's keychain and the laptop connects to the platform directly; chat messages never pass through our servers. The platform itself (Telegram, Discord, Slack, Meta) can read them, which the setup card says.

### A5. The user's secrets and data

**What our cloud may hold is a closed list** (decisions §32): the Titan117 account (its password handled by Clerk, hashed), plan and credits, devices and public keys, end-to-end encrypted remote messages, the licence, reports the user sends and what they choose to share. Never the user's passwords, keys or tokens for any service, their files, memory, mail or app data; those stay on the laptop, secrets in the OS keychain. Sync and team sharing are end to end encrypted.

Already in the guardrails, summarised: API keys and passwords only in the OS keychain (§8); other vendors' logins never touched (§8, decisions §20); agents only in allowed folders, shell sandboxed, add-ons sandboxed (§4, §7); memory visible and deletable; error reports opt-in and shown in full (§12); account deletion removes everything we hold.

**GitHub:** agents act as the user, with the user's own git setup and a GitHub token the user grants (device flow, limited to the repos they pick, expires after 8 hours). The token stays in the laptop's keychain and never reaches our cloud; pushes and pull requests need approval (decisions §25).

---

## Part B · Protecting us

What an attacker could want from us: free cloud usage (credits), the paid product without paying, our keys (and the bills that come with them), our users through a fake update, or the data in our cloud and admin portal.

### B1. Credits can't be faked

- The **balance lives only on our server** (an append-only ledger in Convex). The app shows it, it can't change it.
- **Only the verified payment webhook adds credits** (Stripe signature, idempotent).
- **Every cloud call goes through our proxy**, which checks the session and the balance **before** forwarding, and deducts after; a call that would overspend stops. A modified app gets nothing extra.
- Per-user rate limits on the proxy; the proxy never logs prompts or answers.
- OpenRouter usage reconciled with our ledger daily; differences alert us.

### B2. No subscription, no paid features

- Everything that costs us money (credits, remote control, sync, sharing, publishing, web search) is **checked on the server on every call** against the subscription.
- **Offline**, the app runs on a **licence lease signed with our private key** (14 days, decisions §17); the app only holds the public key, so a lease can't be forged. It locks when the lease expires.
- **Device limits** (2, 3, 5) are enforced on the server when pairing and signing in.
- Card fraud and abuse: Stripe Radar on payments; refunds of top-ups only within 14 days.

### B3. Cracking the app

Someone can patch the desktop app to skip the licence check. That only unlocks the **local** features (local models, local tools): nothing that costs us money, because every cloud feature is checked server-side. We accept this (decisions §17) and don't spend effort on obfuscation.

### B4. Our keys and our bills

- **No secret in the app, ever.** Anything inside the installer is public.
- Server secrets (OpenRouter, Stripe, Clerk, Convex deploy keys, the licence signing key) only in Vercel and Convex environment variables, each used by as few functions as possible.
- **Hard spending caps:** a monthly limit on our OpenRouter account and on every paid provider, with alerts at 50% and 80%, so a leaked key can't run up an unlimited bill.
- Each key has a rotation procedure in the incident checklist (B8).

### B5. Releases and updates (our development process)

A stolen signing certificate or a compromised build could push malware to **every** user as an official update. The rules (guardrails §13):

- The code-signing key lives in a **cloud signing service** (Azure Trusted Signing for Windows; Apple's Developer ID through the notarization service), never as a file on a laptop.
- **Updates are signed twice**: by the platform certificate and by our own update key; the app pins our update key and refuses anything else.
- **Branch protection** on `main` in every repo: changes through pull requests with green CI; once there are two developers, a review from the other one.
- **GitHub Actions pinned to exact commits**; CI secrets scoped per job.
- **Publishing a release needs a second step**: a protected GitHub environment that asks a second person to approve, or, while you're alone, your own approval with two-factor.
- Two-factor on every account that can ship: GitHub, Apple, Microsoft, Vercel, Convex, Clerk, Stripe, the domain registrar.
- Staged rollouts, and a way to pull a bad update.

### B6. The product owner portal

Our own admin app, in its own repo (`titan117-pop`), separate from the user web app, at its own address (for example `admin.titan117.com`), for the product owner and employees: error reports (§22), accounts and plans, credits (corrections only as new ledger rows with a reason), kill switches for add-ons and coding-tool adapters (§20), releases.

- **Only named people**, admin role set from the Convex CLI, never from a screen.
- **Two-factor required** (a separate staff Clerk application with MFA required, and the portal refuses sessions without a second factor; decisions §36).
- **Every view and change is logged** (`adminAudit`: who, what, when), and the log can't be edited.
- Read-only by default; anything that changes a user's account asks for a reason.

### B7. Accepted risks (written down so nobody assumes otherwise)

- **Malware already on a user's laptop** sees what the user sees, including what Titan117 shows. We protect secrets with the OS keychain, but we can't protect a compromised computer.
- **A determined person can crack the licence check** and use local features without paying (B3).
- **Chat channels aren't end-to-end** (A2); Telegram and WhatsApp see those messages.
- **Users who approve a harmful action** after being shown what it does. We make approvals clear; the decision is theirs.
- **Vendors' terms change** for the coding tools users bring (decisions §20); each adapter has a kill switch.

### B8. When something goes wrong

**Reporting vulnerabilities:** `https://titan117.com/.well-known/security.txt` names `security@titan117.com`; we reply within 3 working days, fix critical issues first, and credit reporters who want it. A paid bug bounty can come after launch.

**Incident checklist** (kept short, rehearsed once before beta):

1. **Contain:** turn on the relevant kill switch, revoke sessions, pause updates.
2. **Rotate** whatever leaked:

   | Key | Where | How |
   |---|---|---|
   | OpenRouter key | Vercel / Convex env | New key, update env, revoke old; check the spending cap |
   | Stripe keys and webhook secret | Vercel / Convex env | Roll in the Stripe dashboard |
   | Clerk keys | Vercel / Convex env | Roll in the Clerk dashboard; consider signing everyone out |
   | Convex deploy key | CI secrets | Regenerate; review recent deploys |
   | Code-signing certificate | Cloud signing service | Revoke and re-issue; re-sign the current release |
   | Update signing key | Cloud key vault | Ship an app update that trusts the new key (signed with the old one before revoking it) |
   | Licence signing key | Convex env | New key pair; the app update carries the new public key; extend leases during the switch |

3. **Tell people:** affected users by email in plain words; under GDPR, the data protection authority within 72 hours if personal data was exposed.
4. **Write it up** in `progress.md`: what happened, what we changed so it can't happen again.

**External penetration test before the public beta** (phase 18): the desktop app, remote control and pairing, the Convex functions, the credit proxy and the owner portal. Critical and high findings fixed before beta.
