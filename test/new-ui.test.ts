// @tag:parent-code @tag:child-request
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parentCode } from '../src/core/parent-code.ts'
import { answerCategoryId, answerRequest } from '../src/core/requests.ts'
import { fixtureState } from './helpers.ts'
import { sleepWindow } from '../src/shared/schedules.ts'
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
