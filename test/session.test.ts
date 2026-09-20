import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TimelimitApi } from '../src/core/api.ts'
import { ApiError, ParentConsoleError } from '../src/core/errors.ts'
import type { ParentAction } from '../src/core/protocol.ts'
import { MemoryStorage, SyncClient } from '../src/core/session.ts'
import { fullStatus } from './helpers.ts'

function fakeServer ({ rejectPush = false, status = 200 } = {}) {
  const calls: Array<{ path: string, body: any }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const body = JSON.parse(String(init.body))
    calls.push({ path, body })
    if (status !== 200) return new Response('Unauthorized', { status })
    if (path === '/sync/pull-status') return Response.json(body.status.users === '' ? fullStatus() : { apiLevel: 9, fullVersion: 1 })
    return Response.json({ shouldDoFullSync: rejectPush })
  }) as typeof fetch
  return { calls, api: new TimelimitApi({ serverUrl: 'https://server.test/', fetchImpl }) }
}

const grant: ParentAction = { type: 'INCREMENT_CATEGORY_EXTRATIME', categoryId: 'games1', addedExtraTime: 60000, day: 20710 }

test('pushed actions carry the parent of this device and strictly increasing persisted sequence numbers', async () => {
  const { api, calls } = fakeServer()
  const storage = new MemoryStorage()
  const session = new SyncClient({ api, subject: { kind: 'device', authToken: 'token', deviceId: 'devP01' }, storage, now: () => 5000 })
  const actions = Array.from({ length: 51 }, () => grant)
  const { pushed } = await session.push(actions)
  assert.equal(pushed, 51)
  const pushes = calls.filter((c) => c.path === '/sync/push-actions')
  assert.deepEqual(pushes.map((p) => p.body.actions.length), [50, 1])
  const items = pushes.flatMap((p) => p.body.actions)
  assert.deepEqual(items.slice(0, 2).map((i: any) => i.sequenceNumber), [5, 6])
  assert.equal(items[50].sequenceNumber, 55)
  assert.deepEqual({ ...items[0], sequenceNumber: 0 }, { encodedAction: JSON.stringify(grant), sequenceNumber: 0, integrity: 'device', type: 'parent', userId: 'parnt1' })
  assert.equal(await storage.get('sequenceNumber'), '55')
})

test('a flagged push re-pulls the full state and names what was not applied', async () => {
  const { api, calls } = fakeServer({ rejectPush: true })
  const session = new SyncClient({ api, subject: { kind: 'device', authToken: 'token', deviceId: 'devP01' }, storage: new MemoryStorage() })
  await assert.rejects(session.push([grant]), (ex: unknown) => ex instanceof ParentConsoleError && /rejected at least one of actions 1\.\.1/.test(ex.message))
  const lastPull = calls.filter((c) => c.path === '/sync/pull-status').at(-1)!
  assert.equal(lastPull.body.status.users, '')
})

test('HTTP errors name the endpoint, the status and what to do', async () => {
  const { api } = fakeServer({ status: 401 })
  const session = new SyncClient({ api, subject: { kind: 'device', authToken: 'bad' }, storage: new MemoryStorage() })
  await assert.rejects(session.sync(), (ex: unknown) => ex instanceof ApiError && ex.status === 401 &&
    ex.message === '/sync/pull-status: HTTP 401 — Unauthorized' && /login/.test(ex.hint ?? ''))
})
