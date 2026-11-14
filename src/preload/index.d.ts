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
    }
  }
}

export {}
