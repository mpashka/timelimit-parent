import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ParentConsoleError } from '../src/core/errors.ts'
import { startSyncServer } from '../src/bff/sync-server.ts'

// @tag:parent-console

const failed = async (run: Promise<unknown>): Promise<ParentConsoleError> => {
  const error = await run.then(() => undefined, (ex: unknown) => ex)
  assert.ok(error instanceof ParentConsoleError, `expected a ParentConsoleError, got ${String(error)}`)
  return error
}

test('a missing server entry names the path and what to do instead', async () => {
  const error = await failed(startSyncServer({
    entry: 'no/such/build/index.js',
    serverUrl: 'http://127.0.0.1:8080',
    load: () => assert.fail('nothing may be imported when the file is not there')
  }))
  assert.match(error.message, /no[/\\]such[/\\]build[/\\]index\.js/)
  assert.match(error.hint ?? '', /npm run build/)
  assert.match(error.hint ?? '', /unset TIMELIMIT_SERVER_ENTRY/)
})

test('the entry is imported and waited for until it answers its own API', async () => {
  const imported: string[] = []
  const asked: string[] = []
  await startSyncServer({
    entry: 'package.json',
    serverUrl: 'http://127.0.0.1:8080/',
    load: async (moduleUrl) => { imported.push(moduleUrl) },
    probe: async (url) => { asked.push(url); return asked.length > 2 }
  })
  assert.equal(imported.length, 1)
  assert.match(imported[0], /^file:\/\/.*package\.json$/)
  assert.deepEqual(new Set(asked), new Set(['http://127.0.0.1:8080/time']))
  assert.equal(asked.length, 3)
})

test('a server that never answers fails by name, not by hanging', async () => {
  const error = await failed(startSyncServer({
    entry: 'package.json',
    serverUrl: 'http://127.0.0.1:8080',
    timeoutMs: 0,
    load: async () => undefined,
    probe: async () => false
  }))
  assert.match(error.message, /http:\/\/127\.0\.0\.1:8080\/time/)
  assert.match(error.hint ?? '', /DATABASE_URL/)
})
