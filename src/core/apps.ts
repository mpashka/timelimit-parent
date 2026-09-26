import type { AppUsageItem } from './api.ts'
import { ParentConsoleError } from './errors.ts'
import type { FamilyState } from './state.ts'
import { childCategories } from './state.ts'
import { localTime } from '../shared/time.ts'

// @tag:app-usage @tag:app-rule @tag:new-app @tag:device-state

export const ONLINE_MS = 2 * 60_000
export const USAGE_DAYS = 7

/** The days a view of app time covers: the child's today and the six before it. */
export function usageDays (state: FamilyState, childId: string, now: number): { fromDay: number, toDay: number } {
  const child = state.users.data.find((user) => user.id === childId)
  if (!child) throw new ParentConsoleError(`no user with id ${childId}`)
  const toDay = localTime(now, child.timeZone).dayOfEpoch
  return { fromDay: toDay - USAGE_DAYS + 1, toDay }
}

/**
 * The name to show for a package. Titles reach the server only with a new app; the full list is
 * encrypted (docs/requests/web-admin-app-list/), so everything else shows its package name.
 */
export function appTitle (state: FamilyState, packageName: string): string {
  for (const user of state.users.data) {
    const found = user.newApps?.find((app) => app.packageName === packageName)
    if (found && found.title !== '') return found.title
  }
  for (const item of Object.values(state.installedApps)) {
    const found = item.apps.find((app) => app.packageName === packageName)
    if (found) return found.title
  }
  return packageName
}

const SECTION_HINTS: Record<string, RegExp> = {
  game: /игр|game/i,
  video: /видео|video|youtube/i,
  audio: /музык|audio|music/i,
  social: /общен|social|чат/i
}

/** «В Игры» on a new app: the store section named by the tablet, matched against the family's own category titles. */
export function guessCategory (state: FamilyState, childId: string, section: string): string | null {
  const hint = SECTION_HINTS[section]
  if (!hint) return null
  return childCategories(state, childId).find((category) => hint.test(category.base.title))?.id ?? null
}

/** An app assigned on one tablet only; on that tablet it wins over the shared assignment (Android `AppSpecifier.kt`). */
export const deviceSpecifier = (packageName: string, deviceId: string): string => `${packageName}@${deviceId}`

export function categoryOfApp (state: FamilyState, childId: string, packageName: string): { id: string, title: string } | null {
  const found = childCategories(state, childId).find((category) => category.apps.includes(packageName))
  return found ? { id: found.id, title: found.base.title } : null
}

export interface AppTime { packageName: string, title: string, ms: number, byDevice: Record<string, number>, category: { id: string, title: string } | null }

/** Time per app, summed over the child's tablets and kept per tablet, for the given days, the longest first. */
export function appTimes (state: FamilyState, childId: string, usage: AppUsageItem[], fromDay: number, toDay: number): AppTime[] {
  const byApp = new Map<string, Record<string, number>>()
  for (const item of usage) {
    if (item.day < fromDay || item.day > toDay || item.ms <= 0) continue
    const byDevice = byApp.get(item.packageName) ?? {}
    byDevice[item.deviceId] = (byDevice[item.deviceId] ?? 0) + item.ms
    byApp.set(item.packageName, byDevice)
  }
  return [...byApp.entries()]
    .map(([packageName, byDevice]) => ({
      packageName,
      title: appTitle(state, packageName),
      ms: Object.values(byDevice).reduce((sum, ms) => sum + ms, 0),
      byDevice,
      category: categoryOfApp(state, childId, packageName)
    }))
    .sort((a, b) => b.ms - a.ms)
}

/** The package an app specifier names: `pkg`, `pkg@device` (one tablet) or `pkg:activity`. */
export const packageOf = (specifier: string): string => specifier.split(/[@:]/)[0]

export function newApps (state: FamilyState, childId: string) {
  const child = state.users.data.find((user) => user.id === childId)
  const names = new Map(state.devices.data.map((device) => [device.deviceId, device.name]))
  return (child?.newApps ?? []).map((app) => ({
    ...app,
    device: names.get(app.deviceId) ?? '',
    guess: guessCategory(state, childId, app.section)
  }))
}

export function deviceStatus (state: FamilyState, deviceId: string, now: number, usage: AppUsageItem[] | null, today: number) {
  const known = state.deviceStates?.find((item) => item.deviceId === deviceId)
  return {
    online: known !== undefined && now - known.seen < ONLINE_MS,
    seen: known?.seen ?? null,
    app: known && known.app !== '' ? appTitle(state, known.app) : null,
    todayMs: usage === null ? null : usage.filter((item) => item.deviceId === deviceId && item.day === today).reduce((sum, item) => sum + item.ms, 0)
  }
}

/** Everything the card of one app shows: the week by day, its category, its own rule, the allowance, per tablet. */
export function appCard (state: FamilyState, childId: string, packageName: string, now: number, usage: AppUsageItem[] | null) {
  const child = state.users.data.find((user) => user.id === childId)
  if (!child) throw new ParentConsoleError(`no user with id ${childId}`)
  const { fromDay, toDay } = usageDays(state, childId, now)
  const own = usage?.filter((item) => item.packageName === packageName) ?? null
  const days = own === null
    ? null
    : Array.from({ length: USAGE_DAYS }, (_, index) => {
      const day = fromDay + index
      return { day, ms: own.filter((item) => item.day === day).reduce((sum, item) => sum + item.ms, 0) }
    })
  const devices = state.devices.data.filter((device) => device.currentUserId === childId).map((device) => ({
    deviceId: device.deviceId,
    name: device.name,
    weekMs: own === null ? null : own.filter((item) => item.deviceId === device.deviceId).reduce((sum, item) => sum + item.ms, 0),
    category: categoryOfApp(state, childId, deviceSpecifier(packageName, device.deviceId))
  }))
  const rule = child.appRules?.find((item) => item.packageName === packageName) ?? null
  const allowance = child.appAllowances?.find((item) => item.packageName === packageName && item.until > now) ?? null
  return {
    packageName,
    title: appTitle(state, packageName),
    isNew: child.newApps?.some((app) => app.packageName === packageName) ?? false,
    category: categoryOfApp(state, childId, packageName),
    categories: childCategories(state, childId).map((category) => ({ id: category.id, title: category.base.title })),
    days,
    todayMs: days?.find((item) => item.day === toDay)?.ms ?? null,
    averageMs: days === null ? null : Math.round(days.reduce((sum, item) => sum + item.ms, 0) / USAGE_DAYS),
    devices,
    rule: rule === null ? null : { days: rule.days, limitMinutes: rule.limitMinutes },
    allowanceUntil: allowance?.until ?? null
  }
}
