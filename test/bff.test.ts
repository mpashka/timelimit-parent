import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { TimelimitApi } from '../src/core/api.ts'
import { Bff } from '../src/bff/server.ts'
import { BffStore } from '../src/bff/store.ts'
import { fullStatus, moscow } from './helpers.ts'

interface Call { path: string, body: any }

function fakeServer ({ unreachable = false } = {}) {
  const calls: Call[] = []
  let broken = unreachable
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const body = JSON.parse(String(init.body))
    calls.push({ path, body })
    if (broken) throw new TypeError('fetch failed')
    if (path === '/session/sign-in') return Response.json({ sessionToken: 's:' + 'a'.repeat(32), sessionId: 'sess01', familyId: 'fam1', userId: 'parnt1' })
    if (path === '/sync/pull-status') return Response.json(body.status.users === '' ? fullStatus() : { apiLevel: 11, fullVersion: 1 })
    if (path === '/sync/push-actions') return Response.json({ shouldDoFullSync: false })
    return Response.json({})
  }) as typeof fetch
  return { calls, api: new TimelimitApi({ serverUrl: 'https://server.test', fetchImpl }), break: (value: boolean) => { broken = value } }
}

async function startBff (server: ReturnType<typeof fakeServer>) {
  const store = new BffStore(join(mkdtempSync(join(tmpdir(), 'tlp-bff-')), 'sessions.db'))
  let clock = moscow(14, 12)
  const bff = new Bff({ store, api: server.api, now: () => clock })
  await bff.listen(0)
  const { port } = bff.server.address() as { port: number }
  let cookie = ''
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return { status: response.status, body: await response.json() as any }
  }
  return { bff, call, advance: (ms: number) => { clock += ms } }
}

test('a signed-in browser gets a ready-made view and never sees the session token', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())

  const signIn = await call('/signin/session', { mailAuthToken: 'mail-token' })
  assert.equal(signIn.status, 200)
  assert.deepEqual(signIn.body, { userId: 'parnt1', familyId: 'fam1' })
  assert.equal(JSON.stringify(signIn.body).includes('s:'), false)

  const view = await call('/view/now?child=child1')
  assert.equal(view.status, 200)
  assert.equal(view.body.data.child.name, 'Алиса')
  assert.ok(Array.isArray(view.body.data.categories))
  assert.equal(view.body.staleSince, undefined)

  const pulled = server.calls.filter((c) => c.path === '/sync/pull-status')
  assert.ok(pulled.length > 0)
  assert.ok(pulled.every((c) => c.body.deviceAuthToken.startsWith('s:')), 'the BFF presents the session token, not a device token')
})

test('an intent turns into protocol actions and answers with the fresh view', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })

  const result = await call('/intent/grant?child=child1', { child: 'child1', category: 'Игры', minutes: 30, view: 'now' })
  assert.equal(result.status, 200)
  assert.ok(result.body.data.categories.length > 0, 'the intent answers with the screen, not with "accepted"')

  const pushed = server.calls.find((c) => c.path === '/sync/push-actions')
  assert.ok(pushed, 'the intent reached the sync server')
  const actions = pushed.body.actions.map((item: any) => JSON.parse(item.encodedAction).type)
  assert.ok(actions.includes('INCREMENT_CATEGORY_EXTRATIME'), `unexpected actions: ${actions.join(', ')}`)
  assert.equal(pushed.body.actions[0].userId, 'parnt1')
})

test('no session means session-gone, not a bare 401', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())

  const view = await call('/view/now')
  assert.equal(view.status, 401)
  assert.equal(view.body.error.kind, 'session-gone')
  assert.equal(view.body.error.signInAgain, true)
})

test('an unknown intent is told what the known ones are', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })

  const result = await call('/intent/make-tea', { child: 'child1' })
  assert.equal(result.status, 500)
  assert.match(result.body.error.hint, /known intents:/)
})

test('a silent sync server gives the last known view, marked stale', async () => {
  const server = fakeServer()
  const { bff, call, advance } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })
  await call('/view/now?child=child1')

  server.break(true)
  advance(60_000)
  const stale = await call('/view/bans?child=child1')
  assert.equal(stale.status, 200, 'the last known state is still usable')
  assert.equal(typeof stale.body.staleSince, 'number', 'and it says so instead of pretending to be fresh')
})
