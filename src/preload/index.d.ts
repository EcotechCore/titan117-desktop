import type { RemoteView, SlackView, TelegramView } from '../shared/remote-views'
export type { RemoteView, SlackView, TelegramView }
export interface AccountView {
  signedIn: boolean
  locked: boolean
  reason: 'signedOut' | 'noPlan' | 'expired' | null
  plan: 'starter' | 'pro' | 'max' | 'custom' | null
  expiresAt: number | null
  warn: boolean
  problem: string | null
  configured: boolean
  /** False only when running from source with no account set up. */
  enforced: boolean
}

interface GitHubSignInStatus {
  configured: boolean
  signedIn: boolean
  login: string | null
  pending: { userCode: string; verificationUri: string; expiresAt: number } | null
  problem: string | null
  /** How many repositories the app may use for this user; null when unknown (offline, signed out). */
  repositories: number | null
}

declare global {
  interface Window {
    titan117: {
      versions: { electron: string; chrome: string; node: string }
      /** Where the engine's local API listens, and the per-install token. */
      engine(): Promise<{ url: string; token: string }>
      /** Opens the folder dialog; true when the user allowed a folder. */
      addFolder(): Promise<boolean>
      removeFolder(path: string): Promise<boolean>
      /** Sign in with GitHub through our GitHub App (decisions §25); the token stays in the keychain. */
      github: {
        status(): Promise<GitHubSignInStatus>
        signIn(): Promise<GitHubSignInStatus>
        cancel(): Promise<GitHubSignInStatus>
        signOut(): Promise<GitHubSignInStatus>
        /** Opens GitHub's page to choose the repositories Titan may use. */
        install(): Promise<boolean>
        onChange(listener: () => void): void
      }
      /** Open a project in the user's editor (13.12); `folder` opens it in Explorer or Finder. */
      code: {
        editors(): Promise<{ id: string; name: string }[]>
        open(folder: string, editor: string): Promise<boolean>
      }
      /** Show a file in the system's file manager: only one inside the allowed folders. */
      files: {
        reveal(path: string): Promise<boolean>
      }
      onEngineRestart(listener: () => void): void
      /** Auto-update (1.10): its state, and installing a downloaded update. */
      updates: {
        state(): Promise<{ state: string; version?: string; why?: string; message?: string }>
        install(): Promise<boolean>
        onChange(
          listener: (state: {
            state: string
            version?: string
            why?: string
            message?: string
          }) => void
        ): void
      }
      /** A notification was clicked: open that task (1.9). */
      onOpenTask(listener: (taskId: string) => void): void
      /** The user's own API keys. A key goes in once and never comes back to the page. */
      keys: {
        saved(): Promise<
          Record<
            | 'openrouter'
            | 'anthropic'
            | 'openai'
            | 'google'
            | 'exa'
            | 'tavily'
            | 'brave'
            | 'cloudflare'
            | 'pagespeed'
            | 'brevo'
            | 'postmark',
            boolean
          >
        >
        save(provider: string, key: string): Promise<{ ok: true } | { ok: false; problem: string }>
        remove(provider: string): Promise<boolean>
      }
      /** Connector secrets (feature 3.6): they go into the keychain and never come back. */
      connectors: {
        setSecrets(
          id: string,
          secrets: Record<string, string>
        ): Promise<{ ok: true } | { ok: false; problem: string }>
        removeSecrets(id: string): Promise<boolean>
      }
      /** Saved site logins for recordings (8.5): a password goes in and never comes back. */
      logins: {
        saved(): Promise<{ site: string; username: string }[]>
        save(
          site: string,
          username: string,
          password: string
        ): Promise<{ ok: true } | { ok: false; problem: string }>
        remove(site: string): Promise<boolean>
      }
      /** Artifacts (§17): shown in a sandbox, printed and saved by the shell. */
      artifacts: {
        /** The sandboxed address to show a page at. */
        stage(html: string): Promise<string>
        /** Print to PDF and ask where to save; the path, or null if cancelled. */
        pdf(html: string, name: string, pageSize: 'A4' | 'Letter'): Promise<string | null>
        png(html: string, name: string): Promise<string | null>
        save(name: string, base64: string): Promise<string | null>
      }
      /** Remote control (decisions §64). Never a key. */
      remote: {
        status(): Promise<RemoteView>
        switchOn(): Promise<RemoteView>
        switchOff(): Promise<RemoteView>
        pair(): Promise<RemoteView>
        answerPairing(pairingId: string, accept: boolean): Promise<RemoteView>
        remove(publicKey: string): Promise<RemoteView>
        revokeAll(): Promise<RemoteView>
        setInbox(folder: string | null): Promise<RemoteView>
        setScheduleResults(on: boolean): Promise<RemoteView>
        onChange(listener: (view: RemoteView) => void): void
      }
      /** The user's own Slack app in Socket Mode (decisions §64.11). Tokens go in, never out. */
      slack: {
        status(): Promise<SlackView>
        connect(app: string, bot: string): Promise<{ ok: true } | { ok: false; message: string }>
        disconnect(): Promise<SlackView>
        link(): Promise<SlackView>
        unlink(): Promise<SlackView>
        onChange(listener: (view: SlackView) => void): void
      }
      /** The user's own Telegram bot (decisions §64.11). The token goes in, never out. */
      telegram: {
        status(): Promise<TelegramView>
        connect(token: string): Promise<{ ok: true } | { ok: false; message: string }>
        disconnect(): Promise<TelegramView>
        link(): Promise<TelegramView>
        unlink(): Promise<TelegramView>
        onChange(listener: (view: TelegramView) => void): void
      }
      /** The Titan117 account on this laptop (decisions §17, §39). Never the device token. */
      account: {
        status(): Promise<AccountView>
        signIn(): Promise<AccountView>
        cancelSignIn(): Promise<boolean>
        refresh(): Promise<AccountView>
        signOut(): Promise<AccountView>
        openPage(): Promise<boolean>
        onChange(listener: (view: AccountView) => void): void
      }
    }
  }
}

export {}
