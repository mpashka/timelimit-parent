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

function fakeServer ({ unreachable = false, role }: { unreachable?: boolean, role?: 'admin' | 'manager' | 'member' } = {}) {
  const calls: Call[] = []
  let broken = unreachable
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const body = JSON.parse(String(init.body))
    calls.push({ path, body })
    if (broken) throw new TypeError('fetch failed')
    if (path === '/parent/list-parent-invitations') return Response.json({ invitations: calls.some((c) => c.path === '/parent/invite-parent') ? [{ mail: 'mama@example.com', createdAt: 1 }] : [] })
    if (path === '/session/sign-in' || path === '/session/create-family' || path === '/session/accept-invitation') return Response.json({ sessionToken: 's:' + 'a'.repeat(32), sessionId: 'sess01', familyId: 'fam1', userId: 'parnt1' })
    if (path === '/sync/pull-status') return Response.json(body.status.users === '' ? withRole(fullStatus(), role) : { apiLevel: 11, fullVersion: 1 })
    if (path === '/sync/push-actions') return Response.json({ shouldDoFullSync: false })
    if (path === '/auth/sign-in-by-google') return Response.json({ mailAuthToken: 'mail-token' })
    if (path === '/auth/join-preview') return Response.json({ familyName: 'Мухатаевы', childName: 'Тихон' })
    return Response.json({})
  }) as typeof fetch
  return { calls, api: new TimelimitApi({ serverUrl: 'https://server.test', fetchImpl }), break: (value: boolean) => { broken = value } }
}

function withRole (status: ReturnType<typeof fullStatus>, role: 'admin' | 'manager' | 'member' | undefined) {
  if (role) status.users!.data.find((user) => user.id === 'parnt1')!.adultRole = role
  return status
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

test('creating a family opens a session and registers no device', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())

  const created = await call('/signin/create-family', { mailAuthToken: 'mail-token', password: 'secret-password', parentName: 'Мама', timeZone: 'Europe/Moscow' })
  assert.equal(created.status, 200)
  assert.deepEqual(created.body, { userId: 'parnt1', familyId: 'fam1' })
  const request = server.calls.find((c) => c.path === '/session/create-family')
  assert.ok(request, 'the family is created by the session endpoint')
  assert.equal('parentDevice' in request.body, false)
  assert.equal(server.calls.some((c) => c.path === '/parent/create-family'), false)
  assert.equal((await call('/view/family')).status, 200)
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

// @tag:parent-invitation
test('accepting an invitation opens a session without a password, inviting answers with the fresh family', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())

  const accepted = await call('/signin/accept-invitation', { mailAuthToken: 'mail-token', password: '', parentName: 'Мама', timeZone: 'Europe/Moscow' })
  assert.equal(accepted.status, 200)
  assert.equal('parentPassword' in server.calls.find((c) => c.path === '/session/accept-invitation')!.body, false)

  const invited = await call('/intent/invite-parent', { mail: 'mama@example.com', view: 'parents' })
  assert.equal(invited.status, 200, JSON.stringify(invited.body))
  assert.deepEqual(invited.body.data.invitations, [{ mail: 'mama@example.com', createdAt: 1 }])
  assert.equal(server.calls.some((c) => c.path === '/sync/push-actions'), false, 'an invitation is no sync action')
})

// @tag:family-join-google
test('only an admin links a child\'s Google account, and the child\'s tablet joins without a session', async () => {
  const server = fakeServer({ role: 'manager' })
  const { bff, call } = await startBff(server)
  after(() => bff.close())

  const preview = await call('/join/preview', { idToken: 'child-id-token' })
  assert.deepEqual(preview.body, { familyName: 'Мухатаевы', childName: 'Тихон' })
  const joined = await call('/join/confirm', { idToken: 'child-id-token', registerToken: 'abc' })
  assert.equal(joined.status, 200)
  assert.deepEqual(server.calls.find((c) => c.path === '/auth/join')!.body, { idToken: 'child-id-token', registerToken: 'abc' })

  await call('/signin/session', { mailAuthToken: 'mail-token' })
  const refused = await call('/intent/child-mail', { child: 'child1', mail: 'tikhon@gmail.com' })
  assert.equal(refused.status, 409)
  assert.equal(server.calls.some((c) => c.path === '/parent/set-child-mail'), false)
})

// @tag:adult-role
test('a member is refused in words before the sync server, and may still rename himself', async () => {
  const server = fakeServer({ role: 'member' })
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })

  const refused = await call('/intent/grant', { child: 'child1', category: 'Игры', minutes: 15 })
  assert.equal(refused.status, 409)
  assert.match(refused.body.error.title, /Член семьи/)
  assert.equal(server.calls.some((c) => c.path === '/sync/push-actions'), false)

  const renamed = await call('/intent/adult-rename', { user: 'parnt1', name: 'Папа' })
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body))
  const pushed = server.calls.find((c) => c.path === '/sync/push-actions')!
  assert.deepEqual(JSON.parse(pushed.body.actions[0].encodedAction), { type: 'RENAME_ADULT', userId: 'parnt1', name: 'Папа' })
})

// @tag:adult-role
test('leaving the family ends the session of this browser', async () => {
  const server = fakeServer({ role: 'manager' })
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })

  const left = await call('/intent/family-leave', {})
  assert.deepEqual(left.body, { signedOut: true })
  assert.ok(server.calls.some((c) => c.path === '/parent/leave-family'))
  assert.equal((await call('/view/now')).status, 401)
})

// @tag:adult-role
test('deleting the family wants the word typed', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })

  const refused = await call('/intent/family-delete', { word: 'да', mailAuthToken: 'mail-token' })
  assert.equal(refused.status, 400)
  assert.equal(server.calls.some((c) => c.path === '/parent/delete-family'), false)
})

test('Google sign-in suggests the given name from the token', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  const claims = Buffer.from(JSON.stringify({ given_name: 'Наталья', email: 'n@example.com' })).toString('base64url')
  const answer = await call('/signin/by-google', { idToken: `h.${claims}.s`, locale: 'ru' })
  assert.equal(answer.body.givenName, 'Наталья')
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
  assert.equal(result.status, 400)
  assert.equal(result.body.error.kind, 'bad-request')
  assert.match(result.body.error.hint, /known intents:/)
})

test('a screen that has moved on is told to reload, not sent to the logs', async () => {
  const server = fakeServer()
  const { bff, call } = await startBff(server)
  after(() => bff.close())
  await call('/signin/session', { mailAuthToken: 'mail-token' })

  const result = await call('/intent/grant', { child: 'child1', category: 'no such category', minutes: 1 })
  assert.equal(result.status, 400)
  assert.equal(result.body.error.kind, 'bad-request')
  assert.match(result.body.error.hint, /categories:/)
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
