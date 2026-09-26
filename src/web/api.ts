import type { ScheduleKind } from '../shared/schedules.ts'
import { type BanSpec, BffError, type Failure, type Loophole } from './format.ts'

// @tag:parent-console

/**
 * What the page asks of its BFF: a view per screen, an intent per button, one event to listen to.
 * The shapes below are what the screens read — deliberately narrower than what `src/bff/views.ts`
 * sends, because the browser knows its own views and nothing about the sync protocol
 * (docs/implementation/web-admin.md, "Контракт BFF ⇄ браузер").
 */

export interface Person {
  id: string
  name: string
  mail: string
  timeZone: string
  disableLimitsUntil: number
}

export interface Device {
  deviceId: string
  name: string
  model: string
  currentUserId: string
  exFlags: number // @tag:device-flags
  cProtectionLevel: string
}

export interface Rule {
  id: string
  dayMask: number
  maxTime: number
  start: number
  end: number
  session: number
  pause: number
  perDay: boolean
  extraTime: boolean
  e?: number
}

export interface CategoryNow {
  id: string
  title: string
  depth: number
  usedTodayMs: number
  limitNowMs: number | null
  remaining: { includingExtraTime: number } | null
  extraTimeMs: number
  limitsDisabledUntil: number | null
  temporarilyBlocked: { until: number | null } | null
  blockedNow: 'temporarily-blocked' | 'ban' | 'legacy-blocked-time' | 'limit-reached' | null
  blockedByParent: string | null
  countsTimeNow: boolean
  dailyLimits: Rule[]
  parentId: string | null
  /** Every app the category holds, whether or not it was used today. */
  appList: AppFace[]
}

export interface Ban extends BanSpec {
  categoryIds: string[]
  activeNow: boolean
  /** Only in the bans view: which of the two switches the ban belongs to, if any. */
  kind?: ScheduleKind | null
}

export interface NamedCategory { id: string, title: string }

/** An app as a row draws it; `icon` is a path under the BFF, `null` when neither Google Play nor a tablet gave one. */
// @tag:app-icon
export interface AppFace { packageName: string, title: string, icon: string | null }

export interface AppAllowance { packageName: string, title: string, until: number }

// @tag:app-usage @tag:new-app @tag:device-state @tag:app-rule
export interface DeviceStatus { online: boolean, seen: number | null, app: string | null, todayMs: number | null }
export interface DeviceWithStatus extends Device { status: DeviceStatus }
export interface AppTime extends AppFace { ms: number, byDevice: Record<string, number>, category: NamedCategory | null }
export interface NewApp extends AppFace { section: string, installedAt: number, deviceId: string, device: string, guess: string | null }
export interface AppRule { days: number, limitMinutes: number }

export interface AppsView {
  child: Person
  newApps: NewApp[]
  categories: Array<NamedCategory & { apps: Array<AppFace & { weekMs: number, rule: AppRule | null, device: string | null }> }>
  other: Array<AppFace & { weekMs: number, rule: AppRule | null }>
  appUsageProblem: string | null
}

export interface AppCardView extends AppFace {
  isNew: boolean
  category: NamedCategory | null
  categories: NamedCategory[]
  days: Array<{ day: number, ms: number }> | null
  todayMs: number | null
  averageMs: number | null
  devices: Array<{ deviceId: string, name: string, weekMs: number | null, category: NamedCategory | null }>
  rule: AppRule | null
  allowanceUntil: number | null
  appUsageProblem: string | null
}

export interface DevicesView {
  devices: DeviceWithStatus[]
  unassigned: DeviceWithStatus[]
  appUsageProblem: string | null
}

export interface NowView {
  child: Person
  categories: CategoryNow[]
  bans: Ban[]
  unassignedApps: unknown[] | null
  devices: DeviceWithStatus[]
  allowances: AppAllowance[]
  apps: AppTime[] | null
  newApps: NewApp[]
  appRules: Array<AppRule & { packageName: string }>
  loopholes: Loophole[]
  appUsageProblem: string | null
  activeSchedule: ScheduleKind | null
  sleep: { start: number, end: number } | null
  dayEndsAt: number
}

// @tag:child-request
export interface RequestItem {
  id: string
  packageName: string
  title: string
  device: string
  word: string
  createdAt: number
  expiresAt: number
  status: 'waiting' | 'expired' | 'allowed' | 'denied'
  category: { id: string, title: string, usedTodayMs: number, limitNowMs: number | null } | null
  categoryIsFallback: boolean
  reason: string | null
  answer: { kind: 'app' | 'category' | 'deny', until: number, word: string, parentName: string, at: number, repeatAfter: number } | null
}

export interface RequestsView {
  child: Person
  dayEndsAt: number
  waiting: RequestItem[]
  earlier: RequestItem[]
  supported: boolean
}

// @tag:parent-code
export type CodeView = { code: string, validUntil: number } | null

export interface BansView {
  bans: Ban[]
  legacyBans: Ban[]
  categories: Array<NamedCategory & { parentId: string | null }>
  scheduleDefaults: Record<ScheduleKind, string[]>
}

export interface UrlFilter { enabled: boolean, allow: string[], block: string[] }

export interface SitesView {
  urlFilter: UrlFilter
  supported: boolean
}

export interface CategoryView {
  id: string
  title: string
  rules: Rule[]
  apps: Array<{ packageName: string, title: string }>
  week: Array<{ day: number, ms: number }>
}

export interface FamilyView {
  children: Person[]
  parents: Person[]
  devices: Device[]
  signedInUserId: string
  /** Address of the sync server — what a child's device must be pointed at, not where this page lives. */
  serverUrl: string
  apiLevel: number
  message?: string
  waitingRequests: Record<string, number>
}

export interface AddDeviceToken { token: string, deviceId: string }

export interface MailStatus {
  status: 'with family' | 'without family'
  mail: string
  canCreateFamily: boolean
}

export interface WebConfig { googleClientId?: string, apiUrl?: string }

let apiUrl = ''

export const apiBase = (): string => apiUrl

export async function loadWebConfig (): Promise<WebConfig> {
  let config: WebConfig = {}
  try {
    const response = await fetch('./config.json', { cache: 'no-cache' })
    if (response.ok) config = await response.json() as WebConfig
  } catch {
    config = {}
  }
  apiUrl = (config.apiUrl ?? location.origin + '/api').replace(/\/+$/, '')
  return config
}

async function readFailure (response: Response): Promise<Failure> {
  try {
    const body = await response.json() as { error?: Failure }
    if (body.error?.kind) return body.error
  } catch {
    // an answer that is not the agreed failure shape is itself a defect of the pair, reported as one
  }
  return { kind: 'internal', title: `веб-админка ответила HTTP ${response.status}`, hint: 'обновите страницу; если повторяется — смотрите журнал службы timelimit-bff', signInAgain: false }
}

async function call<T> (path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiUrl + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (ex) {
    throw new BffError({
      kind: 'sync-unreachable',
      title: `${apiUrl} не отвечает (${ex instanceof Error ? ex.message : String(ex)})`,
      signInAgain: false
    })
  }
  if (!response.ok) throw new BffError(await readFailure(response))
  return await response.json() as T
}

export interface ViewAnswer<T> { data: T, staleSince?: number }

export const view = <T>(name: string, childId?: string): Promise<ViewAnswer<T>> =>
  call<ViewAnswer<T>>(`/view/${name}${childId ? `?child=${encodeURIComponent(childId)}` : ''}`)

/** Answers with the fresh view of `body.view`, so a pressed button needs no second request. */
export const intent = <T>(name: string, body: Record<string, unknown>): Promise<{ data?: T }> =>
  call<{ data?: T }>(`/intent/${name}`, body)

export const signIn = {
  mailCode: (mail: string) => call<{ mailLoginToken: string }>('/signin/mail-code', { mail, locale: 'ru' }),
  byMailCode: (mailLoginToken: string, receivedCode: string) => call<{ mailAuthToken: string }>('/signin/by-mail-code', { mailLoginToken, receivedCode }),
  byGoogle: (idToken: string) => call<{ mailAuthToken: string }>('/signin/by-google', { idToken, locale: 'ru' }),
  mailStatus: (mailAuthToken: string) => call<MailStatus>('/signin/mail-status', { mailAuthToken }),
  session: (mailAuthToken: string) => call<{ userId: string }>('/signin/session', { mailAuthToken }),
  createFamily: (form: { mailAuthToken: string, password: string, parentName: string, timeZone: string }) =>
    call<{ userId: string }>('/signin/create-family', form)
}

export const signOut = (): Promise<unknown> => call('/signout', {})

export const createAddDeviceToken = (): Promise<AddDeviceToken> => call<AddDeviceToken>('/device/add-token', {})

/** One payload-free "changed" per family change; `EventSource` reconnects on its own. */
export function listenChanged (onChanged: () => void): () => void {
  const source = new EventSource(apiUrl + '/events', { withCredentials: true })
  source.addEventListener('changed', () => onChanged())
  return () => source.close()
}
