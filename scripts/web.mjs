#!/usr/bin/env node
// @tag:parent-console
// Web console: `build` writes dist/web/; `dev` rebuilds on change and serves it under BASE with the
// sync API proxied to --server, or answered from the test fixture with --mock.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { extname, join, normalize } from 'node:path'
import { parseArgs } from 'node:util'
import * as esbuild from 'esbuild'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'dist/web')
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string', default: process.env.TIMELIMIT_SERVER ?? 'https://child-time.pasha-home.ru' },
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

function mockApi (path, body) {
  const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/full-status.json'), 'utf8'))
  const today = Math.floor((Date.now() + 3 * 3600000) / 86400000)
  const shift = today - 20710
  for (const item of fixture.usedTimes) for (const t of item.times) t.day += shift
  for (const base of fixture.categoryBase) if (base.extraTimeDay >= 0) base.extraTimeDay += shift
  fixture.apiLevel = 10
  if (mockFamilyWithoutChild) hideChildren(fixture)
  switch (path) {
    case '/auth/send-mail-login-code-v2': return { mailLoginToken: 'mock' }
    case '/auth/sign-in-by-mail-code':
      if (body.receivedCode === '000') return [403, 'wrong code']
      return { mailAuthToken: body.receivedCode === 'new' ? 'mock-new' : 'mock' }
    case '/parent/get-status-by-mail-address':
      return { status: body.mailAuthToken === 'mock-new' ? 'without family' : 'with family', mail: 'parent@example.com', canCreateFamily: true, alwaysPro: true }
    case '/parent/create-family':
      console.log('create-family', body.parentName, body.parentPassword.hash.slice(0, 7), body.timeZone)
      mockFamilyWithoutChild = true
      hideChildren(fixture)
      return { deviceAuthToken: 'mock-token', ownDeviceId: 'devP01', data: fixture }
    case '/parent/sign-in-into-family':
      mockFamilyWithoutChild = false
      return { deviceAuthToken: 'mock-token', ownDeviceId: 'devP01', data: fixture }
    case '/parent/create-add-device-token':
      mockDeviceTokenAt = Date.now()
      return { token: 'apple river stone cloud seven', deviceId: 'devNew1' }
    case '/sync/pull-status': {
      const joined = mockDeviceTokenAt > 0 && Date.now() - mockDeviceTokenAt > 15000
      if (joined) fixture.devices.data.push({ ...fixture.devices.data[0], deviceId: 'devNew1', name: 'Планшет', model: 'mock tablet', currentUserId: '' })
      if (body.status.users !== fixture.users.version) return fixture
      return { apiLevel: fixture.apiLevel, fullVersion: 1, ...(joined ? { devices: { ...fixture.devices, version: `joined-${mockDeviceTokenAt}` } } : {}) }
    }
    case '/sync/push-actions':
      for (const item of body.actions) console.log('push', item.sequenceNumber, item.encodedAction)
      if (body.actions.some((item) => JSON.parse(item.encodedAction).type === 'ADD_USER')) mockFamilyWithoutChild = false
      return { shouldDoFullSync: false }
    default: return [404, 'unknown mock endpoint']
  }
}

function proxy (req, res) {
  const target = new URL(req.url, options.server)
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const upstream = send(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers)
    answer.pipe(res)
  })
  upstream.on('error', (ex) => { res.writeHead(502); res.end(`proxy to ${options.server} failed: ${ex.message}`) })
  req.pipe(upstream)
}

async function serve () {
  const context = await esbuild.context(buildOptions)
  copyStatic()
  await context.watch()
  const base = options.base
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
    if (!options.mock) { proxy(req, res); return }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const result = mockApi(path, raw ? JSON.parse(raw) : {})
      const [status, payload] = Array.isArray(result) ? result : [200, result]
      res.writeHead(status, { 'content-type': status === 200 ? 'application/json' : 'text/plain' })
      res.end(status === 200 ? JSON.stringify(payload) : payload)
    })
  }).on('error', (ex) => {
    // Never fall back to a neighbouring port: a phone forwarding this one would silently reach the other server.
    const why = ex.code === 'EADDRINUSE'
      ? `port ${options.port} is already taken — stop whatever listens on it (ss -ltnp | grep :${options.port}), or pass --port with a number free in the development port registry`
      : ex.message
    console.error(`cannot serve the web console: ${why}`)
    process.exit(1)
  }).listen(Number(options.port), '127.0.0.1', () => {
    console.log(`web console: http://127.0.0.1:${options.port}${base} — API ${options.mock ? 'from the test fixture' : `proxied to ${options.server}`}`)
  })
}

if (positionals[0] === 'build') {
  copyStatic()
  await esbuild.build(buildOptions)
} else if (positionals[0] === 'dev') {
  await serve()
} else {
  console.error('usage: node scripts/web.mjs build | dev [--server URL | --mock] [--port 5180] [--base /console/]')
  process.exitCode = 1
}
