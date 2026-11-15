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

declare global {
  interface Window {
    titan117: {
      versions: { electron: string; chrome: string; node: string }
      /** Where the engine's local API listens, and the per-install token. */
      engine(): Promise<{ url: string; token: string }>
      /** Opens the folder dialog; true when the user allowed a folder. */
      addFolder(): Promise<boolean>
      removeFolder(path: string): Promise<boolean>
      onEngineRestart(listener: () => void): void
      /** The user's own API keys. A key goes in once and never comes back to the page. */
      keys: {
        saved(): Promise<Record<'openrouter' | 'anthropic' | 'openai' | 'google', boolean>>
        save(provider: string, key: string): Promise<{ ok: true } | { ok: false; problem: string }>
        remove(provider: string): Promise<boolean>
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
