import assert from 'node:assert/strict'
import { test } from 'node:test'
import { childOverview, remainingTime } from '../src/core/overview.ts'
import { setDailyLimit } from '../src/core/operations.ts'
import { childCategories, createEmptyState, type FamilyState, mergeServerStatus } from '../src/core/state.ts'
import type { ServerDataStatus } from '../src/core/protocol.ts'
import { fullStatus } from './fixtures/full-status.ts'
import { fixtureState, moscow } from './helpers.ts'

const fixtureStateWith = (status: ServerDataStatus): FamilyState => mergeServerStatus(createEmptyState(), status)

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

test('a spent weekly limit closes games with time left today and is shown apart from the daily limit', () => {
  const status = fullStatus()
  status.rules!.find((r) => r.categoryId === 'games1')!.rules.push(
    { id: 'week01', extraTime: false, dayMask: 127, maxTime: 100 * 60000, start: 0, end: 1439, session: 0, pause: 0, perDay: false })
  status.usedTimes!.find((u) => u.categoryId === 'games1')!.times.push(
    { day: 20711, time: 60 * 60000, start: 0, end: 1439 },
    { day: 20712, time: 6 * 60000, start: 0, end: 1439 })
  const games = childOverview(fixtureStateWith(status), 'child1', moscow(16, 15)).categories.find((c) => c.id === 'games1')!
  assert.equal(games.blockedNow, 'limit-reached')
  assert.equal(games.usedTodayMs, 6 * 60000)
  assert.equal(games.limitNowMs, 60 * 60000)
  assert.deepEqual(games.week, { usedMs: 111 * 60000, limitMs: 100 * 60000 })
  assert.equal(setDailyLimit({ category: childCategories(fixtureStateWith(status), 'child1').find((c) => c.id === 'games1')!, minutes: 30, days: 31 })
    .some((a) => a.type !== 'CREATE_TIMELIMIT_RULE' && 'ruleId' in a && a.ruleId === 'week01'), false)
})
