import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { TimelimitApi, TOKEN_LIFETIME_MS } from '../core/api.ts'
import { ParentConsoleError } from '../core/errors.ts'
import { type FamilyState, toClientStatus } from '../core/state.ts'
import { SyncClient } from '../core/session.ts'
import { describeFailure, SessionGoneError } from './failures.ts'
import { BadRequestError, buildIntent } from './intents.ts'
import { type BffStore, type StoredSession } from './store.ts'
import { buildView, type ViewContext } from './views.ts'

// @tag:parent-console

export interface BffOptions {
  store: BffStore
  api: TimelimitApi
  basePath?: string
  /** How often the family state is re-pulled, in ms; see docs/implementation/web-admin.md. */
  pollMs?: number
  /** Tightened interval used while an add-device code is outstanding. */
  fastPollMs?: number
  now?: () => number
}

const COOKIE_NAME = 'tlp.session'
const DEFAULT_POLL_MS = 30_000
const DEFAULT_FAST_POLL_MS = 5_000

interface Watcher {
  cookieId: string
  response: ServerResponse
}

/**
 * The back end for the web console: the browser gets views and intents, the sync protocol stays
 * here. Notifications go out as Server-Sent Events — one payload-free "changed", after which the
 * browser re-requests the open view.
 */
export class Bff {
  private readonly store: BffStore
  private readonly api: TimelimitApi
  private readonly basePath: string
  private readonly pollMs: number
  private readonly fastPollMs: number
  private readonly now: () => number
  private readonly watchers = new Set<Watcher>()
  private readonly lastKnown = new Map<string, { state: FamilyState, at: number, failedSince?: number }>()
  private readonly work = new Map<string, Promise<unknown>>()
  private fastUntil = 0
  private timer: NodeJS.Timeout | undefined
  readonly server: Server

  constructor ({ store, api, basePath = '/api', pollMs = DEFAULT_POLL_MS, fastPollMs = DEFAULT_FAST_POLL_MS, now = Date.now }: BffOptions) {
    this.store = store
    this.api = api
    this.basePath = basePath.replace(/\/+$/, '')
    this.pollMs = pollMs
    this.fastPollMs = fastPollMs
    this.now = now
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => this.fail(response, error))
    })
  }

  listen (port: number, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      // A taken port stops the start: sharing one silently sends a phone on `adb reverse` to the
      // wrong server, and the fault then looks like a defect of the app — see the dev-ports rule.
      this.server.once('error', (error: NodeJS.ErrnoException) => {
        reject(error.code === 'EADDRINUSE'
          ? new ParentConsoleError(
            `${host}:${port} is already taken`,
            'another BFF or dev server holds the port: find it with `ss -ltnp` and stop it, or set TIMELIMIT_BFF_PORT'
          )
          : error)
      })
      this.server.listen(port, host, () => {
        this.timer = setInterval(() => { void this.pollAll() }, this.fastPollMs)
        this.timer.unref()
        resolve()
      })
    })
  }

  async close (): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    for (const watcher of this.watchers) watcher.response.end()
    this.watchers.clear()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private async handle (request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://bff.local')
    if (!url.pathname.startsWith(this.basePath + '/')) {
      return this.fail(response, new ParentConsoleError(`no such path: ${url.pathname}`, `the BFF serves ${this.basePath}/`))
    }
    const path = url.pathname.slice(this.basePath.length + 1)

    if (path.startsWith('signin/')) return this.handleSignIn(path.slice('signin/'.length), request, response)
    if (path === 'signout') return this.handleSignOut(request, response)
    if (path === 'events') return this.handleEvents(request, response)
    if (path.startsWith('view/')) return this.handleView(path.slice('view/'.length), url, request, response)
    if (path.startsWith('intent/')) return this.handleIntent(path.slice('intent/'.length), url, request, response)
    if (path === 'device/add-token') return this.handleAddDeviceToken(request, response)

    this.fail(response, new ParentConsoleError(`no such endpoint: ${path}`, 'known: signin/*, signout, events, view/*, intent/*, device/add-token'))
  }

  // --- вход -------------------------------------------------------------------------------

  private async handleSignIn (step: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request)
    if (step === 'mail-code') {
      const mailLoginToken = await this.api.sendMailLoginCode({ mail: requireString(body, 'mail'), locale: requireString(body, 'locale') })
      return send(response, 200, { mailLoginToken })
    }
    if (step === 'mail-status') {
      return send(response, 200, await this.api.getStatusByMailAuthToken({ mailAuthToken: requireString(body, 'mailAuthToken') }))
    }
    if (step === 'by-mail-code') {
      const mailAuthToken = await this.api.signInByMailCode({
        mailLoginToken: requireString(body, 'mailLoginToken'),
        receivedCode: requireString(body, 'receivedCode')
      })
      return send(response, 200, { mailAuthToken })
    }
    if (step === 'by-google') {
      const mailAuthToken = await this.api.signInByGoogle({ idToken: requireString(body, 'idToken'), locale: requireString(body, 'locale') })
      return send(response, 200, { mailAuthToken })
    }
    if (step === 'session') {
      const result = await this.api.signInSession({ mailAuthToken: requireString(body, 'mailAuthToken') })
      const stored = this.store.createSession(result)
      response.setHeader('Set-Cookie', cookie(COOKIE_NAME, stored.cookieId))
      return send(response, 200, { userId: stored.userId, familyId: stored.familyId })
    }
    this.fail(response, new BadRequestError(`no such sign-in step: ${step}`))
  }

  private async handleSignOut (request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.sessionOf(request)
    if (session) {
      try {
        await this.api.revokeSession({ sessionToken: session.sessionToken })
      } finally {
        this.store.deleteSession(session.cookieId)
        this.lastKnown.delete(session.cookieId)
      }
    }
    response.setHeader('Set-Cookie', cookie(COOKIE_NAME, '', 0))
    send(response, 200, { ok: true })
  }

  // --- виды и намерения -------------------------------------------------------------------

  private async handleView (name: string, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.requireSession(request)
    const { state, staleSince } = await this.stateOf(session)
    const data = buildView(name, this.viewContext(session, state, url))
    send(response, 200, staleSince === undefined ? { data } : { data, staleSince })
  }

  private async handleIntent (name: string, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.requireSession(request)
    const body = await readJson(request)
    const result = await this.serial(session.cookieId, async () => {
      const client = this.clientFor(session)
      const state = await client.sync()
      const actions = buildIntent(name, { state, now: this.now() }, body)
      const pushed = await client.push(actions)
      this.remember(session.cookieId, pushed.state)
      return pushed.state
    })
    this.notify(session.cookieId)
    const view = typeof body.view === 'string' ? body.view : undefined
    send(response, 200, view ? { data: buildView(view, this.viewContext(session, result, url)) } : { ok: true })
  }

  private viewContext (session: StoredSession, state: FamilyState, url: URL): ViewContext {
    return {
      state,
      now: this.now(),
      childId: url.searchParams.get('child') ?? undefined,
      serverUrl: this.api.serverUrl,
      signedInUserId: session.userId
    }
  }

  // --- оповещения -------------------------------------------------------------------------

  private handleEvents (request: IncomingMessage, response: ServerResponse): void {
    const session = this.requireSession(request)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    response.write(': connected\n\n')
    const watcher: Watcher = { cookieId: session.cookieId, response }
    this.watchers.add(watcher)
    request.on('close', () => { this.watchers.delete(watcher) })
  }

  private notify (cookieId: string): void {
    for (const watcher of this.watchers) {
      if (watcher.cookieId === cookieId) watcher.response.write('event: changed\ndata: {}\n\n')
    }
  }

  /**
   * The code a child's device enters to join the family. Until it is used the family changes
   * without any action of ours, so the poll tightens — the one case the browser used to poll
   * every five seconds for.
   */
  private async handleAddDeviceToken (request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.requireSession(request)
    const token = await this.serial(session.cookieId, () => this.clientFor(session).createAddDeviceToken())
    this.fastUntil = this.now() + TOKEN_LIFETIME_MS
    send(response, 200, token)
  }

  // --- состояние --------------------------------------------------------------------------

  private clientFor (session: StoredSession): SyncClient {
    return new SyncClient({
      api: this.api,
      subject: { kind: 'session', authToken: session.sessionToken, sessionId: session.sessionId, userId: session.userId },
      storage: this.store.storageFor(session.cookieId)
    })
  }

  private remember (cookieId: string, state: FamilyState): void {
    this.lastKnown.set(cookieId, { state, at: this.now() })
  }

  /**
   * Serves the freshest state it can. When the sync server is unreachable the last known state is
   * still served — but marked with `staleSince`, never silently.
   */
  private async stateOf (session: StoredSession): Promise<{ state: FamilyState, staleSince?: number }> {
    const known = this.lastKnown.get(session.cookieId)
    if (known && this.now() - known.at < this.currentPollMs()) {
      return known.failedSince === undefined ? { state: known.state } : { state: known.state, staleSince: known.failedSince }
    }
    try {
      const state = await this.serial(session.cookieId, () => this.clientFor(session).sync())
      this.remember(session.cookieId, state)
      return { state }
    } catch (error) {
      const failedSince = known?.failedSince ?? this.now()
      if (known) {
        this.lastKnown.set(session.cookieId, { ...known, failedSince })
        if (describeFailure(error).failure.kind === 'sync-unreachable') return { state: known.state, staleSince: failedSince }
      }
      throw error
    }
  }

  private currentPollMs (): number {
    return this.now() < this.fastUntil ? this.fastPollMs : this.pollMs
  }

  private async pollAll (): Promise<void> {
    if (this.watchers.size === 0) return
    for (const session of this.store.listSessions()) {
      const known = this.lastKnown.get(session.cookieId)
      if (known && this.now() - known.at < this.currentPollMs()) continue
      try {
        const state = await this.serial(session.cookieId, () => this.clientFor(session).sync())
        const changed = known === undefined || fingerprint(known.state) !== fingerprint(state)
        this.remember(session.cookieId, state)
        if (changed) this.notify(session.cookieId)
      } catch {
        // The next view request reports the failure to the person; a background poll has no reader.
        if (known) this.lastKnown.set(session.cookieId, { ...known, failedSince: known.failedSince ?? this.now() })
      }
    }
  }

  /** One session talks to the sync server one request at a time, so a poll never merges over a push. */
  private serial<T> (cookieId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.work.get(cookieId) ?? Promise.resolve()
    const next = previous.then(work, work)
    this.work.set(cookieId, next.catch(() => undefined))
    return next
  }

  // --- сессия -----------------------------------------------------------------------------

  private sessionOf (request: IncomingMessage): StoredSession | undefined {
    const cookieId = readCookie(request.headers.cookie, COOKIE_NAME)
    if (!cookieId) return undefined
    const session = this.store.findSession(cookieId)
    if (session) this.store.touchSession(cookieId)
    return session
  }

  private requireSession (request: IncomingMessage): StoredSession {
    const session = this.sessionOf(request)
    if (!session) {
      throw new SessionGoneError('no parent session for this browser', 'sign in again')
    }
    return session
  }

  private fail (response: ServerResponse, error: unknown): void {
    const { status, failure } = describeFailure(error)
    if (response.headersSent) {
      response.end()
      return
    }
    send(response, status, { error: failure })
  }
}

/**
 * What the family state looks like to the protocol: the per-collection versions the client would
 * send in the next pull. Two states with the same fingerprint hold the same data.
 * `fullVersion` is not usable here — it carries the licence status, not a change counter.
 */
const fingerprint = (state: FamilyState): string => JSON.stringify(toClientStatus(state))

function send (response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  response.end(text)
}

async function readJson (request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new BadRequestError('request body is larger than 1 MB')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BadRequestError('request body must be a JSON object')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw error instanceof BadRequestError ? error : new BadRequestError('request body is not valid JSON')
  }
}

function requireString (body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value === '') throw new BadRequestError(`${field} must be a non-empty string`)
  return value
}

function readCookie (header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function cookie (name: string, value: string, maxAgeSeconds = 90 * 24 * 60 * 60): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`
}
