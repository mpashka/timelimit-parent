import type { AppUsageItem } from '../core/api.ts'
import { appCard, appTimes, appTitle, deviceStatus, newApps, usageDays } from '../core/apps.ts'
import { ParentConsoleError } from '../core/errors.ts'
import { dailyLimitRules } from '../core/operations.ts'
import { childOverview, findChild, usageHistory } from '../core/overview.ts'
import { parentCode } from '../core/parent-code.ts'
import { NEW_UI_API_LEVEL, PARENT_SESSION_API_LEVEL, URL_FILTER_API_LEVEL } from '../core/protocol.ts'
import { answerCategoryId, requestStatus } from '../core/requests.ts'
import { defaultScheduleCategories } from '../core/schedules.ts'
import { childCategories, children, type FamilyState, parents } from '../core/state.ts'
import { scheduleKind, sleepWindow } from '../shared/schedules.ts'
import { localTime, timestampAt } from '../shared/time.ts'

// @tag:parent-console

/**
 * What one screen of the web console draws, computed here instead of in the browser.
 * The shapes deliberately mirror what `overview.ts` already returns — see
 * docs/implementation/web-admin.md, "Контракт BFF ⇄ браузер".
 */
export interface ViewEnvelope<T> {
  data: T
  /** Set when the sync server was unreachable and this is the last state we know. */
  staleSince?: number
}

export interface ViewContext {
  state: FamilyState
  now: number
  childId?: string
  /**
   * Where the family lives, as the person would type it. Not the address the BFF dials: inside the
   * compose project that is `http://api:8080`, and a header saying so would name a host nobody can
   * reach.
   */
  serverUrl: string
  signedInUserId: string
  /** Time per app for the child's last seven days, fetched for the views that show it; `problem` says why it is missing. */
  appUsage?: { items: AppUsageItem[] } | { problem: string }
}

/** Views that need `/parent/get-app-usage`; the server answers it separately from the sync status. */
export const USAGE_VIEWS = ['now', 'apps', 'devices']
export const needsAppUsage = (name: string): boolean => USAGE_VIEWS.includes(name) || name.startsWith('app/')

const usageItems = (context: ViewContext): AppUsageItem[] | null =>
  context.appUsage !== undefined && 'items' in context.appUsage ? context.appUsage.items : null
const usageProblem = (context: ViewContext): string | null =>
  context.appUsage !== undefined && 'problem' in context.appUsage ? context.appUsage.problem : null

// @tag:app-usage @tag:new-app @tag:device-state
function appsToday (context: ViewContext, childId: string) {
  const usage = usageItems(context)
  const { toDay } = usageDays(context.state, childId, context.now)
  return {
    apps: usage === null ? null : appTimes(context.state, childId, usage, toDay, toDay),
    newApps: newApps(context.state, childId),
    appUsageProblem: usageProblem(context)
  }
}

function devicesOf (context: ViewContext, childId: string) {
  const usage = usageItems(context)
  const { toDay } = usageDays(context.state, childId, context.now)
  return context.state.devices.data
    .filter((device) => device.currentUserId === childId)
    .map((device) => ({ ...device, status: deviceStatus(context.state, device.deviceId, context.now, usage, toDay) }))
}

const HISTORY_DAYS = 7

function requireChild (context: ViewContext): string {
  const child = findChild(context.state, context.childId)
  return child.id
}

/** «До конца дня» ends where Sleep begins, and at midnight when the child has no Sleep. */
function dayEndsAt (context: ViewContext, bans: Array<{ days: number, start: number, end: number }>, timeZone: string): { dayEndsAt: number, sleep: { start: number, end: number } | null } {
  const sleep = sleepWindow(bans, context.now, timeZone)
  const midnight = timestampAt({ dayOfEpoch: localTime(context.now, timeZone).dayOfEpoch + 1, minuteOfDay: 0 }, timeZone)
  return { dayEndsAt: sleep !== null && sleep.start > context.now && sleep.start < midnight + 6 * 3600_000 ? sleep.start : midnight, sleep }
}

const viewNow = (context: ViewContext) => {
  const childId = requireChild(context)
  const overview = childOverview(context.state, childId, context.now)
  // @tag:app-allowance
  const allowances = (overview.child.appAllowances ?? [])
    .filter((item) => item.until > context.now)
    .map((item) => ({ ...item, title: appTitle(context.state, item.packageName) }))
  const categoryViews = childCategories(context.state, childId)
  return {
    ...overview,
    categories: overview.categories.map((category) => {
      const own = categoryViews.find((item) => item.id === category.id)
      return { ...category, dailyLimits: own ? dailyLimitRules(own) : [] }
    }),
    ...dayEndsAt(context, overview.bans, overview.child.timeZone),
    allowances,
    activeSchedule: overview.bans.filter((ban) => ban.activeNow).map((ban) => scheduleKind(ban)).find((kind) => kind !== null) ?? null,
    ...appsToday(context, childId),
    devices: devicesOf(context, childId)
  }
}

// @tag:app-usage
const viewApps = (context: ViewContext) => {
  const childId = requireChild(context)
  const { fromDay, toDay } = usageDays(context.state, childId, context.now)
  const usage = usageItems(context)
  const categories = childCategories(context.state, childId)
  const child = context.state.users.data.find((user) => user.id === childId)!
  const week = usage === null ? [] : appTimes(context.state, childId, usage, fromDay, toDay)
  const rules = new Map((child.appRules ?? []).map((rule) => [rule.packageName, rule]))
  const row = (packageName: string) => {
    const rule = rules.get(packageName)
    return {
      packageName,
      title: week.find((item) => item.packageName === packageName)?.title ?? packageName,
      weekMs: week.find((item) => item.packageName === packageName)?.ms ?? 0,
      rule: rule === undefined ? null : { days: rule.days, limitMinutes: rule.limitMinutes }
    }
  }
  const assigned = new Set(categories.flatMap((category) => category.apps))
  return {
    child,
    newApps: newApps(context.state, childId),
    categories: categories.map((category) => ({
      id: category.id,
      title: category.base.title,
      apps: [...new Set([...category.apps.filter((app) => !app.includes(':')), ...week.filter((item) => item.category?.id === category.id).map((item) => item.packageName)])]
        .map(row)
        .sort((a, b) => b.weekMs - a.weekMs)
    })),
    other: week.filter((item) => !assigned.has(item.packageName)).map((item) => row(item.packageName)),
    appUsageProblem: usageProblem(context)
  }
}

const viewApp = (packageName: string, context: ViewContext) => {
  const childId = requireChild(context)
  return { ...appCard(context.state, childId, packageName, context.now, usageItems(context)), appUsageProblem: usageProblem(context) }
}

// @tag:device-state
const viewDevices = (context: ViewContext) => {
  const childId = requireChild(context)
  const users = new Set(context.state.users.data.map((user) => user.id))
  const { toDay } = usageDays(context.state, childId, context.now)
  return {
    devices: devicesOf(context, childId),
    unassigned: context.state.devices.data
      .filter((device) => !users.has(device.currentUserId))
      .map((device) => ({ ...device, status: deviceStatus(context.state, device.deviceId, context.now, null, toDay) })),
    appUsageProblem: usageProblem(context)
  }
}

// @tag:child-request
const viewRequests = (context: ViewContext) => {
  const childId = requireChild(context)
  const overview = childOverview(context.state, childId, context.now)
  const timeZone = overview.child.timeZone
  const today = localTime(context.now, timeZone).dayOfEpoch
  const names = new Map(context.state.users.data.map((user) => [user.id, user.name]))
  const deviceNames = new Map(context.state.devices.data.map((device) => [device.deviceId, device.name]))
  const activeSchedule = overview.bans.find((ban) => ban.activeNow)
  const describe = (request: NonNullable<typeof overview.child.requests>[number]) => {
    const categoryId = answerCategoryId(context.state, request, childId)
    const category = overview.categories.find((item) => item.id === categoryId) ?? null
    const reason = request.categoryId === '' || category === null
      ? 'новое приложение — ещё нет категории'
      : category.blockedNow === 'limit-reached' ? `лимит «${category.title}» на сегодня кончился`
        : category.blockedNow === 'temporarily-blocked' ? `родитель закрыл «${category.title}»`
          : category.blockedNow === 'ban' || category.blockedNow === 'legacy-blocked-time'
            ? (activeSchedule && scheduleKind(activeSchedule) === 'sleep' ? 'сейчас Сон' : activeSchedule && scheduleKind(activeSchedule) === 'study' ? 'сейчас Учёба' : 'сейчас запрет')
            : null
    return {
      id: request.id,
      packageName: request.packageName,
      title: appTitle(context.state, request.packageName),
      device: deviceNames.get(request.deviceId) ?? 'удалённый планшет',
      word: request.word,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      status: requestStatus(request, context.now),
      category: category === null ? null : { id: category.id, title: category.title, usedTodayMs: category.usedTodayMs, limitNowMs: category.limitNowMs },
      categoryIsFallback: request.categoryId === '' && category !== null,
      reason,
      answer: request.answer === undefined ? null : { ...request.answer, parentName: names.get(request.answer.parentUserId) ?? 'родитель' }
    }
  }
  const all = (overview.child.requests ?? []).map(describe)
  return {
    child: overview.child,
    ...dayEndsAt(context, overview.bans, timeZone),
    waiting: all.filter((item) => item.status === 'waiting'),
    earlier: all.filter((item) => item.status !== 'waiting' && localTime(item.createdAt, timeZone).dayOfEpoch === today),
    supported: context.state.apiLevel >= NEW_UI_API_LEVEL
  }
}

// @tag:parent-code
const viewCode = (context: ViewContext) => {
  const secret = context.state.users.parentCodeSecret
  return secret ? parentCode(secret, context.now) : null
}

const viewBans = (context: ViewContext) => {
  const childId = requireChild(context)
  const overview = childOverview(context.state, childId, context.now)
  const categories = childCategories(context.state, childId)
  return {
    child: overview.child,
    bans: overview.bans.map((ban) => ({ ...ban, kind: scheduleKind(ban) })),
    legacyBans: overview.legacyBans,
    categories: categories.map(({ id, base }) => ({ id, title: base?.title ?? id, parentId: base?.parentCategoryId || null })),
    scheduleDefaults: { sleep: defaultScheduleCategories('sleep', categories), study: defaultScheduleCategories('study', categories) }
  }
}

const viewSites = (context: ViewContext) => {
  const childId = requireChild(context)
  const child = context.state.users.data.find((user) => user.id === childId)
  return {
    child,
    urlFilter: child?.urlFilter ?? { enabled: false, allow: [], block: [] },
    supported: context.state.apiLevel >= URL_FILTER_API_LEVEL
  }
}

const viewFamily = (context: ViewContext) => ({
  children: children(context.state),
  parents: parents(context.state),
  devices: context.state.devices.data,
  signedInUserId: context.signedInUserId,
  serverUrl: context.serverUrl,
  apiLevel: context.state.apiLevel,
  parentSessionsSupported: context.state.apiLevel >= PARENT_SESSION_API_LEVEL,
  // @tag:child-request
  waitingRequests: Object.fromEntries(children(context.state).map((child) => [
    child.id, (child.requests ?? []).filter((request) => requestStatus(request, context.now) === 'waiting').length
  ])),
  message: context.state.message
})

const views: Record<string, (context: ViewContext) => unknown> = {
  now: viewNow,
  bans: viewBans,
  sites: viewSites,
  requests: viewRequests,
  apps: viewApps,
  devices: viewDevices,
  code: viewCode,
  family: viewFamily
}

export function buildView (name: string, context: ViewContext): unknown {
  if (name.startsWith('category/')) return viewCategory(name.slice('category/'.length), context)
  if (name.startsWith('app/')) return viewApp(decodeURIComponent(name.slice('app/'.length)), context)
  const build = views[name]
  if (!build) {
    throw new ParentConsoleError(`no such view: ${name}`, `known views: ${Object.keys(views).join(', ')}, category/<id>`)
  }
  return build(context)
}

/** «подробнее» on a category row: its rules read-only, its apps and its week — what «Лимиты» and «История» used to show. */
function viewCategory (categoryId: string, context: ViewContext) {
  const category = context.state.categories[categoryId]
  if (!category) throw new ParentConsoleError(`no category with id ${categoryId}`)
  const childId = category.base?.childId
  const history = childId ? usageHistory(context.state, childId, context.now, HISTORY_DAYS) : null
  return {
    id: category.id,
    title: category.base?.title ?? category.id,
    parentId: category.base?.parentCategoryId || null,
    rules: category.rules,
    apps: category.apps.map((packageName) => ({ packageName, title: appTitle(context.state, packageName) })),
    week: history === null ? [] : history.days.map((day) => ({ day: day.dayOfEpoch, ms: day.byCategory[category.id] ?? 0 }))
  }
}
