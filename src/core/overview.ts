import { type Ban, isBanActiveAt, readBans, readLegacyBans } from './bans.ts'
import { ParentConsoleError } from './errors.ts'
import type { ServerDevice, ServerRule, UsedTimeItem } from './protocol.ts'
import { type CategoryView, childCategories, children, type FamilyState, type User } from './state.ts'
import { localTime } from '../shared/time.ts'

// @tag:parent-console

export interface RemainingTime {
  includingExtraTime: number
  default: number
}

export const rulesRelatedTo = (rules: ServerRule[], dayOfWeek: number, minuteOfDay: number): ServerRule[] =>
  rules.filter((r) => (r.dayMask & (1 << dayOfWeek)) !== 0 && minuteOfDay >= r.start && minuteOfDay <= r.end)

export const isLikeBan = (rule: ServerRule): boolean => rule.extraTime && rule.maxTime === 0

function usedTimeForRule (usedTimes: UsedTimeItem[], rule: ServerRule, firstDayOfWeek: number, dayOfWeek: number): number {
  const byDay = [0, 0, 0, 0, 0, 0, 0]
  for (const item of usedTimes) {
    const index = item.day - firstDayOfWeek
    if (index < 0 || index > 6) continue
    const dayMatch = rule.perDay || (rule.dayMask & (1 << index)) !== 0
    const slotMatch = rule.start <= item.start && rule.end >= item.end
    if (dayMatch && slotMatch) byDay[index] = Math.max(byDay[index], item.time)
  }
  return rule.perDay ? byDay[dayOfWeek] : byDay.reduce((a, b) => a + b, 0)
}

/** Port of RemainingTime.getRemainingTime from the Android app; null means no rule limits this moment. */
export function remainingTime ({ rules, usedTimes, extraTime, dayOfEpoch, dayOfWeek, minuteOfDay }: {
  rules: ServerRule[], usedTimes: UsedTimeItem[], extraTime: number, dayOfEpoch: number, dayOfWeek: number, minuteOfDay: number
}): RemainingTime | null {
  const related = rulesRelatedTo(rules, dayOfWeek, minuteOfDay)
  const firstDayOfWeek = dayOfEpoch - dayOfWeek
  const remainingBy = (onlyExtraTimeRules: boolean) => {
    const values = related
      .filter((r) => !onlyExtraTimeRules || r.extraTime)
      .map((r) => Math.max(r.maxTime - usedTimeForRule(usedTimes, r, firstDayOfWeek, dayOfWeek), 0))
    return values.length === 0 ? null : Math.min(...values)
  }
  const withoutExtra = remainingBy(false)
  const withExtra = remainingBy(true)
  if (withoutExtra === null) return null
  if (withExtra === null) return { includingExtraTime: withoutExtra + extraTime, default: withoutExtra }
  return { includingExtraTime: withoutExtra + Math.min(extraTime, withExtra - withoutExtra), default: withoutExtra }
}

export type BlockReason = 'temporarily-blocked' | 'ban' | 'legacy-blocked-time' | 'limit-reached'

export interface CategoryOverview {
  id: string
  title: string
  parentId: string | null
  depth: number
  apps: string[]
  usedTodayMs: number
  limitNowMs: number | null
  remaining: RemainingTime | null
  extraTimeMs: number
  limitsDisabledUntil: number | null
  temporarilyBlocked: { until: number | null } | null
  blockedNow: BlockReason | null
  blockedByParent: string | null
  countsTimeNow: boolean
}

export type LoopholeKind = 'no-rule-now' | 'no-rules' | 'limits-disabled' | 'unassigned-apps-category'

export interface Loophole {
  kind: LoopholeKind
  categoryId: string
  detail: string
}

export interface ChildOverview {
  child: User
  now: number
  dayOfEpoch: number
  categories: CategoryOverview[]
  bans: Array<Ban & { activeNow: boolean }>
  legacyBans: Array<Ban & { activeNow: boolean }>
  loopholes: Loophole[]
  categoryForUnassignedApps: string | null
  unassignedApps: Array<{ deviceId: string, packageName: string, title: string }> | null
}

export function findChild (state: FamilyState, query?: string): User {
  const list = children(state)
  if (!query) {
    if (list.length === 1) return list[0]
    throw new ParentConsoleError(list.length === 0 ? 'the family has no child users' : `the family has ${list.length} children, name one`, `children: ${list.map((c) => c.name).join(', ')}`)
  }
  const lower = query.toLowerCase()
  const found = list.find((c) => c.id === query) ?? list.find((c) => c.name.toLowerCase() === lower) ??
    uniquePrefix(list, (c) => c.name, lower)
  if (!found) throw new ParentConsoleError(`no child "${query}"`, `children: ${list.map((c) => c.name).join(', ')}`)
  return found
}

export function findDevice (state: FamilyState, query: string): ServerDevice {
  const list = state.devices.data
  const lower = query.toLowerCase()
  const found = list.find((d) => d.deviceId === query) ?? list.find((d) => d.name.toLowerCase() === lower) ??
    uniquePrefix(list, (d) => d.name, lower)
  if (!found) throw new ParentConsoleError(`no device "${query}"`, `devices: ${list.map((d) => `${d.deviceId} ${d.name}`).join(', ')}`)
  return found
}

function uniquePrefix<T> (list: T[], name: (item: T) => string, lowerQuery: string): T | undefined {
  const matches = list.filter((item) => name(item).toLowerCase().startsWith(lowerQuery))
  return matches.length === 1 ? matches[0] : undefined
}

export function findCategory (categories: CategoryView[], query: string): CategoryView {
  const lower = query.toLowerCase()
  const found = categories.find((c) => c.id === query) ?? categories.find((c) => c.base.title.toLowerCase() === lower) ??
    uniquePrefix(categories, (c) => c.base.title, lower)
  if (!found) {
    throw new ParentConsoleError(`no category "${query}"`, `categories: ${categories.map((c) => c.base.title).join(', ')}`)
  }
  return found
}

export function categoryDepthOrder (categories: CategoryView[]): Array<{ category: CategoryView, depth: number }> {
  const ids = new Set(categories.map((c) => c.id))
  const result: Array<{ category: CategoryView, depth: number }> = []
  const visit = (parentId: string, depth: number) => {
    for (const category of categories) {
      const parent = ids.has(category.base.parentCategoryId) ? category.base.parentCategoryId : ''
      if (parent === parentId && category.id !== parentId && !result.some((r) => r.category.id === category.id)) {
        result.push({ category, depth })
        visit(category.id, depth + 1)
      }
    }
  }
  visit('', 0)
  for (const category of categories) {
    if (!result.some((r) => r.category.id === category.id)) result.push({ category, depth: 0 })
  }
  return result
}

export function childOverview (state: FamilyState, childId: string, now: number): ChildOverview {
  const child = state.users.data.find((u) => u.id === childId)
  if (!child) throw new ParentConsoleError(`no user with id ${childId}`)
  const { dayOfEpoch, dayOfWeek, minuteOfDay } = localTime(now, child.timeZone)
  const minuteOfWeek = dayOfWeek * 1440 + minuteOfDay
  const categories = childCategories(state, childId)
  const bans = readBans(categories)
  const legacyBans = readLegacyBans(categories)

  const own = new Map<string, CategoryOverview>()
  for (const { category, depth } of categoryDepthOrder(categories)) {
    const base = category.base
    const limitsDisabledUntil = Math.max(child.disableLimitsUntil, base.dlu)
    const limitsDisabled = now < limitsDisabledUntil
    const activeRules = limitsDisabled ? [] : rulesRelatedTo(category.rules.filter((r) => r.e === undefined || r.e > now), dayOfWeek, minuteOfDay)
    const regularRules = activeRules.filter((r) => !isLikeBan(r))
    const extraTimeMs = base.extraTimeDay === -1 || base.extraTimeDay === dayOfEpoch ? base.extraTime : 0
    const remaining = limitsDisabled
      ? null
      : remainingTime({ rules: regularRules, usedTimes: category.usedTimes, extraTime: extraTimeMs, dayOfEpoch, dayOfWeek, minuteOfDay })
    const tempBlocked = base.tempBlocked && (base.tempBlockTime === 0 || base.tempBlockTime > now)
    const legacyBlocked = !limitsDisabled && parseLegacyIncludes(base.blockedTimes, minuteOfWeek)

    let blockedNow: BlockReason | null = null
    if (tempBlocked) blockedNow = 'temporarily-blocked'
    else if (activeRules.some(isLikeBan)) blockedNow = 'ban'
    else if (legacyBlocked) blockedNow = 'legacy-blocked-time'
    else if (remaining && remaining.includingExtraTime === 0) blockedNow = 'limit-reached'

    const todayItems = category.usedTimes.filter((t) => t.day === dayOfEpoch)
    own.set(category.id, {
      id: category.id,
      title: base.title,
      parentId: categories.some((c) => c.id === base.parentCategoryId) ? base.parentCategoryId : null,
      depth,
      apps: category.apps,
      usedTodayMs: todayItems.reduce((max, t) => Math.max(max, t.time), 0),
      limitNowMs: regularRules.length === 0 ? null : Math.min(...regularRules.map((r) => r.maxTime)),
      remaining,
      extraTimeMs,
      limitsDisabledUntil: limitsDisabled ? limitsDisabledUntil : null,
      temporarilyBlocked: tempBlocked ? { until: base.tempBlockTime === 0 ? null : base.tempBlockTime } : null,
      blockedNow,
      blockedByParent: null,
      countsTimeNow: regularRules.length > 0
    })
  }

  for (const item of own.values()) {
    for (let parentId = item.parentId, guard = 0; parentId && guard < 10; guard++) {
      const parent = own.get(parentId)
      if (!parent) break
      if (parent.blockedNow && !item.blockedNow) item.blockedByParent = parent.id
      if (parent.countsTimeNow) item.countsTimeNow = true
      parentId = parent.parentId
    }
  }

  const overviews = [...own.values()]
  const loopholes: Loophole[] = []
  for (const item of overviews) {
    const category = categories.find((c) => c.id === item.id)!
    const blocked = item.blockedNow !== null || item.blockedByParent !== null
    if (item.limitsDisabledUntil !== null) {
      loopholes.push({ kind: 'limits-disabled', categoryId: item.id, detail: `limits of "${item.title}" are switched off until ${new Date(item.limitsDisabledUntil).toISOString()}` })
    } else if (category.rules.length === 0 && !blocked && !item.countsTimeNow) {
      loopholes.push({ kind: 'no-rules', categoryId: item.id, detail: `"${item.title}" has no rules at all: its apps run without limit and their time is not recorded` })
    } else if (!item.countsTimeNow && !blocked) {
      loopholes.push({ kind: 'no-rule-now', categoryId: item.id, detail: `no rule of "${item.title}" covers this moment: its apps run freely and the time is not recorded` })
    }
  }
  const unassignedCategory = own.get(child.categoryForNotAssignedApps) ?? null
  if (unassignedCategory && !unassignedCategory.countsTimeNow && !unassignedCategory.blockedNow) {
    loopholes.push({ kind: 'unassigned-apps-category', categoryId: unassignedCategory.id, detail: `apps without a category fall into "${unassignedCategory.title}", which is not limited now` })
  }

  const localBan = (ban: Ban) => ({ ...ban, activeNow: isBanActiveAt(ban, dayOfWeek, minuteOfDay) })
  return {
    child,
    now,
    dayOfEpoch,
    categories: overviews,
    bans: bans.map(localBan),
    legacyBans: legacyBans.map(localBan),
    loopholes,
    categoryForUnassignedApps: unassignedCategory?.id ?? null,
    unassignedApps: unassignedApps(state, child, categories)
  }
}

function parseLegacyIncludes (encoded: string, minuteOfWeek: number): boolean {
  const numbers = encoded.split(',').filter((s) => s.trim() !== '').map(Number)
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    if (minuteOfWeek >= numbers[i] && minuteOfWeek < numbers[i + 1]) return true
  }
  return false
}

function unassignedApps (state: FamilyState, child: User, categories: CategoryView[]): ChildOverview['unassignedApps'] {
  const devices = state.devices.data.filter((d) => d.currentUserId === child.id)
  const known = devices.filter((d) => state.installedApps[d.deviceId])
  // ponytail: current servers no longer send installed apps in plain text (only the encrypted list, stage 4), so this is usually null
  if (known.length === 0) return null
  const assigned = new Set(categories.flatMap((c) => c.apps))
  return known.flatMap((device) => state.installedApps[device.deviceId].apps
    .filter((app) => app.isLaunchable && !assigned.has(app.packageName) && !assigned.has(`${app.packageName}@${device.deviceId}`))
    .map((app) => ({ deviceId: device.deviceId, packageName: app.packageName, title: app.title })))
}

export interface UsageDay {
  dayOfEpoch: number
  date: string
  byCategory: Record<string, number>
}

export function usageHistory (state: FamilyState, childId: string, now: number, days: number): { categories: Array<{ id: string, title: string }>, days: UsageDay[] } {
  const child = state.users.data.find((u) => u.id === childId)
  if (!child) throw new ParentConsoleError(`no user with id ${childId}`)
  const today = localTime(now, child.timeZone).dayOfEpoch
  const categories = childCategories(state, childId)
  const result: UsageDay[] = []
  for (let day = today - days + 1; day <= today; day++) {
    const byCategory: Record<string, number> = {}
    for (const category of categories) {
      const max = category.usedTimes.filter((t) => t.day === day).reduce((m, t) => Math.max(m, t.time), 0)
      if (max > 0) byCategory[category.id] = max
    }
    result.push({ dayOfEpoch: day, date: new Date(day * 86400000).toISOString().slice(0, 10), byCategory })
  }
  return { categories: categories.map((c) => ({ id: c.id, title: c.base.title })), days: result }
}
