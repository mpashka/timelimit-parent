import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SERVER_URL, TimelimitApi } from '../core/api.ts'
import { Bff } from './server.ts'
import { BffStore } from './store.ts'

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

async function main (): Promise<void> {
  const databasePath = process.env.TIMELIMIT_BFF_DATABASE ?? DEFAULT_DATABASE
  const port = Number(process.env.TIMELIMIT_BFF_PORT ?? DEFAULT_PORT)
  const serverUrl = process.env.TIMELIMIT_SERVER ?? DEFAULT_SERVER_URL
  const host = process.env.TIMELIMIT_BFF_HOST ?? '127.0.0.1'

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`TIMELIMIT_BFF_PORT must be a port number, got ${process.env.TIMELIMIT_BFF_PORT}`)
  }

  const bff = new Bff({ store: openStore(databasePath), api: new TimelimitApi({ serverUrl }) })
  await bff.listen(port, host)
  console.log(`timelimit-bff: ${host}:${port}/api/ -> ${serverUrl}, sessions in ${databasePath}`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void bff.close().then(() => process.exit(0)) })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
