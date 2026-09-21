import { ParentConsoleError } from '../core/errors.ts'
import { dailyLimitRules } from '../core/operations.ts'
import { childOverview, findChild, usageHistory } from '../core/overview.ts'
import { PARENT_SESSION_API_LEVEL, URL_FILTER_API_LEVEL } from '../core/protocol.ts'
import { defaultScheduleCategories } from '../core/schedules.ts'
import { childCategories, children, type FamilyState, parents } from '../core/state.ts'
import { scheduleKind } from '../shared/schedules.ts'

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
}

const HISTORY_DAYS = 7

function requireChild (context: ViewContext): string {
  const child = findChild(context.state, context.childId)
  return child.id
}

const viewNow = (context: ViewContext) => {
  const childId = requireChild(context)
  const overview = childOverview(context.state, childId, context.now)
  return {
    ...overview,
    devices: context.state.devices.data.filter((device) => device.currentUserId === childId)
  }
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

const viewLimits = (context: ViewContext) => {
  const childId = requireChild(context)
  const overview = childOverview(context.state, childId, context.now)
  return {
    child: overview.child,
    categories: childCategories(context.state, childId).map((category) => ({
      id: category.id,
      title: category.base?.title ?? category.id,
      parentId: category.base?.parentCategoryId || null,
      apps: category.apps,
      dailyLimits: dailyLimitRules(category)
    })),
    unassignedApps: overview.unassignedApps,
    categoryForUnassignedApps: overview.categoryForUnassignedApps
  }
}

const viewHistory = (context: ViewContext) => {
  const childId = requireChild(context)
  return {
    ...usageHistory(context.state, childId, context.now, HISTORY_DAYS),
    loopholes: childOverview(context.state, childId, context.now).loopholes
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
  message: context.state.message
})

const views: Record<string, (context: ViewContext) => unknown> = {
  now: viewNow,
  bans: viewBans,
  limits: viewLimits,
  history: viewHistory,
  sites: viewSites,
  family: viewFamily
}

export function buildView (name: string, context: ViewContext): unknown {
  if (name.startsWith('category/')) return viewCategory(name.slice('category/'.length), context)
  const build = views[name]
  if (!build) {
    throw new ParentConsoleError(`no such view: ${name}`, `known views: ${Object.keys(views).join(', ')}, category/<id>`)
  }
  return build(context)
}

function viewCategory (categoryId: string, context: ViewContext) {
  const category = context.state.categories[categoryId]
  if (!category) throw new ParentConsoleError(`no category with id ${categoryId}`)
  return {
    id: category.id,
    title: category.base?.title ?? category.id,
    parentId: category.base?.parentCategoryId || null,
    rules: category.rules,
    apps: category.apps
  }
}
