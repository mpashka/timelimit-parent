import { ParentConsoleError } from './errors.ts'
import { generateId } from './ids.ts'
import { ALL_DAYS, MINUTE_MAX, type ParentAction, type ServerRule, URL_FILTER_API_LEVEL, type UrlFilter } from './protocol.ts'
import { type CategoryView, childCategories, type FamilyState, type User } from './state.ts'
import { localTime } from './time.ts'

// @tag:parent-console

export const DEFAULT_CHILD_CATEGORIES = ['Разрешено', 'Игры']

/** A child with the two categories the Android app creates (`AddUserModel`), so the child's device has somewhere to put apps. */
export function addChild ({ name, timeZone, categoryTitles = DEFAULT_CHILD_CATEGORIES }: { name: string, timeZone: string, categoryTitles?: string[] }): { childId: string, actions: ParentAction[] } {
  const trimmed = name.trim()
  if (trimmed === '') throw new ParentConsoleError('the child needs a name')
  const childId = generateId()
  const categoryIds = categoryTitles.map(() => generateId())
  return {
    childId,
    actions: [
      { type: 'ADD_USER', userId: childId, name: trimmed, userType: 'child', timeZone },
      ...categoryTitles.map((title, i): ParentAction => ({ type: 'CREATE_CATEGORY', childId, categoryId: categoryIds[i], title })),
      { type: 'UPDATE_CATEGORY_SORTING', categoryIds }
    ]
  }
}

export function grantExtraTime ({ state, category, minutes, now }: { state: FamilyState, category: CategoryView, minutes: number, now: number }): ParentAction[] {
  if (!(minutes > 0)) throw new ParentConsoleError(`extra time must be positive, got ${minutes}`)
  const child = requireChild(state, category.base.childId)
  return [{
    type: 'INCREMENT_CATEGORY_EXTRATIME',
    categoryId: category.id,
    addedExtraTime: Math.round(minutes * 60000),
    day: localTime(now, child.timeZone).dayOfEpoch
  }]
}

/** Undo of `grantExtraTime`: today's extra time minus what was added, not below zero. */
export function revokeExtraTime ({ state, category, minutes, now }: { state: FamilyState, category: CategoryView, minutes: number, now: number }): ParentAction[] {
  const child = requireChild(state, category.base.childId)
  const day = localTime(now, child.timeZone).dayOfEpoch
  const current = category.base.extraTimeDay === -1 || category.base.extraTimeDay === day ? category.base.extraTime : 0
  return [{ type: 'SET_CATEGORY_EXTRA_TIME', categoryId: category.id, newExtraTime: Math.max(current - Math.round(minutes * 60000), 0), day }]
}

export function allowCategoryUntil (category: CategoryView, until: number): ParentAction[] {
  return [{ type: 'UPDATE_CATEGORY_DISABLE_LIMITS', categoryId: category.id, endTime: Math.max(Math.round(until), 0) }]
}

export function allowChildUntil (child: User, until: number): ParentAction[] {
  return [{ type: 'SET_USER_DISABLE_LIMITS_UNTIL', childId: child.id, time: Math.max(Math.round(until), 0) }]
}

export const rootCategories = (state: FamilyState, childId: string): CategoryView[] => {
  const categories = childCategories(state, childId)
  return categories.filter((c) => !categories.some((p) => p.id === c.base.parentCategoryId))
}

export function blockCategory ({ category, blocked, until }: { category: CategoryView, blocked: boolean, until?: number }): ParentAction[] {
  return [{ type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId: category.id, blocked, ...(blocked && until ? { endTime: Math.round(until) } : {}) }]
}

export function lockChild ({ state, child, until }: { state: FamilyState, child: User, until?: number }): ParentAction[] {
  const roots = rootCategories(state, child.id)
  if (roots.length === 0) throw new ParentConsoleError(`${child.name} has no categories to lock`)
  return roots.flatMap((category) => blockCategory({ category, blocked: true, until }))
}

export function unlockChild ({ state, child }: { state: FamilyState, child: User }): ParentAction[] {
  return childCategories(state, child.id)
    .filter((c) => c.base.tempBlocked)
    .map((c) => ({ type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId: c.id, blocked: false }))
}

/** Undo of `lockChild` / `unlockChild`: puts back the temporary blocks of categories as they were in `before`. */
export function restoreTemporaryBlocks (before: CategoryView[]): ParentAction[] {
  return before.map((c) => c.base.tempBlocked
    ? { type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId: c.id, blocked: true, ...(c.base.tempBlockTime ? { endTime: c.base.tempBlockTime } : {}) }
    : { type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId: c.id, blocked: false })
}

const isDailyLimit = (rule: ServerRule): boolean =>
  rule.maxTime > 0 && rule.start === 0 && rule.end === MINUTE_MAX && rule.e === undefined && rule.session === 0

export const dailyLimitRules = (category: CategoryView): ServerRule[] => category.rules.filter(isDailyLimit)

/** Undo of `setDailyLimit`: replaces the current whole-day limits of the category by copies of `snapshot`. */
export function restoreDailyLimits ({ category, snapshot }: { category: CategoryView, snapshot: ServerRule[] }): ParentAction[] {
  return [
    ...dailyLimitRules(category).map((r): ParentAction => ({ type: 'DELETE_TIMELIMIT_RULE', ruleId: r.id })),
    ...snapshot.map((r): ParentAction => ({
      type: 'CREATE_TIMELIMIT_RULE',
      rule: { ruleId: generateId(), categoryId: category.id, time: r.maxTime, days: r.dayMask, extraTime: r.extraTime, start: r.start, end: r.end, dur: r.session, pause: r.pause, perDay: r.perDay }
    }))
  ]
}

/** Sets (minutes > 0) or removes (minutes = null) the whole-day limit of a category on `days`, keeping other days of existing rules. */
export function setDailyLimit ({ category, minutes, days = ALL_DAYS }: { category: CategoryView, minutes: number | null, days?: number }): ParentAction[] {
  const actions: ParentAction[] = []
  for (const rule of category.rules.filter(isDailyLimit)) {
    if ((rule.dayMask & days) === 0) continue
    const rest = rule.dayMask & ~days
    if (rest === 0) {
      actions.push({ type: 'DELETE_TIMELIMIT_RULE', ruleId: rule.id })
    } else {
      actions.push({
        type: 'UPDATE_TIMELIMIT_RULE', ruleId: rule.id, time: rule.maxTime, days: rest, extraTime: rule.extraTime,
        start: rule.start, end: rule.end, dur: rule.session, pause: rule.pause, perDay: rule.perDay
      })
    }
  }
  if (minutes !== null) {
    if (!(minutes > 0)) throw new ParentConsoleError(`limit must be positive minutes or "off", got ${minutes}`)
    actions.push({
      type: 'CREATE_TIMELIMIT_RULE',
      rule: { ruleId: generateId(), categoryId: category.id, time: Math.round(minutes * 60000), days, extraTime: false, start: 0, end: MINUTE_MAX, dur: 0, pause: 0, perDay: true }
    })
  }
  return actions
}

export function moveApp ({ state, childId, packageName, target }: { state: FamilyState, childId: string, packageName: string, target: CategoryView | null }): ParentAction[] {
  const current = childCategories(state, childId).filter((c) => c.apps.includes(packageName))
  if (target === null) {
    if (current.length === 0) throw new ParentConsoleError(`${packageName} is not in any category`)
    return current.map((c) => ({ type: 'REMOVE_CATEGORY_APPS', categoryId: c.id, packageNames: [packageName] }))
  }
  if (current.some((c) => c.id === target.id)) return []
  return [{ type: 'ADD_CATEGORY_APPS', categoryId: target.id, packageNames: [packageName] }]
}

/** Per-app limit: a new sub-category of the app's current category (so the old limit still applies), the app moved into it, and a daily limit. */
export function limitApp ({ state, childId, packageName, minutes, title, days = ALL_DAYS }: {
  state: FamilyState, childId: string, packageName: string, minutes: number, title?: string, days?: number
}): ParentAction[] {
  const categories = childCategories(state, childId)
  const current = categories.find((c) => c.apps.includes(packageName))
  const categoryId = generateId()
  const actions: ParentAction[] = [{ type: 'CREATE_CATEGORY', childId, categoryId, title: title ?? packageName.split('@')[0] }]
  if (current) actions.push({ type: 'SET_PARENT_CATEGORY', categoryId, parentCategory: current.id })
  actions.push({ type: 'ADD_CATEGORY_APPS', categoryId, packageNames: [packageName] })
  actions.push({
    type: 'CREATE_TIMELIMIT_RULE',
    rule: { ruleId: generateId(), categoryId, time: Math.round(minutes * 60000), days, extraTime: false, start: 0, end: MINUTE_MAX, dur: 0, pause: 0, perDay: true }
  })
  return actions
}

/**
 * Undo of `limitApp`: the app goes back to `previousCategoryId` and the sub-category that `limitApp`
 * made for it is deleted. The sub-category is found in the state — the caller of an undo holds the
 * fresh family, not the actions of the change — and it is only deleted while it still looks like
 * one: the app alone in a child of the category it came from.
 */
export function undoLimitApp ({ state, childId, packageName, previousCategoryId }: {
  state: FamilyState, childId: string, packageName: string, previousCategoryId: string | null
}): ParentAction[] {
  const holder = childCategories(state, childId).find((c) => c.apps.includes(packageName))
  if (!holder) throw new ParentConsoleError(`${packageName} is not in any category`)
  if (holder.apps.length !== 1 || (previousCategoryId !== null && holder.base.parentCategoryId !== previousCategoryId)) {
    throw new ParentConsoleError(
      `"${holder.base.title}" is not the sub-category made for ${packageName} any more`,
      'the app or its category changed after the limit was set — undo it by hand'
    )
  }
  const back: ParentAction[] = previousCategoryId ? [{ type: 'ADD_CATEGORY_APPS', categoryId: previousCategoryId, packageNames: [packageName] }] : []
  return [...back, { type: 'DELETE_CATEGORY', categoryId: holder.id }]
}

export function validateUrlFilter (filter: UrlFilter): void {
  for (const [name, list] of [['allow', filter.allow], ['block', filter.block]] as const) {
    if (list.length > 1000) throw new ParentConsoleError(`url filter ${name} list has ${list.length} entries, at most 1000 allowed`)
    const tooLong = list.find((item) => item.length > 256 || item.length === 0)
    if (tooLong !== undefined) throw new ParentConsoleError(`url filter ${name} entry "${tooLong.slice(0, 40)}" must be 1..256 characters`)
    const duplicate = list.find((item, i) => list.indexOf(item) !== i)
    if (duplicate !== undefined) throw new ParentConsoleError(`url filter ${name} list contains "${duplicate}" twice`)
  }
}

export function setUrlFilter ({ state, childId, filter }: { state: FamilyState, childId: string, filter: UrlFilter }): ParentAction[] {
  if (state.apiLevel < URL_FILTER_API_LEVEL) {
    throw new ParentConsoleError(
      `the server has apiLevel ${state.apiLevel}, the url filter needs ${URL_FILTER_API_LEVEL}: an older server would silently drop the action`,
      'deploy the server with UPDATE_USER_URL_FILTER (branch parent-console of timelimit-server)'
    )
  }
  validateUrlFilter(filter)
  return [{ type: 'UPDATE_USER_URL_FILTER', userId: childId, enabled: filter.enabled, allow: filter.allow, block: filter.block }]
}

function requireChild (state: FamilyState, childId: string): User {
  const child = state.users.data.find((u) => u.id === childId)
  if (!child) throw new ParentConsoleError(`no user with id ${childId} in the cached state`, 'run `status` to sync')
  return child
}
