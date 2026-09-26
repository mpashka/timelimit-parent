// @tag:parent-code @tag:child-request
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parentCode } from '../src/core/parent-code.ts'
import { answerCategoryId, answerRequest } from '../src/core/requests.ts'
import { renameCategory } from '../src/core/operations.ts'
import { requestAnswerActions, requestRows } from '../src/cli/requests.ts'
import { childCategories } from '../src/core/state.ts'
import { categoryTitleProblem } from '../src/shared/category-title.ts'
import { appCard, guessCategory, usageDays } from '../src/core/apps.ts'
import { fixtureState, moscow } from './helpers.ts'
import { buildIntent } from '../src/bff/intents.ts'
import { buildView } from '../src/bff/views.ts'
import { scheduleWindow, sleepWindow } from '../src/shared/schedules.ts'
import { timestampAt } from '../src/shared/time.ts'

test('parent code is RFC 6238 TOTP: the SHA-1 test vector at T=59 gives 287082', () => {
  assert.deepEqual(parentCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), { code: '287082', validUntil: 60_000 })
})

test('sleep window: before it the start is where the day ends, during it the end is the morning', () => {
  const tz = 'Europe/Moscow'
  const tuesday = 20710 + 1
  const at = (day: number, minute: number) => timestampAt({ dayOfEpoch: day, minuteOfDay: minute }, tz)
  const sleep = [{ days: 127, start: 21 * 60, end: 7 * 60 - 1 }]
  assert.deepEqual(sleepWindow(sleep, at(tuesday, 18 * 60 + 20), tz), { start: at(tuesday, 21 * 60), end: at(tuesday + 1, 7 * 60) })
  assert.deepEqual(sleepWindow(sleep, at(tuesday, 3 * 60), tz), { start: at(tuesday - 1, 21 * 60), end: at(tuesday, 7 * 60) })
})

test('«вся категория» for an app without one opens the category for such apps, and is refused without it', () => {
  const state = fixtureState()
  const child = state.users.data.find((user) => user.id === 'child1')!
  child.requests = [{ id: 'rq0001', packageName: 'com.robtopx.geometryjump', categoryId: '', deviceId: 'devC01', word: '', createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }]
  const answer = () => answerRequest({ state, requestId: 'rq0001', answer: 'category', until: 1, word: '' })
  assert.throws(answer)
  child.categoryForNotAssignedApps = 'allow1'
  assert.equal(answerCategoryId(state, child.requests[0], 'child1'), 'allow1')
  assert.deepEqual(answer(), [{ type: 'ANSWER_CHILD_REQUEST', requestId: 'rq0001', answer: 'category', until: 1, word: '' }])
})

test('app card: the week sums both tablets per day, a store section guesses the family category', () => {
  const state = fixtureState()
  const now = moscow(14, 15)
  const { toDay } = usageDays(state, 'child1', now)
  const usage = [
    { deviceId: 'devC01', day: toDay, packageName: 'com.game', ms: 600000 },
    { deviceId: 'devX', day: toDay, packageName: 'com.game', ms: 300000 },
    { deviceId: 'devC01', day: toDay - 1, packageName: 'com.game', ms: 1200000 },
    { deviceId: 'devC01', day: toDay, packageName: 'other', ms: 999 }
  ]
  const card = appCard(state, 'child1', 'com.game', now, usage)
  assert.equal(card.todayMs, 900000)
  assert.equal(card.averageMs, Math.round(2100000 / 7))
  assert.equal(card.category?.id, 'games1')
  assert.equal(guessCategory(state, 'child1', 'game'), 'games1')
  assert.equal(guessCategory(state, 'child1', 'maps'), null)
})

test('an app moved on one tablet goes as <package>@<device> and shows on the card only for that tablet', () => {
  const state = fixtureState()
  const actions = buildIntent('app-move', { state, now: 0 }, { child: 'child1', package: 'com.game', device: 'devC01', category: 'allow1' })
  assert.deepEqual(actions, [{ type: 'ADD_CATEGORY_APPS', categoryId: 'allow1', packageNames: ['com.game@devC01'] }])
  state.categories.allow1.apps.push('com.game@devC01')
  const card = appCard(state, 'child1', 'com.game', 0, null)
  assert.equal(card.category?.id, 'games1')
  assert.deepEqual(card.devices.map((device) => [device.deviceId, device.category?.id ?? null]), [['devC01', 'allow1'], ['devC02', null]])
})

test('study window on a Saturday evening is Monday morning', () => {
  const tz = 'Europe/Moscow'
  const saturday = 20710 + 5
  const at = (day: number, minute: number) => timestampAt({ dayOfEpoch: day, minuteOfDay: minute }, tz)
  const study = [{ days: 0b0011111, start: 8 * 60, end: 14 * 60 - 1 }]
  assert.deepEqual(scheduleWindow('study', study, at(saturday, 20 * 60), tz), { start: at(saturday + 2, 8 * 60), end: at(saturday + 2, 14 * 60) })
})

test('a category title is the parent\'s own text: emoji count as one character, 255 at most, never empty', () => {
  const category = childCategories(fixtureState(), 'child1').find((item) => item.id === 'games1')!
  assert.deepEqual(renameCategory({ category, title: '  Игры 🎮 ' }), [{ type: 'UPDATE_CATEGORY_TITLE', categoryId: 'games1', newTitle: 'Игры 🎮' }])
  assert.equal(categoryTitleProblem('🎮'.repeat(255)), null)
  assert.match(categoryTitleProblem('🎮'.repeat(256)) ?? '', /255/)
  assert.notEqual(categoryTitleProblem('   '), null)
  assert.deepEqual(renameCategory({ category, title: category.base.title }), [])
})

test('CLI: request answer and deny parse into the same answers as the console', () => {
  const state = fixtureState()
  const now = moscow(14, 18, 20)
  state.users.data.find((user) => user.id === 'child1')!.requests = [
    { id: 'rq0001', packageName: 'com.roblox.client', categoryId: 'games1', deviceId: 'devC01', word: 'ещё', createdAt: now - 60000, expiresAt: now + 29 * 60000 }
  ]
  assert.deepEqual(requestAnswerActions({ state, args: ['answer', 'rq0001', 'app', '30m'], now }),
    [{ type: 'ANSWER_CHILD_REQUEST', requestId: 'rq0001', answer: 'app', until: now + 30 * 60000, word: '' }])
  const day = requestAnswerActions({ state, args: ['answer', 'rq0001', 'category', 'day'], word: 'до вечера', now })[0] as { until: number, word: string }
  assert.ok(day.until > now && day.word === 'до вечера')
  assert.deepEqual(requestAnswerActions({ state, args: ['deny', 'rq0001'], word: 'уроки', now }),
    [{ type: 'ANSWER_CHILD_REQUEST', requestId: 'rq0001', answer: 'deny', until: 0, word: 'уроки' }])
  assert.throws(() => requestAnswerActions({ state, args: ['answer', 'rq0001', 'app', '2h'], now }), /15m, 30m, 1h, day/)
  assert.throws(() => requestAnswerActions({ state, args: ['answer', 'rq0001', 'all', '1h'], now }), /app or category/)
  assert.deepEqual(requestRows(state, 'child1', now).map((row) => [row.id, row.status, row.device]), [['rq0001', 'waiting', state.devices.data.find((d) => d.deviceId === 'devC01')?.name]])
})

// @tag:category-time
test('now view: a category without a limit takes its time from its apps, per tablet kept for the filter', () => {
  const state = fixtureState()
  const now = moscow(14, 15)
  const { toDay } = usageDays(state, 'child1', now)
  const items = [
    { deviceId: 'devC01', day: toDay, packageName: 'com.dialer', ms: 0 },
    { deviceId: 'devC01', day: toDay, packageName: 'com.android.dialer', ms: 120000 },
    { deviceId: 'devC02', day: toDay, packageName: 'com.android.dialer', ms: 60000 }
  ]
  const view = buildView('now', { state, now, childId: 'child1', serverUrl: '', signedInUserId: 'parent1', appUsage: { items } }) as {
    categories: Array<{ id: string, usedTodayMs: number, limitNowMs: number | null, appList: Array<{ packageName: string }> }>
    apps: Array<{ packageName: string, byDevice: Record<string, number> }>
  }
  const allowed = view.categories.find((category) => category.id === 'allow1')!
  assert.equal(allowed.limitNowMs, null)
  assert.equal(allowed.usedTodayMs, 180000)
  assert.deepEqual(allowed.appList.map((app) => app.packageName), ['com.android.dialer'])
  assert.deepEqual(view.apps.map((app) => [app.packageName, app.byDevice]), [['com.android.dialer', { devC01: 120000, devC02: 60000 }]])
})
