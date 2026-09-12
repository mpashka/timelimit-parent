/*
 * Wire types of the TimeLimit sync protocol.
 * Copied in part from timelimit-server (src/object/*.ts, src/action/*.ts),
 * Copyright (C) 2019 - 2026 Jonas Lochmann, GNU AGPL-3.0.
 * Only the fields this client reads or sends are kept.
 */

// @tag:parent-console

export interface ServerDataStatus {
  devices?: { version: string, data: ServerDevice[] }
  apps?: Array<{ deviceId: string, version: string, apps: InstalledApp[] }>
  rmCategories?: string[]
  categoryBase?: ServerCategoryBase[]
  categoryApp?: Array<{ categoryId: string, apps: string[], version: string }>
  usedTimes?: Array<{ categoryId: string, times: UsedTimeItem[], version: string }>
  rules?: Array<{ categoryId: string, version: string, rules: ServerRule[] }>
  tasks?: Array<{ categoryId: string, version: string, tasks: unknown[] }>
  users?: { version: string, data: ServerUser[] }
  fullVersion: number
  message?: string
  apiLevel: number
}

export interface ClientDataStatus {
  devices: string
  apps: Record<string, string>
  categories: Record<string, { base: string, apps: string, rules: string, usedTime: string, tasks?: string }>
  users: string
  clientLevel?: number
}

export interface ServerDevice {
  deviceId: string
  name: string
  model: string
  currentUserId: string
  cAppVersion: number
  isUserKeptSignedIn: boolean
}

export interface InstalledApp {
  packageName: string
  title: string
  isLaunchable: boolean
}

export interface UrlFilter {
  enabled: boolean
  allow: string[]
  block: string[]
}

export interface ServerUser {
  id: string
  name: string
  password?: string
  secondPasswordSalt?: string
  type: 'parent' | 'child'
  timeZone: string
  disableLimitsUntil: number
  mail: string
  currentDevice: string
  categoryForNotAssignedApps: string
  blockedTimes: string
  flags: number
  urlFilter?: UrlFilter
}

export interface ServerCategoryBase {
  categoryId: string
  childId: string
  title: string
  blockedTimes: string
  extraTime: number
  extraTimeDay: number
  tempBlocked: boolean
  tempBlockTime: number
  version: string
  parentCategoryId: string
  blockAllNotifications: boolean
  timeWarnings: number
  mblCharging: number
  mblMobile: number
  sort: number
  dlu: number
  flags: number
  blockNotificationDelay: number
}

export interface UsedTimeItem {
  day: number
  time: number
  start: number
  end: number
}

export interface ServerRule {
  id: string
  extraTime: boolean
  dayMask: number
  maxTime: number
  start: number
  end: number
  session: number
  pause: number
  perDay: boolean
  e?: number
}

export interface SerializedRule {
  ruleId: string
  categoryId: string
  time: number
  days: number
  extraTime: boolean
  start: number
  end: number
  dur: number
  pause: number
  perDay: boolean
}

export type ParentAction =
  | { type: 'ADD_USER', userId: string, name: string, userType: 'child', timeZone: string }
  | { type: 'UPDATE_USER_FLAGS', userId: string, modified: number, values: number }
  | { type: 'CREATE_CATEGORY', childId: string, categoryId: string, title: string }
  | { type: 'UPDATE_CATEGORY_TITLE', categoryId: string, newTitle: string }
  | { type: 'SET_PARENT_CATEGORY', categoryId: string, parentCategory: string }
  | { type: 'UPDATE_CATEGORY_FLAGS', categoryId: string, modified: number, values: number }
  | { type: 'UPDATE_CATEGORY_BLOCKED_TIMES', categoryId: string, times: string }
  | { type: 'UPDATE_CATEGORY_BLOCK_ALL_NOTIFICATIONS', categoryId: string, blocked: boolean, blockDelay?: number }
  | { type: 'UPDATE_CATEGORY_TIME_WARNINGS', categoryId: string, enable: boolean, flags: number, minutes?: number }
  | { type: 'UPDATE_CATEGORY_BATTERY_LIMIT', categoryId: string, chargeLimit?: number, mobileLimit?: number }
  | { type: 'UPDATE_CATEGORY_SORTING', categoryIds: string[] }
  | { type: 'SET_CATEGORY_FOR_UNASSIGNED_APPS', childId: string, categoryId: string }
  | { type: 'CREATE_TIMELIMIT_RULE', rule: SerializedRule }
  | { type: 'UPDATE_TIMELIMIT_RULE', ruleId: string, time: number, days: number, extraTime: boolean, start: number, end: number, dur: number, pause: number, perDay: boolean }
  | { type: 'DELETE_TIMELIMIT_RULE', ruleId: string }
  | { type: 'ADD_CATEGORY_APPS', categoryId: string, packageNames: string[] }
  | { type: 'REMOVE_CATEGORY_APPS', categoryId: string, packageNames: string[] }
  | { type: 'INCREMENT_CATEGORY_EXTRATIME', categoryId: string, addedExtraTime: number, day: number }
  | { type: 'UPDATE_CATEGORY_DISABLE_LIMITS', categoryId: string, endTime: number }
  | { type: 'SET_USER_DISABLE_LIMITS_UNTIL', childId: string, time: number }
  | { type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId: string, blocked: boolean, endTime?: number }
  | { type: 'UPDATE_USER_URL_FILTER', userId: string, enabled: boolean, allow: string[], block: string[] }

export const MINUTE_MAX = 24 * 60 - 1
export const URL_FILTER_API_LEVEL = 10
export const ALL_DAYS = 127
export const USER_FLAGS_ALL = 1 | 2
