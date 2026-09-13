import assert from 'node:assert/strict'
import { test } from 'node:test'
import bcrypt from 'bcryptjs'
import { ParentConsoleError } from '../src/core/errors.ts'
import { addChild } from '../src/core/operations.ts'
import { hashParentPassword } from '../src/core/password.ts'

// Copied from timelimit-server src/util/password.ts: create-family rejects anything else.
const serverHash = /^\$2a\$[123][0-9]\$[./A-Za-z0-9]{53}$/
const serverSalt = /^\$2a\$[123][0-9]\$[./A-Za-z0-9]{22}$/

test('parent password hashes have the $2a$ form the server accepts and verify like BCrypt.checkpw', async () => {
  const password = await hashParentPassword('ключ-42')
  assert.match(password.hash, serverHash)
  assert.match(password.secondHash, serverHash)
  assert.match(password.secondSalt, serverSalt)
  assert.ok(password.secondHash.startsWith(password.secondSalt))
  assert.ok(bcrypt.compareSync('ключ-42', password.hash))
  assert.notEqual(password.hash.slice(0, 29), password.secondSalt)
})

test('a parent password shorter than the Android client accepts is refused before hashing', async () => {
  await assert.rejects(hashParentPassword('a'), (ex: unknown) => ex instanceof ParentConsoleError && /at least 2/.test(ex.message))
})

test('a new child gets the two categories of the Android app in order', () => {
  const { childId, actions } = addChild({ name: '  Kid ', timeZone: 'Europe/Moscow' })
  assert.deepEqual(actions[0], { type: 'ADD_USER', userId: childId, name: 'Kid', userType: 'child', timeZone: 'Europe/Moscow' })
  const created = actions.flatMap((a) => a.type === 'CREATE_CATEGORY' ? [[a.childId, a.title, a.categoryId]] : [])
  assert.deepEqual(created.map(([owner, title]) => [owner, title]), [[childId, 'Разрешено'], [childId, 'Игры']])
  assert.deepEqual(actions.at(-1), { type: 'UPDATE_CATEGORY_SORTING', categoryIds: created.map((c) => c[2]) })
  assert.throws(() => addChild({ name: ' ', timeZone: 'UTC' }), ParentConsoleError)
})
