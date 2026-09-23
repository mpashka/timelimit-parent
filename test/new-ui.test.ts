// @tag:parent-code @tag:child-request
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parentCode } from '../src/core/parent-code.ts'
import { answerCategoryId, answerRequest } from '../src/core/requests.ts'
import { appCard, guessCategory, usageDays } from '../src/core/apps.ts'
import { fixtureState, moscow } from './helpers.ts'
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

test('study window on a Saturday evening is Monday morning', () => {
  const tz = 'Europe/Moscow'
  const saturday = 20710 + 5
  const at = (day: number, minute: number) => timestampAt({ dayOfEpoch: day, minuteOfDay: minute }, tz)
  const study = [{ days: 0b0011111, start: 8 * 60, end: 14 * 60 - 1 }]
  assert.deepEqual(scheduleWindow('study', study, at(saturday, 20 * 60), tz), { start: at(saturday + 2, 8 * 60), end: at(saturday + 2, 14 * 60) })
})
