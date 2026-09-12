import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeServerStatus, toClientStatus } from '../src/core/state.ts'
import { fixtureState } from './helpers.ts'

test('full status is merged and parent password hashes are dropped', () => {
  const state = fixtureState()
  assert.equal(Object.keys(state.categories).length, 4)
  assert.equal('password' in state.users.data.find((u) => u.id === 'parnt1')!, false)
  assert.equal(state.categories.games1.rules.length, 3)
  assert.deepEqual(toClientStatus(state).categories.games1, { base: 'b002', apps: 'a002', rules: 'r002', usedTime: 'u002', tasks: '' })
  assert.equal(toClientStatus(state).users, 'us01')
})

test('incremental status removes categories and replaces only the sent parts', () => {
  const state = mergeServerStatus(fixtureState(), {
    apiLevel: 9,
    fullVersion: 1,
    rmCategories: ['yt0001'],
    rules: [{ categoryId: 'games1', version: 'r005', rules: [{ id: 'rulG01', extraTime: false, dayMask: 127, maxTime: 1800000, start: 0, end: 1439, session: 0, pause: 0, perDay: true }] }]
  })
  assert.equal(state.categories.yt0001, undefined)
  assert.equal(state.categories.games1.rules.length, 1)
  assert.equal(state.categories.games1.rules[0].maxTime, 1800000)
  assert.equal(state.categories.games1.versions.rules, 'r005')
  assert.equal(state.categories.games1.versions.base, 'b002')
  assert.deepEqual(state.categories.games1.apps, ['com.game'])
  assert.equal(state.users.version, 'us01')
})
