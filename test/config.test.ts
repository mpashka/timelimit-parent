import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { exportChild, overlayConfigs, planImport, type PortableConfig } from '../src/core/config.ts'
import type { ParentAction } from '../src/core/protocol.ts'
import { fixtureState } from './helpers.ts'

test('export keeps structure, rules, bans and apps but no runtime state', () => {
  assert.deepEqual(exportChild(fixtureState(), 'child1'), {
    format: 'timelimit-parent/config@1',
    child: { name: 'Алиса', timeZone: 'Europe/Moscow', flags: 0 },
    categories: [
      { title: 'Разрешено', apps: ['com.android.dialer'] },
      {
        title: 'Игры',
        apps: ['com.game'],
        limits: [{ days: 'all', minutes: 60 }],
        bans: [{ days: 'mo-fr', from: '21:00', to: '07:00' }]
      },
      { title: 'YouTube', parent: 'Игры', apps: ['com.google.android.youtube'] },
      { title: 'Учёба', apps: ['org.school'], bans: [{ days: 'mo-fr', from: '21:00', to: '07:00' }] }
    ]
  })
})

const summary = (actions: ParentAction[]) => actions.map((a) => {
  switch (a.type) {
    case 'CREATE_CATEGORY': return `${a.type} ${a.title}`
    case 'CREATE_TIMELIMIT_RULE': return `${a.type} ${a.rule.days} ${a.rule.start}-${a.rule.end} ${a.rule.time}`
    case 'ADD_CATEGORY_APPS': return `${a.type} ${a.packageNames.join(',')}`
    default: return a.type
  }
})

test('importing an export as a new child replays it with fresh ids', () => {
  const state = fixtureState()
  const plan = planImport({ state, target: { newChild: { name: 'Боб' } }, config: exportChild(state, 'child1') })
  assert.deepEqual(summary(plan.actions), [
    'ADD_USER',
    'CREATE_CATEGORY Разрешено',
    'CREATE_CATEGORY Игры',
    'CREATE_CATEGORY YouTube',
    'CREATE_CATEGORY Учёба',
    'SET_PARENT_CATEGORY',
    'CREATE_TIMELIMIT_RULE 127 0-1439 3600000',
    'CREATE_TIMELIMIT_RULE 31 1260-1439 0',
    'CREATE_TIMELIMIT_RULE 62 0-419 0',
    'CREATE_TIMELIMIT_RULE 31 1260-1439 0',
    'CREATE_TIMELIMIT_RULE 62 0-419 0',
    'ADD_CATEGORY_APPS com.android.dialer',
    'ADD_CATEGORY_APPS com.game',
    'ADD_CATEGORY_APPS com.google.android.youtube',
    'ADD_CATEGORY_APPS org.school',
    'UPDATE_CATEGORY_SORTING'
  ])
  const ids = plan.actions.flatMap((a) => a.type === 'CREATE_CATEGORY' ? [a.categoryId] : [])
  assert.equal(new Set(ids).size, 4)
  assert.ok(ids.every((id) => /^[a-zA-Z0-9]{6}$/.test(id) && !['allow1', 'games1', 'study1', 'yt0001'].includes(id)))
  const parent = plan.actions.find((a) => a.type === 'SET_PARENT_CATEGORY')
  assert.deepEqual(parent, { type: 'SET_PARENT_CATEGORY', categoryId: ids[2], parentCategory: ids[1] })
})

test('importing onto the same child is a no-op in both modes', () => {
  const state = fixtureState()
  const config = exportChild(state, 'child1')
  assert.deepEqual(planImport({ state, target: { childId: 'child1' }, config }).actions, [])
  assert.deepEqual(planImport({ state, target: { childId: 'child1' }, config, mode: 'replace' }).actions, [])
})

test('a changed limit is added on merge and replaces the old rule on replace', () => {
  const state = fixtureState()
  const config: PortableConfig = { format: 'timelimit-parent/template@1', categories: [{ title: 'игры', limits: [{ days: 'all', minutes: 30 }] }] }
  assert.deepEqual(summary(planImport({ state, target: { childId: 'child1' }, config }).actions), ['CREATE_TIMELIMIT_RULE 127 0-1439 1800000'])
  const replaced = planImport({ state, target: { childId: 'child1' }, config, mode: 'replace' }).actions
  assert.deepEqual(replaced.slice(1), [
    { type: 'DELETE_TIMELIMIT_RULE', ruleId: 'rulG01' },
    { type: 'DELETE_TIMELIMIT_RULE', ruleId: 'banE01' },
    { type: 'DELETE_TIMELIMIT_RULE', ruleId: 'banM01' }
  ])
})

test('a wildcard ban goes to every root category except the listed ones', () => {
  const state = fixtureState()
  const config: PortableConfig = {
    format: 'timelimit-parent/template@1',
    exceptCategories: ['Разрешено'],
    categories: [{ title: '*', bans: [{ days: 'all', from: '13:00', to: '15:00' }] }]
  }
  const actions = planImport({ state, target: { childId: 'child1' }, config }).actions
  assert.deepEqual(actions.map((a) => a.type === 'CREATE_TIMELIMIT_RULE' && [a.rule.categoryId, a.rule.days, a.rule.start, a.rule.end]), [
    ['games1', 127, 780, 899],
    ['study1', 127, 780, 899]
  ])
})

test('overlay unites bans and url lists and keeps the smaller limit', () => {
  const merged = overlayConfigs([
    {
      format: 'timelimit-parent/template@1', name: 'a',
      categories: [{ title: '*', bans: [{ days: 'mo-fr', from: '21:00', to: '07:00' }] }, { title: 'Игры', limits: [{ days: 'all', minutes: 60 }] }],
      urlFilter: { enabled: false, allow: ['wikipedia.org'], block: [] }
    },
    {
      format: 'timelimit-parent/template@1', name: 'b',
      categories: [
        { title: '*', bans: [{ days: 'mo-fr', from: '21:00', to: '07:00' }, { days: 'all', from: '13:00', to: '15:00' }] },
        { title: 'игры', limits: [{ days: 'all', minutes: 90 }, { days: 'sa-su', minutes: 120 }] }
      ],
      urlFilter: { enabled: true, allow: ['wikipedia.org', 'khanacademy.org'], block: ['*'] }
    }
  ])
  assert.deepEqual(merged, {
    format: 'timelimit-parent/template@1',
    name: 'a + b',
    categories: [
      { title: '*', bans: [{ days: 'mo-fr', from: '21:00', to: '07:00' }, { days: 'all', from: '13:00', to: '15:00' }] },
      { title: 'Игры', limits: [{ days: 'all', minutes: 60 }, { days: 'sa-su', minutes: 120 }] }
    ],
    urlFilter: { enabled: true, allow: ['wikipedia.org', 'khanacademy.org'], block: ['*'] }
  })
})

test('all shipped templates parse, stack and plan against the fixture child', () => {
  const directory = 'templates'
  const templates = readdirSync(directory).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${directory}/${f}`, 'utf8')) as PortableConfig)
  assert.ok(templates.length >= 4)
  const plan = planImport({ state: fixtureState(), target: { childId: 'child1' }, config: overlayConfigs(templates) })
  assert.ok(plan.actions.some((a) => a.type === 'CREATE_CATEGORY' && a.title === 'Видео'))
  assert.ok(plan.warnings.some((w) => w.includes('Видео')))
})
