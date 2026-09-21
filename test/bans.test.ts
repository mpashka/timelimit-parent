import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addBanActions, readBans, readLegacyBans, removeBanActions } from '../src/core/bans.ts'
import { MINUTE_MAX, type ServerRule } from '../src/core/protocol.ts'
import { childCategories, type CategoryView } from '../src/core/state.ts'
import { parseDays } from '../src/core/time.ts'
import { fixtureState } from './helpers.ts'

const emptyCategory = (id: string, blockedTimes = ''): CategoryView => ({
  id,
  apps: [],
  rules: [],
  usedTimes: [],
  versions: { base: '', apps: '', rules: '', usedTime: '', tasks: '' },
  base: {
    categoryId: id, childId: 'child1', title: id, blockedTimes, extraTime: 0, extraTimeDay: -1, tempBlocked: false, tempBlockTime: 0,
    version: '', parentCategoryId: '', blockAllNotifications: false, timeWarnings: 0, mblCharging: 0, mblMobile: 0, sort: 0, dlu: 0, flags: 0,
    blockNotificationDelay: 0, networks: [], atw: []
  }
})

test('21:00-07:00 on weekdays expands into an evening and a shifted morning rule per category', () => {
  const actions = addBanActions([emptyCategory('catA01')], { days: parseDays('mo-fr'), start: 1260, end: 419, hard: true })
  assert.deepEqual(actions.map((a) => a.type === 'CREATE_TIMELIMIT_RULE' && [a.rule.days, a.rule.start, a.rule.end, a.rule.time, a.rule.extraTime]), [
    [31, 1260, 1439, 0, true],
    [62, 0, 419, 0, true]
  ])
})

test('a Sunday night ban wraps its morning part to Monday', () => {
  const actions = addBanActions([emptyCategory('catA01')], { days: parseDays('su'), start: 1320, end: 359, hard: false })
  assert.deepEqual(actions.map((a) => a.type === 'CREATE_TIMELIMIT_RULE' && [a.rule.days, a.rule.start, a.rule.end, a.rule.extraTime]), [
    [64, 1320, 1439, false],
    [1, 0, 359, false]
  ])
})

test('expanded rules on several categories group back into the same bans', () => {
  const categories = [emptyCategory('catA01'), emptyCategory('catB01')]
  const specs = [
    { days: parseDays('mo-fr'), start: 1260, end: 419, hard: true },
    { days: parseDays('mo-fr'), start: 480, end: 839, hard: true }
  ]
  for (const spec of specs) {
    for (const action of addBanActions(categories, spec)) {
      if (action.type !== 'CREATE_TIMELIMIT_RULE') continue
      const { rule } = action
      // The fields the action may omit get the defaults of the server's own TimeLimitRule.parse.
      const serverRule: ServerRule = {
        id: rule.ruleId, extraTime: rule.extraTime, dayMask: rule.days, maxTime: rule.time,
        start: rule.start ?? 0, end: rule.end ?? MINUTE_MAX, session: 0, pause: 0, perDay: rule.perDay ?? false
      }
      categories.find((c) => c.id === rule.categoryId)!.rules.push(serverRule)
    }
  }
  const bans = readBans(categories)
  assert.deepEqual(bans.map((b) => [b.days, b.start, b.end, b.hard, b.categoryIds]), [
    [31, 480, 839, true, ['catA01', 'catB01']],
    [31, 1260, 419, true, ['catA01', 'catB01']]
  ])
  assert.equal(bans[1].ruleRefs.length, 4)
  assert.deepEqual(addBanActions(categories, specs[0]), [])
})

test('removing a ban from one category deletes only its two rules', () => {
  const state = fixtureState()
  const [ban] = readBans(childCategories(state, 'child1'))
  assert.deepEqual(removeBanActions(ban, ['study1']), [
    { type: 'DELETE_TIMELIMIT_RULE', ruleId: 'banE02' },
    { type: 'DELETE_TIMELIMIT_RULE', ruleId: 'banM02' }
  ])
})

test('legacy blocked minutes read as bans, including the week wrap', () => {
  const bans = readLegacyBans([
    emptyCategory('catA01', '1260,1860,2700,3300'),
    emptyCategory('catB01', '0,420,9900,10080')
  ])
  assert.deepEqual(bans.map((b) => [b.days, b.start, b.end, b.categoryIds, b.legacy]), [
    [3, 1260, 419, ['catA01'], true],
    [64, 1260, 419, ['catB01'], true]
  ])
})
