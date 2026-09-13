import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../src/core/errors.ts'
import { parseDays } from '../src/core/time.ts'
import { banEndsAt, banLabel, errorText, formatCountdown, formatDuration, formatUntil } from '../src/web/format.ts'
import { moscow } from './helpers.ts'

test('durations read as minutes, hours and hours with padded minutes', () => {
  assert.deepEqual([0, 59999, 45 * 60000, 3600000, 65 * 60000, -5].map(formatDuration), ['0 мин', '0 мин', '45 мин', '1 ч', '1 ч 05 мин', '0 мин'])
})

test('ban labels show the end as the first free minute and days as ranges', () => {
  assert.equal(banLabel({ days: 127, start: 1260, end: 419, hard: true }), '21:00–07:00, пн–вс')
  assert.equal(banLabel({ days: parseDays('mo-fr'), start: 480, end: 839, hard: true }), '08:00–14:00, пн–пт')
  assert.equal(banLabel({ days: parseDays('mo,we,sa,su'), start: 1320, end: 1439, hard: false }), '22:00–24:00, пн, ср, сб, вс')
  assert.equal(banLabel({ days: parseDays('mo-th,sa'), start: 0, end: 59, hard: true }), '00:00–01:00, пн–чт, сб')
})

test('an overnight ban seen in the evening ends tomorrow morning, seen in the morning ends today', () => {
  const ban = { days: 127, start: 1260, end: 419, hard: true }
  assert.equal(banEndsAt(ban, moscow(14, 22), 'Europe/Moscow'), moscow(15, 7))
  assert.equal(banEndsAt(ban, moscow(14, 6), 'Europe/Moscow'), moscow(14, 7))
  assert.equal(formatUntil(moscow(15, 7), moscow(14, 22), 'Europe/Moscow'), 'до завтра 07:00')
  assert.equal(formatUntil(moscow(14, 23, 30), moscow(14, 22), 'Europe/Moscow'), 'до 23:30')
  assert.equal(formatUntil(moscow(17, 9), moscow(14, 22), 'Europe/Moscow'), 'до чт 17.09 09:00')
})

test('an unknown device token asks to sign in again', () => {
  assert.equal(errorText(new ApiError({ endpoint: '/sync/pull-status', status: 401, body: '' })).signInAgain, true)
})

test('countdown shows hours, padded minutes and seconds and stops at zero', () => {
  assert.deepEqual([3 * 3600000, 3 * 3600000 - 1, 61500, 0, -1000].map(formatCountdown), ['3:00:00', '3:00:00', '0:01:02', '0:00:00', '0:00:00'])
})
