// @tag:parent-code @tag:child-request
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parentCode } from '../src/core/parent-code.ts'
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
