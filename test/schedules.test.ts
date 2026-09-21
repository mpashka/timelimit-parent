import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBans } from '../src/core/bans.ts'
import { MINUTE_MAX, type ServerRule } from '../src/core/protocol.ts'
import { defaultScheduleCategories, setScheduleActions } from '../src/core/schedules.ts'
import type { CategoryView } from '../src/core/state.ts'
import { scheduleKind } from '../src/shared/schedules.ts'

const category = (id: string, rules: Array<[mask: number, start: number, end: number]>, parent = ''): CategoryView => ({
  id,
  apps: [],
  rules: rules.map(([dayMask, start, end], i): ServerRule => ({
    id: `${id}${i}`, extraTime: true, dayMask, maxTime: 0, start, end, session: 0, pause: 0, perDay: false
  })),
  usedTimes: [],
  versions: { base: '', apps: '', rules: '', usedTime: '', tasks: '' },
  base: {
    categoryId: id, childId: 'child1', title: id, blockedTimes: '', extraTime: 0, extraTimeDay: -1, tempBlocked: false, tempBlockTime: 0,
    version: '', parentCategoryId: parent, blockAllNotifications: false, timeWarnings: 0, mblCharging: 0, mblMobile: 0, sort: 0, dlu: 0, flags: 0,
    blockNotificationDelay: 0, networks: [], atw: []
  }
})

const ALL = 127
const WEEKDAYS = 31
const EVENING: [number, number, number] = [ALL, 1290, MINUTE_MAX]
const STUDY: [number, number, number] = [WEEKDAYS, 450, 899]

// The bans of a real family, made by hand: each category's night ends at its own time, and games
// have their own daytime bans on top.
const family = [
  category('Unknown', [EVENING, [ALL, 0, 419], STUDY]),
  category('Readers', [EVENING, [ALL, 0, 359], STUDY]),
  category('Games', [EVENING, [WEEKDAYS, 0, 960], [96, 0, 420]], 'Readers'),
  category('Education', [EVENING, [ALL, 0, 359]]),
  category('Allowed', [])
]

test('hand-made bans are recognised as sleep and study; switching sleep replaces only its rules', () => {
  const bans = readBans(family)
  const byKind = (kind: string | null) => bans.filter((ban) => scheduleKind(ban) === kind).map((ban) => [ban.start, ban.end, ban.categoryIds])
  assert.deepEqual(byKind('sleep'), [
    [1290, 359, ['Readers', 'Education']],
    [1290, 419, ['Unknown']],
    [1290, MINUTE_MAX, ['Games']]
  ])
  assert.deepEqual(byKind('study'), [[450, 899, ['Unknown', 'Readers']]])
  assert.equal(byKind(null).length, 2)

  assert.deepEqual(defaultScheduleCategories('sleep', family), ['Unknown', 'Readers', 'Education'])
  assert.deepEqual(defaultScheduleCategories('study', family), ['Unknown', 'Readers'])

  const actions = setScheduleActions({
    categories: family,
    bans,
    kind: 'sleep',
    wanted: [{ days: ALL, start: 1260, end: 419, hard: true, categoryIds: ['Unknown', 'Readers'] }]
  })
  assert.deepEqual(actions.flatMap((a) => a.type === 'DELETE_TIMELIMIT_RULE' ? [a.ruleId] : []).sort(),
    ['Education0', 'Education1', 'Games0', 'Readers0', 'Readers1', 'Unknown0', 'Unknown1'])
  assert.deepEqual(actions.flatMap((a) => a.type === 'CREATE_TIMELIMIT_RULE' ? [[a.rule.categoryId, a.rule.start, a.rule.end]] : []), [
    ['Unknown', 1260, MINUTE_MAX], ['Unknown', 0, 419], ['Readers', 1260, MINUTE_MAX], ['Readers', 0, 419]
  ])
  assert.throws(() => setScheduleActions({ categories: family, bans, kind: 'sleep', wanted: [{ days: ALL, start: 480, end: 839, hard: true, categoryIds: ['Unknown'] }] }))
})
