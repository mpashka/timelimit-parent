import assert from 'node:assert/strict'
import { test } from 'node:test'
import { childOverview, remainingTime } from '../src/core/overview.ts'
import { fixtureState, moscow } from './helpers.ts'

test('Monday 15:00: games have 15 min left plus 10 min extra time, study and allowed apps are loopholes', () => {
  const overview = childOverview(fixtureState(), 'child1', moscow(14, 15))
  const games = overview.categories.find((c) => c.id === 'games1')!
  assert.equal(overview.dayOfEpoch, 20710)
  assert.equal(games.usedTodayMs, 2700000)
  assert.equal(games.limitNowMs, 3600000)
  assert.deepEqual(games.remaining, { default: 900000, includingExtraTime: 1500000 })
  assert.equal(games.blockedNow, null)
  assert.deepEqual(overview.categories.map((c) => c.title), ['Разрешено', 'Игры', 'YouTube', 'Учёба'])
  assert.deepEqual(overview.loopholes.map((l) => [l.kind, l.categoryId]), [['no-rules', 'allow1'], ['no-rule-now', 'study1']])
  assert.equal(overview.bans.length, 1)
  assert.equal(overview.bans[0].activeNow, false)
  assert.equal(overview.unassignedApps, null)
})

test('the Monday night ban holds on Tuesday 06:00 and blocks the sub-category through its parent', () => {
  const overview = childOverview(fixtureState(), 'child1', moscow(15, 6))
  assert.equal(overview.bans[0].activeNow, true)
  assert.equal(overview.categories.find((c) => c.id === 'games1')!.blockedNow, 'ban')
  assert.equal(overview.categories.find((c) => c.id === 'yt0001')!.blockedByParent, 'games1')
  assert.deepEqual(overview.loopholes.map((l) => l.categoryId), ['allow1'])
})

test('the Friday night ban reaches Saturday morning but no Sunday morning', () => {
  assert.equal(childOverview(fixtureState(), 'child1', moscow(19, 6)).bans[0].activeNow, true)
  assert.equal(childOverview(fixtureState(), 'child1', moscow(20, 6)).bans[0].activeNow, false)
})

test('a weekly rule sums the days of the current week only', () => {
  const rule = { id: 'week01', extraTime: false, dayMask: 127, maxTime: 6 * 3600000, start: 0, end: 1439, session: 0, pause: 0, perDay: false }
  const remaining = remainingTime({
    rules: [rule],
    usedTimes: [
      { day: 20709, time: 3 * 3600000, start: 0, end: 1439 },
      { day: 20710, time: 2 * 3600000, start: 0, end: 1439 },
      { day: 20711, time: 3600000, start: 0, end: 1439 }
    ],
    extraTime: 0, dayOfEpoch: 20712, dayOfWeek: 2, minuteOfDay: 600
  })
  assert.deepEqual(remaining, { default: 3 * 3600000, includingExtraTime: 3 * 3600000 })
})

test('extra time is capped by rules that also apply to extra time', () => {
  const remaining = remainingTime({
    rules: [
      { id: 'soft01', extraTime: false, dayMask: 127, maxTime: 60 * 60000, start: 0, end: 1439, session: 0, pause: 0, perDay: true },
      { id: 'cap001', extraTime: true, dayMask: 127, maxTime: 80 * 60000, start: 0, end: 1439, session: 0, pause: 0, perDay: true }
    ],
    usedTimes: [{ day: 20710, time: 45 * 60000, start: 0, end: 1439 }],
    extraTime: 30 * 60000, dayOfEpoch: 20710, dayOfWeek: 0, minuteOfDay: 600
  })
  assert.deepEqual(remaining, { default: 15 * 60000, includingExtraTime: 35 * 60000 })
})
