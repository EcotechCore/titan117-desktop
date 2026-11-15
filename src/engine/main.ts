/**
 * The engine process (architecture §3): started by the Electron shell as a
 * utility process, separate from the window, so a crashing tool doesn't take
 * the interface down. It talks to the shell only to say where its local API
 * listens and to learn which folders the user picked in the folder dialog.
 */
import { startEngine, type AccountState, type Engine } from './lib/engine'

type FromShell =
  | { type: 'addFolder'; path: string }
  | { type: 'removeFolder'; path: string }
  | { type: 'account'; account: AccountState }
  | { type: 'shutdown' }

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`The engine needs ${name}.`)
  return value
}

async function main(): Promise<void> {
  const dataDir = env('TITAN117_DATA_DIR')
  const engine: Engine = await startEngine({
    dataDir,
    appVersion: env('TITAN117_VERSION'),
    coreDirs: [dataDir, env('TITAN117_APP_DIR')],
    allowedOrigins: JSON.parse(env('TITAN117_ORIGINS')) as string[],
    openRouterKey: process.env['OPENROUTER_API_KEY'] ?? null
  })

  // Error capture (feature 19.1): nothing fails silently.
  process.on('uncaughtException', (error) => {
    engine.parts.log.capture('engine', error)
  })
  process.on('unhandledRejection', (reason) => {
    engine.parts.log.capture('engine', reason)
  })

  process.parentPort.on('message', ({ data }: { data: FromShell }) => {
    try {
      if (data.type === 'addFolder') engine.addFolder(data.path)
      else if (data.type === 'removeFolder') engine.removeFolder(data.path)
      else if (data.type === 'account') engine.setAccount(data.account)
      else if (data.type === 'shutdown') void engine.close().finally(() => process.exit(0))
    } catch (error) {
      engine.parts.log.capture('engine', error, { message: data.type })
    }
  })

  process.parentPort.postMessage({ type: 'ready', port: engine.port, token: engine.token })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
