import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SERVER_URL, TimelimitApi } from '../core/api.ts'
import { ParentConsoleError } from '../core/errors.ts'
import { Bff } from './server.ts'
import { BffStore } from './store.ts'
import { startSyncServer } from './sync-server.ts'

// @tag:parent-console

const DEFAULT_PORT = 5181
const DEFAULT_DATABASE = '/var/lib/timelimit-bff/sessions.db'

function openStore (path: string): BffStore {
  mkdirSync(dirname(path), { recursive: true })
  const store = new BffStore(path)
  // The file holds sync-server session tokens: nobody but the service user reads it.
  if (existsSync(path)) chmodSync(path, 0o600)
  return store
}

/** The sync server in this process listens on PORT, its own variable, and defaults to 8080. */
function ownSyncServerUrl (): string {
  const port = process.env.PORT ?? '8080'
  if (!/^\d+$/.test(port)) {
    throw new ParentConsoleError(
      `PORT=${port} is not a port number, so the address of the sync server in this process cannot be derived`,
      'set TIMELIMIT_SERVER to the address it listens on'
    )
  }
  return `http://127.0.0.1:${port}`
}

async function main (): Promise<void> {
  const databasePath = process.env.TIMELIMIT_BFF_DATABASE ?? DEFAULT_DATABASE
  const port = Number(process.env.TIMELIMIT_BFF_PORT ?? DEFAULT_PORT)
  const host = process.env.TIMELIMIT_BFF_HOST ?? '127.0.0.1'
  const serverEntry = process.env.TIMELIMIT_SERVER_ENTRY?.trim()
  // Merged run without TIMELIMIT_SERVER means the server next door, never the public default:
  // the built-in default is somebody else's live server, and talking to it here would look
  // like normal work.
  const serverUrl = process.env.TIMELIMIT_SERVER ?? (serverEntry ? ownSyncServerUrl() : DEFAULT_SERVER_URL)

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`TIMELIMIT_BFF_PORT must be a port number, got ${process.env.TIMELIMIT_BFF_PORT}`)
  }

  if (serverEntry) await startSyncServer({ entry: serverEntry, serverUrl })

  const bff = new Bff({ store: openStore(databasePath), api: new TimelimitApi({ serverUrl }) })
  await bff.listen(port, host)
  console.log(`timelimit-bff: ${host}:${port}/api/ -> ${serverUrl}${serverEntry ? ' (sync server in this process)' : ''}, sessions in ${databasePath}`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void bff.close().then(() => process.exit(0)) })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  if (error instanceof ParentConsoleError && error.hint) console.error(error.hint)
  process.exit(1)
})
