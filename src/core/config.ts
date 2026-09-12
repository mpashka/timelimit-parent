import { banKey, banSegments, readBans } from './bans.ts'
import { ParentConsoleError } from './errors.ts'
import { generateId } from './ids.ts'
import { categoryDepthOrder } from './overview.ts'
import { setUrlFilter, validateUrlFilter } from './operations.ts'
import { MINUTE_MAX, type ParentAction, type ServerRule, type SerializedRule, type UrlFilter, USER_FLAGS_ALL } from './protocol.ts'
import { type CategoryView, childCategories, type FamilyState } from './state.ts'
import { formatClock, formatDays, parseClock, parseDays } from './time.ts'

// @tag:parent-console

export const CONFIG_FORMAT = 'timelimit-parent/config@1'
export const TEMPLATE_FORMAT = 'timelimit-parent/template@1'
/** Category title in a template that means every root category of the child except `exceptCategories`. */
export const ALL_ROOTS = '*'

export interface PortableLimit {
  days: string
  minutes: number
  from?: string
  to?: string
  extraTime?: boolean
  perDay?: boolean
  sessionMinutes?: number
  pauseMinutes?: number
}

export interface PortableBan {
  days: string
  from: string
  to: string
  hard?: boolean
}

export interface PortableCategory {
  title: string
  parent?: string | null
  apps?: string[]
  limits?: PortableLimit[]
  bans?: PortableBan[]
  legacyBlockedTimes?: string
  blockAllNotifications?: { delayMs: number } | null
  timeWarnings?: number
  battery?: { charging: number, mobile: number }
}

export interface PortableConfig {
  format: typeof CONFIG_FORMAT | typeof TEMPLATE_FORMAT
  name?: string
  description?: string
  child?: { name: string, timeZone: string, flags: number }
  categories: PortableCategory[]
  exceptCategories?: string[]
  categoryForUnassignedApps?: string | null
  urlFilter?: UrlFilter
}

export function exportChild (state: FamilyState, childId: string): PortableConfig {
  const child = state.users.data.find((u) => u.id === childId && u.type === 'child')
  if (!child) throw new ParentConsoleError(`no child with id ${childId}`)
  const ordered = categoryDepthOrder(childCategories(state, childId)).map((item) => item.category)
  const titles = new Map<string, string>()
  for (const category of ordered) {
    let title = category.base.title
    for (let n = 2; [...titles.values()].some((t) => t.toLowerCase() === title.toLowerCase()); n++) title = `${category.base.title} (${n})`
    titles.set(category.id, title)
  }
  const categories = ordered.map((category): PortableCategory => {
    const base = category.base
    const limits = category.rules.filter((r) => r.maxTime > 0 && r.e === undefined).map(toPortableLimit)
    const bans = readBans([category]).map((ban): PortableBan => ({
      days: formatDays(ban.days), from: formatClock(ban.start), to: formatClock((ban.end + 1) % 1440), ...(ban.hard ? {} : { hard: false })
    }))
    return {
      title: titles.get(category.id)!,
      ...(titles.has(base.parentCategoryId) ? { parent: titles.get(base.parentCategoryId) } : {}),
      ...(category.apps.length > 0 ? { apps: [...category.apps].sort() } : {}),
      ...(limits.length > 0 ? { limits } : {}),
      ...(bans.length > 0 ? { bans } : {}),
      ...(base.blockedTimes ? { legacyBlockedTimes: base.blockedTimes } : {}),
      ...(base.blockAllNotifications ? { blockAllNotifications: { delayMs: base.blockNotificationDelay } } : {}),
      ...(base.timeWarnings ? { timeWarnings: base.timeWarnings } : {}),
      ...(base.mblCharging || base.mblMobile ? { battery: { charging: base.mblCharging, mobile: base.mblMobile } } : {})
    }
  })
  return {
    format: CONFIG_FORMAT,
    child: { name: child.name, timeZone: child.timeZone, flags: child.flags },
    categories,
    ...(titles.has(child.categoryForNotAssignedApps) ? { categoryForUnassignedApps: titles.get(child.categoryForNotAssignedApps) } : {}),
    ...(child.urlFilter ? { urlFilter: child.urlFilter } : {})
  }
}

function toPortableLimit (rule: ServerRule): PortableLimit {
  return {
    days: formatDays(rule.dayMask),
    minutes: rule.maxTime / 60000,
    ...(rule.start !== 0 || rule.end !== MINUTE_MAX ? { from: formatClock(rule.start), to: formatClock(rule.end + 1) } : {}),
    ...(rule.extraTime ? { extraTime: true } : {}),
    ...(rule.perDay ? {} : { perDay: false }),
    ...(rule.session > 0 ? { sessionMinutes: rule.session / 60000, pauseMinutes: rule.pause / 60000 } : {})
  }
}

type RuleShape = Omit<SerializedRule, 'ruleId' | 'categoryId'>

const ruleSignature = (r: RuleShape): string => r.time === 0
  ? `ban ${r.days} ${r.start} ${r.end} ${r.extraTime}`
  : `limit ${r.time} ${r.days} ${r.start} ${r.end} ${r.extraTime} ${r.perDay} ${r.dur} ${r.pause}`

const serverRuleShape = (r: ServerRule): RuleShape =>
  ({ time: r.maxTime, days: r.dayMask, extraTime: r.extraTime, start: r.start, end: r.end, dur: r.session, pause: r.pause, perDay: r.perDay })

function limitShapes (limit: PortableLimit): RuleShape[] {
  const start = limit.from ? parseClock(limit.from) : 0
  const end = limit.to ? parseClock(limit.to) - 1 : MINUTE_MAX
  if (!(limit.minutes > 0)) throw new ParentConsoleError(`limit minutes must be positive, got ${limit.minutes}`)
  if (start > end) throw new ParentConsoleError(`limit window ${limit.from}-${limit.to} must not cross midnight`, 'split it into two limits')
  return [{
    time: Math.round(limit.minutes * 60000), days: parseDays(limit.days), extraTime: limit.extraTime ?? false, start, end,
    dur: Math.round((limit.sessionMinutes ?? 0) * 60000), pause: Math.round((limit.pauseMinutes ?? 0) * 60000), perDay: limit.perDay ?? true
  }]
}

function banShapes (ban: PortableBan): RuleShape[] {
  const hard = ban.hard ?? true
  const start = parseClock(ban.from) % 1440
  const end = (parseClock(ban.to) + 1439) % 1440
  return banSegments({ days: parseDays(ban.days), start, end, hard })
    .map((s) => ({ time: 0, days: s.days, extraTime: hard, start: s.start, end: s.end, dur: 0, pause: 0, perDay: false }))
}

export type ImportTarget = { childId: string } | { newChild: { name: string, timeZone?: string } }

export interface ImportPlan {
  childId: string
  actions: ParentAction[]
  warnings: string[]
}

/**
 * Turns a config or template into actions against a child. `merge` only adds what is missing;
 * `replace` also deletes rules and apps of the touched categories that the config does not list.
 */
export function planImport ({ state, target, config, mode = 'merge' }: {
  state: FamilyState, target: ImportTarget, config: PortableConfig, mode?: 'merge' | 'replace'
}): ImportPlan {
  if (config.format !== CONFIG_FORMAT && config.format !== TEMPLATE_FORMAT) {
    throw new ParentConsoleError(`unknown config format "${String(config.format)}"`, `expected ${CONFIG_FORMAT} or ${TEMPLATE_FORMAT}`)
  }
  const actions: ParentAction[] = []
  const warnings: string[] = []
  let childId: string
  let existing: CategoryView[]

  if ('newChild' in target) {
    childId = generateId()
    const timeZone = target.newChild.timeZone ?? config.child?.timeZone
    if (!timeZone) throw new ParentConsoleError('a new child needs a time zone', 'pass --time-zone, e.g. Europe/Moscow')
    actions.push({ type: 'ADD_USER', userId: childId, name: target.newChild.name, userType: 'child', timeZone })
    const flags = (config.child?.flags ?? 0) & USER_FLAGS_ALL
    if (flags) actions.push({ type: 'UPDATE_USER_FLAGS', userId: childId, modified: flags, values: flags })
    existing = []
  } else {
    childId = target.childId
    if (!state.users.data.some((u) => u.id === childId && u.type === 'child')) throw new ParentConsoleError(`no child with id ${childId}`)
    existing = childCategories(state, childId)
  }

  const idByTitle = new Map<string, string>()
  const currentParent = new Map<string, string>()
  for (const category of existing) {
    idByTitle.set(category.base.title.toLowerCase(), category.id)
    currentParent.set(category.id, category.base.parentCategoryId)
  }
  const created: string[] = []
  const namedCategories = config.categories.filter((c) => c.title !== ALL_ROOTS)
  for (const item of namedCategories) {
    if (idByTitle.has(item.title.toLowerCase())) continue
    const categoryId = generateId()
    idByTitle.set(item.title.toLowerCase(), categoryId)
    currentParent.set(categoryId, '')
    created.push(categoryId)
    actions.push({ type: 'CREATE_CATEGORY', childId, categoryId, title: item.title })
    if (!item.apps?.length) warnings.push(`category "${item.title}" is created empty: move apps into it or it limits nothing`)
  }
  const idOf = (title: string): string => {
    const id = idByTitle.get(title.toLowerCase())
    if (!id) throw new ParentConsoleError(`config refers to category "${title}" which neither exists nor is defined in the config`)
    return id
  }

  for (const item of namedCategories) {
    if (item.parent === undefined) continue
    const categoryId = idOf(item.title)
    const parentId = item.parent === null ? '' : idOf(item.parent)
    if (currentParent.get(categoryId) !== parentId) {
      actions.push({ type: 'SET_PARENT_CATEGORY', categoryId, parentCategory: parentId })
      currentParent.set(categoryId, parentId)
    }
  }
  const excluded = new Set((config.exceptCategories ?? []).map((title) => idByTitle.get(title.toLowerCase())))
  const rootIds = [...currentParent.keys()].filter((id) => !currentParent.has(currentParent.get(id)!) && !excluded.has(id))

  const desired = new Map<string, Map<string, RuleShape>>()
  const touched = new Set<string>()
  for (const item of config.categories) {
    const ids = item.title === ALL_ROOTS ? rootIds : [idOf(item.title)]
    const shapes = [...(item.limits ?? []).flatMap(limitShapes), ...(item.bans ?? []).flatMap(banShapes)]
    for (const id of ids) {
      if (item.limits || item.bans) touched.add(id)
      const map = desired.get(id) ?? new Map<string, RuleShape>()
      for (const shape of shapes) map.set(ruleSignature(shape), shape)
      desired.set(id, map)
    }
  }
  for (const [categoryId, shapes] of desired) {
    const current = existing.find((c) => c.id === categoryId)?.rules.filter((r) => r.e === undefined) ?? []
    const currentSignatures = new Set(current.map((r) => ruleSignature(serverRuleShape(r))))
    for (const [signature, shape] of shapes) {
      if (!currentSignatures.has(signature)) actions.push({ type: 'CREATE_TIMELIMIT_RULE', rule: { ruleId: generateId(), categoryId, ...shape } })
    }
    if (mode === 'replace' && touched.has(categoryId)) {
      for (const rule of current) {
        if (!shapes.has(ruleSignature(serverRuleShape(rule)))) actions.push({ type: 'DELETE_TIMELIMIT_RULE', ruleId: rule.id })
      }
    }
  }

  for (const item of namedCategories) {
    const categoryId = idOf(item.title)
    const category = existing.find((c) => c.id === categoryId)
    const base = category?.base
    const apps = category?.apps ?? []
    if (item.apps) {
      const missing = item.apps.filter((app) => !apps.includes(app))
      if (missing.length > 0) actions.push({ type: 'ADD_CATEGORY_APPS', categoryId, packageNames: missing })
      const extra = apps.filter((app) => !item.apps!.includes(app))
      if (mode === 'replace' && extra.length > 0) actions.push({ type: 'REMOVE_CATEGORY_APPS', categoryId, packageNames: extra })
    }
    if (item.legacyBlockedTimes !== undefined && item.legacyBlockedTimes !== (base?.blockedTimes ?? '')) {
      actions.push({ type: 'UPDATE_CATEGORY_BLOCKED_TIMES', categoryId, times: item.legacyBlockedTimes })
    }
    if (item.blockAllNotifications !== undefined) {
      const blocked = item.blockAllNotifications !== null
      const delay = item.blockAllNotifications?.delayMs ?? 0
      if (blocked !== (base?.blockAllNotifications ?? false) || (blocked && delay !== base?.blockNotificationDelay)) {
        actions.push({ type: 'UPDATE_CATEGORY_BLOCK_ALL_NOTIFICATIONS', categoryId, blocked, ...(blocked ? { blockDelay: delay } : {}) })
      }
    }
    if (item.timeWarnings !== undefined) {
      const current = base?.timeWarnings ?? 0
      const add = item.timeWarnings & ~current
      const remove = current & ~item.timeWarnings
      if (add) actions.push({ type: 'UPDATE_CATEGORY_TIME_WARNINGS', categoryId, enable: true, flags: add })
      if (remove) actions.push({ type: 'UPDATE_CATEGORY_TIME_WARNINGS', categoryId, enable: false, flags: remove })
    }
    if (item.battery && (item.battery.charging !== (base?.mblCharging ?? 0) || item.battery.mobile !== (base?.mblMobile ?? 0))) {
      actions.push({ type: 'UPDATE_CATEGORY_BATTERY_LIMIT', categoryId, chargeLimit: item.battery.charging, mobileLimit: item.battery.mobile })
    }
  }

  if ('newChild' in target && created.length > 0) {
    actions.push({ type: 'UPDATE_CATEGORY_SORTING', categoryIds: created })
  }

  const child = state.users.data.find((u) => u.id === childId)
  if (config.categoryForUnassignedApps !== undefined) {
    const categoryId = config.categoryForUnassignedApps === null ? '' : idOf(config.categoryForUnassignedApps)
    if ((child?.categoryForNotAssignedApps ?? '') !== categoryId) actions.push({ type: 'SET_CATEGORY_FOR_UNASSIGNED_APPS', childId, categoryId })
  }

  if (config.urlFilter && JSON.stringify(config.urlFilter) !== JSON.stringify(child?.urlFilter)) {
    try {
      actions.push(...setUrlFilter({ state, childId, filter: config.urlFilter }))
    } catch (ex) {
      if (!(ex instanceof ParentConsoleError)) throw ex
      warnings.push(`url filter skipped: ${ex.message}`)
    }
  }

  return { childId, actions, warnings }
}

/** Stacks templates: bans are united, limits with the same days and window keep the smallest minutes, url lists are united. */
export function overlayConfigs (configs: PortableConfig[]): PortableConfig {
  const categories = new Map<string, PortableCategory>()
  let urlFilter: UrlFilter | undefined
  const except = new Set<string>()
  for (const config of configs) {
    for (const title of config.exceptCategories ?? []) except.add(title)
    for (const item of config.categories) {
      const key = item.title.toLowerCase()
      const target = categories.get(key) ?? { title: item.title }
      categories.set(key, target)
      if (item.parent !== undefined) target.parent = item.parent
      if (item.apps) target.apps = [...new Set([...(target.apps ?? []), ...item.apps])]
      if (item.bans) {
        const bans = new Map((target.bans ?? []).map((b) => [portableBanKey(b), b]))
        for (const ban of item.bans) bans.set(portableBanKey(ban), ban)
        target.bans = [...bans.values()]
      }
      if (item.limits) {
        const limits = new Map((target.limits ?? []).map((l) => [portableLimitKey(l), l]))
        for (const limit of item.limits) {
          const key = portableLimitKey(limit)
          const current = limits.get(key)
          if (!current || limit.minutes < current.minutes) limits.set(key, limit)
        }
        target.limits = [...limits.values()]
      }
    }
    if (config.urlFilter) {
      urlFilter = {
        enabled: (urlFilter?.enabled ?? false) || config.urlFilter.enabled,
        allow: [...new Set([...(urlFilter?.allow ?? []), ...config.urlFilter.allow])],
        block: [...new Set([...(urlFilter?.block ?? []), ...config.urlFilter.block])]
      }
    }
  }
  if (urlFilter) validateUrlFilter(urlFilter)
  return {
    format: TEMPLATE_FORMAT,
    name: configs.map((c) => c.name).filter(Boolean).join(' + '),
    categories: [...categories.values()],
    ...(except.size > 0 ? { exceptCategories: [...except] } : {}),
    ...(urlFilter ? { urlFilter } : {})
  }
}

const portableBanKey = (ban: PortableBan): string => {
  const start = parseClock(ban.from) % 1440
  return banKey({ days: parseDays(ban.days), start, end: (parseClock(ban.to) + 1439) % 1440, hard: ban.hard ?? true })
}

const portableLimitKey = (limit: PortableLimit): string =>
  `${parseDays(limit.days)} ${limit.from ?? ''} ${limit.to ?? ''} ${limit.sessionMinutes ?? 0}`
