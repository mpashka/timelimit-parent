// @tag:app-icon
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appTitle, mergeAppLabels } from '../src/core/apps.ts'
import { parsePlayPage } from '../src/bff/app-labels.ts'
import { fixtureState } from './helpers.ts'

test('app name: Google Play, then the tablet, then the new-app title, then the package; the icon follows the name', () => {
  const state = fixtureState()
  state.users.data.find((user) => user.id === 'child1')!.newApps = ['a.play', 'b.tablet', 'c.new'].map((packageName) => (
    { packageName, title: `new ${packageName}`, section: '', installedAt: 0, deviceId: 'devC01' }
  ))
  const labels = mergeAppLabels(
    new Map([['a.play', { title: 'Play A', icon: 'icon/a.play?v=p' }]]),
    new Map([['a.play', { title: 'Tablet A', icon: 'icon/a.play?v=t' }], ['b.tablet', { title: 'Tablet B', icon: 'icon/b.tablet?v=t' }]])
  )
  assert.deepEqual(['a.play', 'b.tablet', 'c.new', 'd.none'].map((name) => [appTitle(state, name, labels), labels.get(name)?.icon ?? null]), [
    ['Play A', 'icon/a.play?v=p'],
    ['Tablet B', 'icon/b.tablet?v=t'],
    ['new c.new', null],
    ['d.none', null]
  ])
})

test('Play page: the store half of og:title is dropped whatever the dash, the icon is asked at 96 px', () => {
  const page = `<meta content="website" property="og:type">
<meta property="og:title" content="Приложения в Google Play – Tom &amp; Jerry – Chase">
<meta name="description" property="og:description" content="Погоня">
<meta property="og:image" content="https://play-lh.googleusercontent.com/gbkzfC3R1fXc=s0-br30">`
  assert.deepEqual(parsePlayPage(page), { title: 'Tom & Jerry – Chase', iconUrl: 'https://play-lh.googleusercontent.com/gbkzfC3R1fXc=s96' })
  assert.equal(parsePlayPage(page.replace('–', '-'))?.title, 'Tom & Jerry – Chase')
  assert.equal(parsePlayPage('<meta property="og:title" content="Google Chrome - Apps on Google Play"><meta property="og:image" content="https://x/y">')?.title, 'Google Chrome')
  assert.equal(parsePlayPage('<title>Not Found</title>'), null)
})
