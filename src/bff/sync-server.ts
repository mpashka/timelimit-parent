import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ParentConsoleError } from '../core/errors.ts'

// @tag:parent-console

const READY_TIMEOUT_MS = 120_000
const PROBE_INTERVAL_MS = 250

export interface SyncServerOptions {
  entry: string
  serverUrl: string
  timeoutMs?: number
  load?: (moduleUrl: string) => Promise<unknown>
  probe?: (url: string) => Promise<boolean>
}

/**
 * Runs the sync server in this process and returns once it answers its own API.
 *
 * The whole tie to it is that importing its built entry file starts it: that file ends with
 * `main().catch(...)`. No function of the server is called — the BFF keeps talking to it over
 * HTTP, now through the loopback into itself.
 */
export async function startSyncServer ({
  entry,
  serverUrl,
  timeoutMs = READY_TIMEOUT_MS,
  load = async (moduleUrl) => await import(moduleUrl),
  probe = answers
}: SyncServerOptions): Promise<void> {
  const path = resolve(entry)
  if (!existsSync(path)) {
    throw new ParentConsoleError(
      `TIMELIMIT_SERVER_ENTRY names ${path}, and there is no such file`,
      'it has to be the built entry of a timelimit-server checkout — <clone>/build/index.js, made there by `npm install && npm run build`; unset TIMELIMIT_SERVER_ENTRY to run the BFF alone against a sync server that is already running'
    )
  }

  await load(pathToFileURL(path).href)

  // The entry starts the server without awaiting it, so the import returns long before migrations,
  // workers and the HTTP port are up. `/time` is the server's own API and the same thing the
  // deploy checks; its "ready" line is only a log, and it is printed before the port is bound.
  const timeUrl = serverUrl.replace(/\/+$/, '') + '/time'
  const deadline = Date.now() + timeoutMs
  while (!await probe(timeUrl)) {
    if (Date.now() > deadline) {
      throw new ParentConsoleError(
        `the sync server started from ${path} did not answer ${timeUrl} within ${Math.round(timeoutMs / 1000)} s`,
        'its own output above says why; the usual causes are a database it cannot reach (DATABASE_URL) and a PORT that does not match TIMELIMIT_SERVER'
      )
    }
    await new Promise((wake) => setTimeout(wake, PROBE_INTERVAL_MS))
  }
}

async function answers (url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    await response.text()
    return response.ok
  } catch {
    return false
  }
}
