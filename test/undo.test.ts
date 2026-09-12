import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createdRuleIds, readBans, replaceBanActions } from '../src/core/bans.ts'
import { grantExtraTime, limitApp, lockChild, restoreDailyLimits, restoreTemporaryBlocks, revokeExtraTime, setDailyLimit, undoLimitApp } from '../src/core/operations.ts'
import { childCategories } from '../src/core/state.ts'
import { fixtureState, moscow } from './helpers.ts'

const games = () => childCategories(fixtureState(), 'child1').find((c) => c.id === 'games1')!

test('revoking a grant sets today extra time back and never below zero', () => {
  const state = fixtureState()
  assert.equal(grantExtraTime({ state, category: games(), minutes: 30, now: moscow(14, 15) }).length, 1)
  assert.deepEqual(revokeExtraTime({ state, category: games(), minutes: 5, now: moscow(14, 15) }),
    [{ type: 'SET_CATEGORY_EXTRA_TIME', categoryId: 'games1', newExtraTime: 300000, day: 20710 }])
  assert.deepEqual(revokeExtraTime({ state, category: games(), minutes: 30, now: moscow(15, 15) }),
    [{ type: 'SET_CATEGORY_EXTRA_TIME', categoryId: 'games1', newExtraTime: 0, day: 20711 }])
})

test('undo of a lock unblocks exactly the categories that were free before', () => {
  const state = fixtureState()
  const child = state.users.data.find((u) => u.id === 'child1')!
  const before = childCategories(state, 'child1')
  assert.equal(lockChild({ state, child }).length, 3)
  assert.deepEqual(restoreTemporaryBlocks(before).map((a) => a.type === 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED' && [a.categoryId, a.blocked]),
    [['allow1', false], ['games1', false], ['study1', false], ['yt0001', false]])
})

test('undo of a limit change deletes the new daily limit and recreates the old one', () => {
  const category = games()
  const snapshot = category.rules.filter((r) => r.id === 'rulG01')
  const changed = setDailyLimit({ category, minutes: 90 })
  const created = changed.find((a) => a.type === 'CREATE_TIMELIMIT_RULE')!
  const after = { ...category, rules: [...category.rules.filter((r) => r.id !== 'rulG01'), { ...snapshot[0], id: createdRuleIds([created])[0], maxTime: 5400000 }] }
  const undo = restoreDailyLimits({ category: after, snapshot })
  assert.deepEqual(undo[0], { type: 'DELETE_TIMELIMIT_RULE', ruleId: createdRuleIds([created])[0] })
  assert.equal(undo.length, 2)
  assert.ok(undo[1].type === 'CREATE_TIMELIMIT_RULE' && undo[1].rule.time === 3600000 && undo[1].rule.days === 127)
})

test('undo of an app limit moves the app back and deletes the created sub-category', () => {
  const actions = limitApp({ state: fixtureState(), childId: 'child1', packageName: 'com.game', minutes: 30 })
  const created = actions[0].type === 'CREATE_CATEGORY' ? actions[0].categoryId : ''
  assert.deepEqual(undoLimitApp({ actions, packageName: 'com.game', previousCategoryId: 'games1' }), [
    { type: 'ADD_CATEGORY_APPS', categoryId: 'games1', packageNames: ['com.game'] },
    { type: 'DELETE_CATEGORY', categoryId: created }
  ])
})

test('changing only the categories of a ban deletes and recreates its rules instead of losing them', () => {
  const categories = childCategories(fixtureState(), 'child1')
  const [ban] = readBans(categories)
  const actions = replaceBanActions({ categories, removeRuleIds: ban.ruleRefs.map((r) => r.ruleId), ban, categoryIds: ['games1'] })
  assert.deepEqual(actions.filter((a) => a.type === 'DELETE_TIMELIMIT_RULE').length, 4)
  assert.deepEqual(actions.flatMap((a) => a.type === 'CREATE_TIMELIMIT_RULE' ? [[a.rule.categoryId, a.rule.start, a.rule.end]] : []),
    [['games1', 1260, 1439], ['games1', 0, 419]])
})
