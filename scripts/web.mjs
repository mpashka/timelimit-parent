#!/usr/bin/env node
// @tag:parent-console
// Web console: `build` writes dist/web/; `dev` rebuilds on change and serves it under BASE with
// /api proxied to the BFF (--bff), or to a BFF started here on top of the test fixture (--mock).
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { extname, join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as esbuild from 'esbuild'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'dist/web')
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    // The browser talks only to the BFF now; 5181 is its port in the development port registry.
    bff: { type: 'string', default: process.env.TIMELIMIT_BFF ?? 'http://127.0.0.1:5181' },
    mock: { type: 'boolean' },
    // Shared registry of development ports; 5173 is taken by another project's vite.
    port: { type: 'string', default: '5180' },
    base: { type: 'string', default: '/console/' }
  }
})

const buildOptions = {
  entryPoints: [join(root, 'src/web/main.tsx')],
  bundle: true,
  format: 'esm',
  target: ['safari15', 'chrome100'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outfile: join(out, 'app.js'),
  minify: positionals[0] === 'build',
  sourcemap: positionals[0] === 'build' ? false : 'inline',
  legalComments: 'none',
  logLevel: 'info'
}

function copyStatic () {
  mkdirSync(out, { recursive: true })
  cpSync(join(root, 'src/web/static'), out, { recursive: true })
  const config = { ...(process.env.GOOGLE_CLIENT_ID ? { googleClientId: process.env.GOOGLE_CLIENT_ID } : {}) }
  writeFileSync(join(out, 'config.json'), JSON.stringify(config) + '\n')
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

let mockDeviceTokenAt = 0
let mockFamilyWithoutChild = false

function hideChildren (fixture) {
  fixture.users = { version: 'no-child', data: fixture.users.data.filter((u) => u.type !== 'child') }
}

function mockApi (fullStatus, path, body) {
  const fixture = fullStatus()
  const today = Math.floor((Date.now() + 3 * 3600000) / 86400000)
  const shift = today - 20710
  for (const item of fixture.usedTimes) for (const t of item.times) t.day += shift
  for (const base of fixture.categoryBase) if (base.extraTimeDay >= 0) base.extraTimeDay += shift
  fixture.apiLevel = 12
  // @tag:child-request @tag:parent-code
  fixture.users.parentCodeSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const asked = Date.now() - 6 * 60000
  fixture.users.data.find((u) => u.type === 'child').requests = [{
    id: 'rq0001', packageName: 'com.roblox.client', categoryId: 'games1', deviceId: 'devC01',
    word: 'можно ещё полчасика, мы с Петей строим', createdAt: asked, expiresAt: asked + 30 * 60000
  }, {
    id: 'rq0002', packageName: 'com.robtopx.geometryjump', categoryId: '', deviceId: 'devC01',
    word: '', createdAt: asked + 60000, expiresAt: asked + 31 * 60000
  }]
  // @tag:app-rule @tag:new-app @tag:device-state
  const kid = fixture.users.data.find((u) => u.type === 'child')
  kid.appRules = [{ packageName: 'com.roblox.client', days: 96, limitMinutes: -1, usedDay: 0, usedMs: 0 }]
  kid.newApps = [{ packageName: 'com.robtopx.geometryjump', title: 'Geometry Dash', section: 'game', installedAt: Date.now() - 75 * 60000, deviceId: 'devC01' }]
  fixture.deviceStates = [{ deviceId: 'devC01', seen: Date.now() - 20000, app: 'com.game', appSince: Date.now() - 600000 }]
  if (mockFamilyWithoutChild) hideChildren(fixture)
  switch (path) {
    case '/auth/send-mail-login-code-v2': return { mailLoginToken: 'mock' }
    case '/auth/sign-in-by-mail-code':
      if (body.receivedCode === '000') return [403, 'wrong code']
      return { mailAuthToken: body.receivedCode === 'new' ? 'mock-new' : 'mock' }
    case '/parent/get-status-by-mail-address':
      return { status: body.mailAuthToken === 'mock-new' ? 'without family' : 'with family', mail: 'parent@example.com', canCreateFamily: true, alwaysPro: true }
    case '/session/create-family':
      console.log('create-family', body.parentName, body.parentPassword.hash.slice(0, 7), body.timeZone)
      mockFamilyWithoutChild = true
      return { sessionToken: 's:' + 'm'.repeat(32), sessionId: 'sess01', familyId: 'fam1', userId: 'parnt1' }
    case '/parent/sign-in-into-family':
      mockFamilyWithoutChild = false
      return { deviceAuthToken: 'mock-token', ownDeviceId: 'devP01', data: fixture }
    case '/session/sign-in':
      return { sessionToken: 's:' + 'm'.repeat(32), sessionId: 'sess01', familyId: 'fam1', userId: 'parnt1' }
    case '/session/revoke':
      return { ok: true }
    case '/parent/create-add-device-token':
      mockDeviceTokenAt = Date.now()
      return { token: 'apple river stone cloud seven', deviceId: 'devNew1' }
    case '/sync/pull-status': {
      const joined = mockDeviceTokenAt > 0 && Date.now() - mockDeviceTokenAt > 15000
      if (joined) fixture.devices.data.push({ ...fixture.devices.data[0], deviceId: 'devNew1', name: 'Планшет', model: 'mock tablet', currentUserId: '' })
      if (body.status.users !== fixture.users.version) return fixture
      return { apiLevel: fixture.apiLevel, fullVersion: 1, deviceStates: fixture.deviceStates, ...(joined ? { devices: { ...fixture.devices, version: `joined-${mockDeviceTokenAt}` } } : {}) }
    }
    case '/parent/get-app-usage': {
      const apps = { 'com.game': 52, 'com.google.android.youtube': 38, 'org.school': 25, 'com.roblox.client': 0 }
      const items = []
      for (let day = body.fromDay; day <= body.toDay; day++) {
        for (const [packageName, minutes] of Object.entries(apps)) {
          const ms = Math.round(minutes * (0.6 + ((day * 7 + packageName.length) % 9) / 10) * 60000)
          if (ms > 0) items.push({ deviceId: 'devC01', day, packageName, ms })
        }
      }
      return { items }
    }
    case '/sync/push-actions':
      for (const item of body.actions) console.log('push', item.sequenceNumber, item.encodedAction)
      if (body.actions.some((item) => JSON.parse(item.encodedAction).type === 'ADD_USER')) mockFamilyWithoutChild = false
      return { shouldDoFullSync: false }
    default: return [404, 'unknown mock endpoint']
  }
}

/**
 * The mock runs the real BFF against the test fixture: views, intents and events then behave as in
 * production, and only the sync server is made up. Built with esbuild because node does not run
 * TypeScript sources on its own.
 */
async function startMockBff () {
  const file = join(root, 'build/dev-bff.mjs')
  await esbuild.build({
    stdin: {
      contents: "export { Bff } from './src/bff/server.ts'\nexport { BffStore } from './src/bff/store.ts'\nexport { TimelimitApi } from './src/core/api.ts'\nexport { fullStatus } from './test/fixtures/full-status.ts'\n",
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: file,
    logLevel: 'warning'
  })
  const { Bff, BffStore, TimelimitApi, fullStatus } = await import(pathToFileURL(file))
  const fetchImpl = async (url, init) => {
    const result = mockApi(fullStatus, new URL(url).pathname, init?.body ? JSON.parse(init.body) : {})
    const [status, payload] = Array.isArray(result) ? result : [200, result]
    return status === 200 ? Response.json(payload) : new Response(payload, { status })
  }
  const bff = new Bff({ store: new BffStore(':memory:'), api: new TimelimitApi({ serverUrl: 'https://mock.invalid', fetchImpl }) })
  await bff.listen(0)
  return `http://127.0.0.1:${bff.server.address().port}`
}

function proxy (req, res, target) {
  const upstream = new URL(req.url, target)
  const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest
  const call = send(upstream, { method: req.method, headers: { ...req.headers, host: upstream.host } }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers)
    answer.pipe(res)
  })
  call.on('error', (ex) => { res.writeHead(502); res.end(`proxy to ${target} failed: ${ex.message}`) })
  req.pipe(call)
}

async function serve () {
  const context = await esbuild.context(buildOptions)
  copyStatic()
  await context.watch()
  const base = options.base
  const api = options.mock ? await startMockBff() : options.bff
  createServer((req, res) => {
    const path = new URL(req.url, 'http://local').pathname
    if (path === '/' || path === base.slice(0, -1)) { res.writeHead(302, { location: base }); res.end(); return }
    if (path.startsWith(base)) {
      const file = normalize(join(out, path.slice(base.length) || 'index.html'))
      if (!file.startsWith(out) || !existsSync(file)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
      res.end(readFileSync(file))
      return
    }
    proxy(req, res, api)
  }).on('error', (ex) => {
    // Never fall back to a neighbouring port: a phone forwarding this one would silently reach the other server.
    const why = ex.code === 'EADDRINUSE'
      ? `port ${options.port} is already taken — stop whatever listens on it (ss -ltnp | grep :${options.port}), or pass --port with a number free in the development port registry`
      : ex.message
    console.error(`cannot serve the web console: ${why}`)
    process.exit(1)
  }).listen(Number(options.port), '127.0.0.1', () => {
    console.log(`web console: http://127.0.0.1:${options.port}${base} — /api ${options.mock ? `answered by a BFF on the test fixture (${api})` : `proxied to ${api}`}`)
  })
}

if (positionals[0] === 'build') {
  copyStatic()
  await esbuild.build(buildOptions)
} else if (positionals[0] === 'dev') {
  await serve()
} else {
  console.error('usage: node scripts/web.mjs build | dev [--bff URL | --mock] [--port 5180] [--base /console/]')
  process.exitCode = 1
}
