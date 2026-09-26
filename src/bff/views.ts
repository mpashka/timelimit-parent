import type { AppUsageItem } from '../core/api.ts'
import { appCard, type AppLabels, appTimes, appTitle, deviceStatus, newApps, packageOf, usageDays } from '../core/apps.ts'
import { ParentConsoleError } from '../core/errors.ts'
import { dailyLimitRules } from '../core/operations.ts'
import { childOverview, findChild, usageHistory } from '../core/overview.ts'
import { parentCode } from '../core/parent-code.ts'
import { NEW_UI_API_LEVEL, PARENT_SESSION_API_LEVEL, URL_FILTER_API_LEVEL } from '../core/protocol.ts'
import { answerCategoryId, requestStatus } from '../core/requests.ts'
import { defaultScheduleCategories } from '../core/schedules.ts'
import { childCategories, children, type FamilyState, parents } from '../core/state.ts'
import { dayEnd, scheduleKind } from '../shared/schedules.ts'
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
  /** Names and icons from Google Play and the tablets, for the views that show apps. */
  labels?: AppLabels
}

/** Views that need `/parent/get-app-usage`; the server answers it separately from the sync status. */
export const USAGE_VIEWS = ['now', 'apps', 'devices']
export const needsAppUsage = (name: string): boolean => USAGE_VIEWS.includes(name) || name.startsWith('app/')

/** Views that draw apps by name and icon. */
// @tag:app-icon
export const needsLabels = (name: string): boolean =>
  ['now', 'apps', 'devices', 'requests'].includes(name) || name.startsWith('app/') || name.startsWith('category/')

/** Every app the console may show for the child — the only packages worth a name and an icon. */
// @tag:app-icon
export function visiblePackages (context: ViewContext, view: string): string[] {
  const categoryOwner = view.startsWith('category/') ? context.state.categories[view.slice('category/'.length)]?.base?.childId : undefined
  const child = findChild(context.state, categoryOwner ?? context.childId)
  const devices = new Set(context.state.devices.data.filter((device) => device.currentUserId === child.id).map((device) => device.deviceId))
  return [...new Set([
    ...(view.startsWith('app/') ? [decodeURIComponent(view.slice('app/'.length))] : []),
    ...childCategories(context.state, child.id).flatMap((category) => category.apps.map(packageOf)),
    ...(child.newApps ?? []).map((app) => app.packageName),
    ...(child.requests ?? []).map((request) => request.packageName),
    ...(child.appAllowances ?? []).map((item) => item.packageName),
    ...(child.appRules ?? []).map((item) => item.packageName),
    ...(usageItems(context) ?? []).map((item) => item.packageName),
    ...(context.state.deviceStates ?? []).filter((item) => devices.has(item.deviceId) && item.app !== '').map((item) => item.app)
  ])]
}

const NO_LABELS: AppLabels = new Map()
const labelsOf = (context: ViewContext): AppLabels => context.labels ?? NO_LABELS
const iconOf = (context: ViewContext, packageName: string): string | null => labelsOf(context).get(packageName)?.icon ?? null
const withIcon = (context: ViewContext) => <T extends { packageName: string }>(item: T) => ({ ...item, icon: iconOf(context, item.packageName) })
const appFace = (context: ViewContext, packageName: string) =>
  ({ packageName, title: appTitle(context.state, packageName, labelsOf(context)), icon: iconOf(context, packageName) })

const usageItems = (context: ViewContext): AppUsageItem[] | null =>
  context.appUsage !== undefined && 'items' in context.appUsage ? context.appUsage.items : null
const usageProblem = (context: ViewContext): string | null =>
  context.appUsage !== undefined && 'problem' in context.appUsage ? context.appUsage.problem : null

// @tag:app-usage @tag:new-app @tag:device-state
function appsToday (context: ViewContext, childId: string) {
  const usage = usageItems(context)
  const { toDay } = usageDays(context.state, childId, context.now)
  return {
    apps: usage === null ? null : appTimes(context.state, childId, usage, toDay, toDay, labelsOf(context)).map(withIcon(context)),
    newApps: newApps(context.state, childId, labelsOf(context)).map(withIcon(context)),
    appUsageProblem: usageProblem(context)
  }
}

function devicesOf (context: ViewContext, childId: string) {
  const usage = usageItems(context)
  const { toDay } = usageDays(context.state, childId, context.now)
  return context.state.devices.data
    .filter((device) => device.currentUserId === childId)
    .map((device) => ({ ...device, status: deviceStatus(context.state, device.deviceId, context.now, usage, toDay, labelsOf(context)) }))
}

const HISTORY_DAYS = 7

function requireChild (context: ViewContext): string {
  const child = findChild(context.state, context.childId)
  return child.id
}

const viewNow = (context: ViewContext) => {
  const childId = requireChild(context)
  const overview = childOverview(context.state, childId, context.now)
  // @tag:app-allowance
  const allowances = (overview.child.appAllowances ?? [])
    .filter((item) => item.until > context.now)
    .map((item) => ({ ...item, ...appFace(context, item.packageName) }))
  const categoryViews = childCategories(context.state, childId)
  const today = appsToday(context, childId)
  const descendants = (id: string): string[] =>
    [id, ...overview.categories.filter((item) => item.parentId === id).flatMap((item) => descendants(item.id))]
  return {
    ...overview,
    categories: overview.categories.map((category) => {
      const own = categoryViews.find((item) => item.id === category.id)
      const ids = new Set(descendants(category.id))
      // @tag:category-time
      // the tablet records a category's time only while a rule of it is active, the app time always
      const appsMs = (today.apps ?? []).filter((app) => app.category !== null && ids.has(app.category.id)).reduce((sum, app) => sum + app.ms, 0)
      return {
        ...category,
        usedTodayMs: category.limitNowMs === null ? Math.max(category.usedTodayMs, appsMs) : category.usedTodayMs,
        dailyLimits: own ? dailyLimitRules(own) : [],
        appList: [...new Set(category.apps.map(packageOf))].map((packageName) => appFace(context, packageName))
      }
    }),
    ...dayEnd(overview.bans, context.now, overview.child.timeZone),
    allowances,
    activeSchedule: overview.bans.filter((ban) => ban.activeNow).map((ban) => scheduleKind(ban)).find((kind) => kind !== null) ?? null,
    ...today,
    appRules: overview.child.appRules ?? [],
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
  const week = usage === null ? [] : appTimes(context.state, childId, usage, fromDay, toDay, labelsOf(context))
  const rules = new Map((child.appRules ?? []).map((rule) => [rule.packageName, rule]))
  const row = (packageName: string) => {
    const rule = rules.get(packageName)
    return {
      ...appFace(context, packageName),
      weekMs: week.find((item) => item.packageName === packageName)?.ms ?? 0,
      rule: rule === undefined ? null : { days: rule.days, limitMinutes: rule.limitMinutes }
    }
  }
  const deviceNames = new Map(context.state.devices.data.map((device) => [device.deviceId, device.name]))
  const entry = (specifier: string) => {
    const [packageName, deviceId] = specifier.split('@')
    return { ...row(packageName), device: deviceId === undefined ? null : deviceNames.get(deviceId) ?? 'удалённый планшет' }
  }
  const assigned = new Set(categories.flatMap((category) => category.apps))
  return {
    child,
    newApps: newApps(context.state, childId, labelsOf(context)).map(withIcon(context)),
    categories: categories.map((category) => ({
      id: category.id,
      title: category.base.title,
      apps: [...new Set([...category.apps.filter((app) => !app.includes(':')), ...week.filter((item) => item.category?.id === category.id).map((item) => item.packageName)])]
        .map(entry)
        .sort((a, b) => b.weekMs - a.weekMs)
    })),
    other: week.filter((item) => !assigned.has(item.packageName)).map((item) => row(item.packageName)),
    appUsageProblem: usageProblem(context)
  }
}

const viewApp = (packageName: string, context: ViewContext) => {
  const childId = requireChild(context)
  return {
    ...appCard(context.state, childId, packageName, context.now, usageItems(context), labelsOf(context)),
    icon: iconOf(context, packageName),
    appUsageProblem: usageProblem(context)
  }
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
      .map((device) => ({ ...device, status: deviceStatus(context.state, device.deviceId, context.now, null, toDay, labelsOf(context)) })),
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
      ...appFace(context, request.packageName),
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
    ...dayEnd(overview.bans, context.now, timeZone),
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
    apps: category.apps.map((packageName) => ({ packageName, title: appTitle(context.state, packageName, labelsOf(context)) })),
    week: history === null ? [] : history.days.map((day) => ({ day: day.dayOfEpoch, ms: day.byCategory[category.id] ?? 0 }))
  }
}
