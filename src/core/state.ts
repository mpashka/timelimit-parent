import { CLIENT_LEVEL } from './api.ts'
import type {
  ClientDataStatus, InstalledApp, ServerCategoryBase, ServerDataStatus, ServerDevice, ServerRule, ServerUser, UsedTimeItem
} from './protocol.ts'

// @tag:parent-console

export type User = Omit<ServerUser, 'password' | 'secondPasswordSalt'>

export interface Category {
  id: string
  base?: ServerCategoryBase
  apps: string[]
  rules: ServerRule[]
  usedTimes: UsedTimeItem[]
  versions: { base: string, apps: string, rules: string, usedTime: string, tasks: string }
}

export interface FamilyState {
  apiLevel: number
  fullVersion: number
  message?: string
  devices: { version: string, data: ServerDevice[] }
  users: { version: string, data: User[] }
  installedApps: Record<string, { version: string, apps: InstalledApp[] }>
  categories: Record<string, Category>
}

export const createEmptyState = (): FamilyState => ({
  apiLevel: 0,
  fullVersion: 0,
  devices: { version: '', data: [] },
  users: { version: '', data: [] },
  installedApps: {},
  categories: {}
})

export function toClientStatus (state: FamilyState): ClientDataStatus {
  const categories: ClientDataStatus['categories'] = {}
  for (const category of Object.values(state.categories)) {
    categories[category.id] = {
      base: category.versions.base,
      apps: category.versions.apps,
      rules: category.versions.rules,
      usedTime: category.versions.usedTime,
      tasks: category.versions.tasks
    }
  }
  return {
    devices: state.devices.version,
    apps: Object.fromEntries(Object.entries(state.installedApps).map(([deviceId, item]) => [deviceId, item.version])),
    categories,
    users: state.users.version,
    clientLevel: CLIENT_LEVEL
  }
}

export function mergeServerStatus (previous: FamilyState, status: ServerDataStatus): FamilyState {
  const state: FamilyState = structuredClone(previous)
  state.apiLevel = status.apiLevel
  state.fullVersion = status.fullVersion
  state.message = status.message

  if (status.devices) state.devices = status.devices
  if (status.users) {
    state.users = {
      version: status.users.version,
      data: status.users.data.map(({ password: _password, secondPasswordSalt: _salt, ...user }) => user)
    }
  }
  for (const item of status.apps ?? []) {
    state.installedApps[item.deviceId] = { version: item.version, apps: item.apps }
  }
  for (const id of status.rmCategories ?? []) delete state.categories[id]

  const categoryOf = (id: string): Category => {
    state.categories[id] ??= {
      id, apps: [], rules: [], usedTimes: [], versions: { base: '', apps: '', rules: '', usedTime: '', tasks: '' }
    }
    return state.categories[id]
  }
  for (const base of status.categoryBase ?? []) {
    const category = categoryOf(base.categoryId)
    category.base = base
    category.versions.base = base.version
  }
  for (const item of status.categoryApp ?? []) {
    const category = categoryOf(item.categoryId)
    category.apps = item.apps
    category.versions.apps = item.version
  }
  for (const item of status.rules ?? []) {
    const category = categoryOf(item.categoryId)
    category.rules = item.rules
    category.versions.rules = item.version
  }
  for (const item of status.usedTimes ?? []) {
    const category = categoryOf(item.categoryId)
    category.usedTimes = item.times
    category.versions.usedTime = item.version
  }
  for (const item of status.tasks ?? []) {
    categoryOf(item.categoryId).versions.tasks = item.version
  }
  return state
}

export interface CategoryView extends Category {
  base: ServerCategoryBase
}

export function childCategories (state: FamilyState, childId: string): CategoryView[] {
  return Object.values(state.categories)
    .filter((c): c is CategoryView => c.base !== undefined && c.base.childId === childId)
    .sort((a, b) => a.base.sort - b.base.sort || a.base.title.localeCompare(b.base.title))
}

export const children = (state: FamilyState): User[] => state.users.data.filter((u) => u.type === 'child')
