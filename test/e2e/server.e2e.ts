import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { TimelimitApi } from '../../src/core/api.ts'
import { addBanActions, readBans, replaceBanActions } from '../../src/core/bans.ts'
import { ApiError } from '../../src/core/errors.ts'
import { exportChild, overlayConfigs, planImport, type PortableConfig } from '../../src/core/config.ts'
import { isId } from '../../src/core/ids.ts'
import {
  addChild, allowCategoryUntil, allowChildUntil, grantExtraTime, limitApp, lockChild, revokeExtraTime, setDailyLimit, setUrlFilter, undoLimitApp, unlockChild
} from '../../src/core/operations.ts'
import { hashParentPassword } from '../../src/core/password.ts'
import { MemoryStorage, SyncClient } from '../../src/core/session.ts'
import { childCategories, type FamilyState } from '../../src/core/state.ts'
import { localTime } from '../../src/core/time.ts'

// @tag:parent-console
// End-to-end against a real timelimit-server started from TIMELIMIT_E2E_SERVER_DIR (built, `npm run build:json && tsc`).

const serverDir = process.env.TIMELIMIT_E2E_SERVER_DIR
if (!serverDir) {
  throw new Error('TIMELIMIT_E2E_SERVER_DIR is not set: point it at a built timelimit-server checkout of branch parent-console (see docs/parent-console.md, "Сквозной набор")')
}

const TIME_ZONE = 'Europe/Moscow'
const PASSWORD = 'parent-e2e-password'
const mail = `parent-${Date.now()}@example.com`

let server: ChildProcess
let output = ''
let dataDir: string
let api: TimelimitApi
let session: SyncClient
let childId: string
let newFamilyToken: string

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  }).on('error', reject)
})

async function waitFor<T> (what: string, check: () => T | undefined, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = check()
    if (value !== undefined) return value
    if (server.exitCode !== null) throw new Error(`server exited with ${server.exitCode} while waiting for ${what}; output:\n${output.slice(-2000)}`)
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; server output:\n${output.slice(-2000)}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** The server sends at most 2 codes per address in 5 minutes. NODE_ENV=development makes the server print every mail as JSON, login code included. */
async function mailAuthToken (): Promise<string> {
  const offset = output.length
  const mailLoginToken = await api.sendMailLoginCode({ mail, locale: 'en' })
  const code = await waitFor('login code in server output', () => /"code": "([^"]+)"/.exec(output.slice(offset))?.[1])
  return api.signInByMailCode({ mailLoginToken, receivedCode: code })
}

const categoryByTitle = (state: FamilyState, title: string) => {
  const category = childCategories(state, childId).find((c) => c.base.title === title)
  assert.ok(category, `category "${title}" in the pulled state`)
  return category
}

const child = (state: FamilyState) => state.users.data.find((u) => u.id === childId)!

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'timelimit-e2e-'))
  const port = await freePort()
  server = spawn(process.execPath, ['build/index.js'], {
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_URL: `sqlite://${join(dataDir, 'e2e.db')}` },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  server.stdout!.on('data', (chunk) => { output += String(chunk) })
  server.stderr!.on('data', (chunk) => { output += String(chunk) })
  await waitFor('"ready" from the server', () => /^ready$/m.test(output) ? true : undefined, 60000)
  api = new TimelimitApi({ serverUrl: `http://127.0.0.1:${port}` })
})

after(() => {
  server?.kill()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('a new mail address has no family', async () => {
  newFamilyToken = await mailAuthToken()
  const status = await api.getStatusByMailAuthToken({ mailAuthToken: newFamilyToken })
  assert.equal(status.status, 'without family')
  assert.equal(status.mail, mail)
  assert.equal(status.canCreateFamily, true)
})

test('create family with client-side password hashes, reusing the token of the status check', async () => {
  const result = await api.createFamily({
    mailAuthToken: newFamilyToken,
    password: await hashParentPassword(PASSWORD),
    parentName: 'Parent',
    deviceName: 'e2e console',
    timeZone: TIME_ZONE
  })
  const parent = result.data.users!.data.find((u) => u.type === 'parent')!
  assert.equal(parent.name, 'Parent')
  assert.equal(parent.mail, mail)
  assert.ok(bcrypt.compareSync(PASSWORD, parent.password!), 'the stored hash unlocks with the password, as BCrypt.checkpw on the child device does')
  assert.equal(result.data.devices!.data.find((d) => d.deviceId === result.ownDeviceId)?.currentUserId, parent.id)
  session = new SyncClient({ api, subject: { kind: 'device', authToken: result.deviceAuthToken, deviceId: result.ownDeviceId }, storage: new MemoryStorage() })
})

test('the mail now has a family and a second console signs into it', async () => {
  const token = await mailAuthToken()
  assert.equal((await api.getStatusByMailAuthToken({ mailAuthToken: token })).status, 'with family')
  await assert.rejects(
    api.createFamily({ mailAuthToken: token, password: await hashParentPassword(PASSWORD), parentName: 'Other', deviceName: 'x', timeZone: TIME_ZONE }),
    (ex: unknown) => ex instanceof ApiError && ex.status === 409 && /sign in instead/.test(ex.hint ?? '')
  )
  const second = await api.signInIntoFamily({ mailAuthToken: token, deviceName: 'e2e second console' })
  assert.equal(second.data.devices!.data.length, 2)
})

test('add a child with default categories', async () => {
  const plan = addChild({ name: 'Kid', timeZone: TIME_ZONE })
  childId = plan.childId
  const { state } = await session.push(plan.actions)
  assert.equal(child(state).type, 'child')
  assert.deepEqual(childCategories(state, childId).map((c) => c.base.title), ['Разрешено', 'Игры'])
})

test('categories from a config: apps, limits and bans', async () => {
  const config: PortableConfig = {
    format: 'timelimit-parent/config@1',
    categories: [
      { title: 'Игры', apps: ['com.game'], limits: [{ days: 'all', minutes: 60 }] },
      { title: 'Учёба', apps: ['org.school'], bans: [{ days: 'mo-fr', from: '21:00', to: '07:00' }] },
      { title: 'YouTube', parent: 'Игры', apps: ['com.google.android.youtube'] }
    ]
  }
  const { state } = await session.push(planImport({ state: await session.sync(), target: { childId }, config }).actions)
  assert.deepEqual(categoryByTitle(state, 'Игры').apps, ['com.game'])
  assert.equal(categoryByTitle(state, 'YouTube').base.parentCategoryId, categoryByTitle(state, 'Игры').id)
  assert.deepEqual(readBans([categoryByTitle(state, 'Учёба')]).map((b) => [b.days, b.start, b.end, b.hard]), [[31, 1260, 419, true]])
  assert.equal(planImport({ state, target: { childId }, config }).actions.length, 0, 'importing the same config again changes nothing')
})

test('ban on several categories', async () => {
  const before = await session.sync()
  const targets = [categoryByTitle(before, 'Игры'), categoryByTitle(before, 'YouTube')]
  const { state } = await session.push(addBanActions(targets, { days: 127, start: 780, end: 839, hard: false }))
  const bans = readBans([categoryByTitle(state, 'Игры'), categoryByTitle(state, 'YouTube')])
  assert.deepEqual(bans.map((b) => [b.days, b.start, b.end, b.hard, b.categoryIds.length]), [[127, 780, 839, false, 2]])
})

test('daily limit and per-app limit', async () => {
  let state = (await session.push(setDailyLimit({ category: categoryByTitle(await session.sync(), 'YouTube'), minutes: 45 }))).state
  assert.deepEqual(categoryByTitle(state, 'YouTube').rules.filter((r) => r.maxTime > 0).map((r) => r.maxTime), [45 * 60000])
  state = (await session.push(limitApp({ state, childId, packageName: 'org.school', minutes: 20, title: 'School app' }))).state
  const sub = categoryByTitle(state, 'School app')
  assert.equal(sub.base.parentCategoryId, categoryByTitle(state, 'Учёба').id)
  assert.deepEqual(sub.apps, ['org.school'])
  assert.deepEqual(categoryByTitle(state, 'Учёба').apps, [], 'the server moves the app out of its previous category')
})

test('grant extra time, allow a category, allow everything', async () => {
  const now = Date.now()
  let state = await session.sync()
  state = (await session.push(grantExtraTime({ state, category: categoryByTitle(state, 'Игры'), minutes: 15, now }))).state
  assert.equal(categoryByTitle(state, 'Игры').base.extraTime, 15 * 60000)
  assert.equal(categoryByTitle(state, 'Игры').base.extraTimeDay, localTime(now, TIME_ZONE).dayOfEpoch)
  state = (await session.push(allowCategoryUntil(categoryByTitle(state, 'YouTube'), now + 20 * 60000))).state
  assert.equal(categoryByTitle(state, 'YouTube').base.dlu, Math.round(now + 20 * 60000))
  state = (await session.push(allowChildUntil(child(state), now + 30 * 60000))).state
  assert.equal(child(state).disableLimitsUntil, Math.round(now + 30 * 60000))
})

test('lock and unlock the child', async () => {
  const until = Date.now() + 60 * 60000
  let state = await session.sync()
  state = (await session.push(lockChild({ state, child: child(state), until }))).state
  const roots = childCategories(state, childId).filter((c) => c.base.parentCategoryId === '')
  assert.ok(roots.length > 0 && roots.every((c) => c.base.tempBlocked && c.base.tempBlockTime === Math.round(until)))
  state = (await session.push(unlockChild({ state, child: child(state) }))).state
  assert.ok(childCategories(state, childId).every((c) => !c.base.tempBlocked))
})

test('undo: revoke extra time, undo an app limit, delete a ban', async () => {
  const now = Date.now()
  let state = await session.sync()
  state = (await session.push(revokeExtraTime({ state, category: categoryByTitle(state, 'Игры'), minutes: 15, now }))).state
  assert.equal(categoryByTitle(state, 'Игры').base.extraTime, 0)

  const actions = limitApp({ state, childId, packageName: 'com.game', minutes: 10, title: 'Game' })
  state = (await session.push(actions)).state
  assert.deepEqual(categoryByTitle(state, 'Game').apps, ['com.game'])
  state = (await session.push(undoLimitApp({ actions, packageName: 'com.game', previousCategoryId: categoryByTitle(state, 'Игры').id }))).state
  assert.equal(childCategories(state, childId).some((c) => c.base.title === 'Game'), false)
  assert.deepEqual(categoryByTitle(state, 'Игры').apps, ['com.game'])

  const categories = childCategories(state, childId)
  const soft = readBans(categories).find((b) => !b.hard)!
  state = (await session.push(replaceBanActions({ categories, removeRuleIds: soft.ruleRefs.map((r) => r.ruleId), ban: soft, categoryIds: [] }))).state
  assert.equal(readBans(childCategories(state, childId)).some((b) => !b.hard), false)
})

test('template overlay on every root category except the excluded one', async () => {
  const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../templates/${name}.json`, import.meta.url), 'utf8')) as PortableConfig
  const state = await session.sync()
  const { state: after } = await session.push(planImport({ state, target: { childId }, config: overlayConfigs([load('ночь')]) }).actions)
  const night = readBans(childCategories(after, childId)).filter((b) => b.start === 1260 && b.end === 419 && b.days === 0b1001111)
  assert.equal(night.length, 1, JSON.stringify(readBans(childCategories(after, childId))))
  const titles = night[0].categoryIds.map((id) => childCategories(after, childId).find((c) => c.id === id)!.base.title).sort()
  assert.deepEqual(titles, ['Игры', 'Учёба'])
})

test('url filter', async () => {
  const state = await session.sync()
  assert.equal(state.apiLevel >= 10, true, `server apiLevel ${state.apiLevel}: the parent-console branch is needed`)
  const filter = { enabled: true, allow: ['wikipedia.org'], block: ['*', 'google.com/search'] }
  assert.deepEqual(child((await session.push(setUrlFilter({ state, childId, filter }))).state).urlFilter, filter)
})

test('export and import as a new child round-trip', async () => {
  const state = await session.sync()
  const exported = exportChild(state, childId)
  const plan = planImport({ state, target: { newChild: { name: 'Twin' } }, config: exported })
  const { state: after } = await session.push(plan.actions)
  const copy = exportChild(after, plan.childId)
  assert.deepEqual({ ...copy, child: { ...copy.child!, name: 'Kid' } }, exported)
})

test('add-device token lets a child device join the family', async () => {
  const { token, deviceId } = await session.createAddDeviceToken()
  assert.equal(token.split(' ').length, 5)
  assert.ok(isId(deviceId))
  const response = await fetch(`${api.serverUrl}/child/add-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registerToken: token.toUpperCase(), childDevice: { model: 'e2e tablet' }, deviceName: 'Tablet', clientLevel: 3 })
  })
  assert.equal(response.status, 200, await response.clone().text())
  const device = (await session.sync()).devices.data.find((d) => d.deviceId === deviceId)
  assert.equal(device?.name, 'Tablet')
  assert.equal(device?.currentUserId, '')
  const reused = await fetch(`${api.serverUrl}/child/add-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registerToken: token, childDevice: { model: 'e2e tablet' }, deviceName: 'Tablet 2', clientLevel: 3 })
  })
  assert.equal(reused.status, 401, 'a token works once')
})
