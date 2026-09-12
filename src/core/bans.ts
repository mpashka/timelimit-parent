import { generateId } from './ids.ts'
import { MINUTE_MAX, type ParentAction, type ServerRule } from './protocol.ts'
import type { CategoryView } from './state.ts'
import { formatClock, formatDays, rotateDays } from './time.ts'

// @tag:parent-console

/**
 * A ban forbids a set of categories from `start` to `end` (both minutes of day, end inclusive)
 * on the days where the ban starts. `start > end` means it runs past midnight. It is not
 * stored anywhere: it is expanded into rules with `time = 0` and read back by grouping them.
 * `hard` maps to the rule flag `extraTime`: a hard ban is not bypassed by extra time.
 */
export interface Ban {
  days: number
  start: number
  end: number
  hard: boolean
  categoryIds: string[]
  ruleRefs: Array<{ categoryId: string, ruleId: string }>
  legacy?: boolean
}

export type BanSpec = Pick<Ban, 'days' | 'start' | 'end' | 'hard'>

export interface Segment { days: number, start: number, end: number }

export function banSegments ({ days, start, end }: BanSpec): Segment[] {
  if (start <= end) return [{ days, start, end }]
  return [{ days, start, end: MINUTE_MAX }, { days: rotateDays(days), start: 0, end }]
}

export const isBanRule = (rule: ServerRule): boolean => rule.maxTime === 0 && rule.e === undefined

export function banKey ({ days, start, end, hard }: BanSpec): string {
  return `${formatDays(days)} ${formatClock(start)}-${formatClock((end + 1) % 1440)}${hard ? '' : ' soft'}`
}

function categoryBans (category: CategoryView): Ban[] {
  const segments = category.rules.filter(isBanRule)
  const used = new Set<string>()
  const result: Ban[] = []
  const toBan = (rule: ServerRule, end = rule.end, extra?: ServerRule): Ban => ({
    days: rule.dayMask,
    start: rule.start,
    end,
    hard: rule.extraTime,
    categoryIds: [category.id],
    ruleRefs: [rule, ...(extra ? [extra] : [])].map((r) => ({ categoryId: category.id, ruleId: r.id }))
  })
  for (const evening of segments) {
    if (evening.end !== MINUTE_MAX || evening.start === 0 || used.has(evening.id)) continue
    const morning = segments.find((m) => !used.has(m.id) && m.start === 0 && m.end !== MINUTE_MAX &&
      m.dayMask === rotateDays(evening.dayMask) && m.extraTime === evening.extraTime)
    if (morning) {
      used.add(evening.id).add(morning.id)
      result.push(toBan(evening, morning.end, morning))
    }
  }
  for (const rule of segments) {
    if (!used.has(rule.id)) result.push(toBan(rule))
  }
  return result
}

export function groupBans (bans: Ban[]): Ban[] {
  const byKey = new Map<string, Ban>()
  for (const ban of bans) {
    const key = banKey(ban) + (ban.legacy ? ' legacy' : '')
    const existing = byKey.get(key)
    if (existing) {
      existing.categoryIds.push(...ban.categoryIds.filter((id) => !existing.categoryIds.includes(id)))
      existing.ruleRefs.push(...ban.ruleRefs)
    } else {
      byKey.set(key, { ...ban, categoryIds: [...ban.categoryIds], ruleRefs: [...ban.ruleRefs] })
    }
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.days - b.days || a.end - b.end)
}

export const readBans = (categories: CategoryView[]): Ban[] => groupBans(categories.flatMap(categoryBans))

export function parseLegacyBlockedTimes (encoded: string): Array<[number, number]> {
  const numbers = encoded.split(',').filter((s) => s.trim() !== '').map(Number)
  const intervals: Array<[number, number]> = []
  for (let i = 0; i + 1 < numbers.length; i += 2) intervals.push([numbers[i], numbers[i + 1]])
  const week = 7 * 1440
  if (intervals.length > 1 && intervals[0][0] === 0 && intervals[intervals.length - 1][1] === week) {
    const first = intervals.shift()!
    intervals[intervals.length - 1][1] = week + first[1]
  }
  return intervals
}

export function readLegacyBans (categories: CategoryView[]): Ban[] {
  const bans: Ban[] = []
  for (const category of categories) {
    for (const [from, to] of parseLegacyBlockedTimes(category.base.blockedTimes)) {
      const last = to - 1
      const push = (day: number, start: number, end: number) => bans.push({
        days: 1 << (day % 7), start, end, hard: true, categoryIds: [category.id], ruleRefs: [], legacy: true
      })
      if (last - from < 1440 && Math.floor(last / 1440) !== Math.floor(from / 1440) && last % 1440 < from % 1440) {
        push(Math.floor(from / 1440), from % 1440, last % 1440)
        continue
      }
      for (let day = Math.floor(from / 1440); day <= Math.floor(last / 1440); day++) {
        push(day, Math.max(from - day * 1440, 0), Math.min(last - day * 1440, MINUTE_MAX))
      }
    }
  }
  const byShape = new Map<string, Ban>()
  for (const ban of bans) {
    const key = `${ban.categoryIds[0]} ${ban.start} ${ban.end}`
    const existing = byShape.get(key)
    if (existing) existing.days |= ban.days
    else byShape.set(key, ban)
  }
  return groupBans([...byShape.values()])
}

export function banRule ({ categoryId, segment, hard, ruleId = generateId() }: { categoryId: string, segment: Segment, hard: boolean, ruleId?: string }): ParentAction {
  return {
    type: 'CREATE_TIMELIMIT_RULE',
    rule: { ruleId, categoryId, time: 0, days: segment.days, extraTime: hard, start: segment.start, end: segment.end, dur: 0, pause: 0, perDay: false }
  }
}

export function addBanActions (categories: CategoryView[], ban: BanSpec): ParentAction[] {
  const actions: ParentAction[] = []
  for (const category of categories) {
    for (const segment of banSegments(ban)) {
      const exists = category.rules.some((r) => isBanRule(r) && r.dayMask === segment.days && r.start === segment.start &&
        r.end === segment.end && r.extraTime === ban.hard)
      if (!exists) actions.push(banRule({ categoryId: category.id, segment, hard: ban.hard }))
    }
  }
  return actions
}

export function removeBanActions (ban: Ban, categoryIds: string[] = ban.categoryIds): ParentAction[] {
  return ban.ruleRefs
    .filter((ref) => categoryIds.includes(ref.categoryId))
    .map((ref) => ({ type: 'DELETE_TIMELIMIT_RULE', ruleId: ref.ruleId }))
}

/**
 * Deletes `removeRuleIds` and adds `ban` on `categoryIds` as one change: rules being deleted do not count as
 * already existing, so editing only the categories of a ban keeps its segments. Covers edit, delete and their undo.
 */
export function replaceBanActions ({ categories, removeRuleIds, ban, categoryIds }: {
  categories: CategoryView[], removeRuleIds: string[], ban: BanSpec, categoryIds: string[]
}): ParentAction[] {
  const removed = new Set(removeRuleIds)
  const targets = categories
    .filter((c) => categoryIds.includes(c.id))
    .map((c) => ({ ...c, rules: c.rules.filter((r) => !removed.has(r.id)) }))
  return [...removeRuleIds.map((ruleId): ParentAction => ({ type: 'DELETE_TIMELIMIT_RULE', ruleId })), ...addBanActions(targets, ban)]
}

export const createdRuleIds = (actions: ParentAction[]): string[] =>
  actions.flatMap((a) => a.type === 'CREATE_TIMELIMIT_RULE' ? [a.rule.ruleId] : [])

export function isBanActiveAt (ban: BanSpec, dayOfWeek: number, minuteOfDay: number): boolean {
  return banSegments(ban).some((s) => (s.days & (1 << dayOfWeek)) !== 0 && minuteOfDay >= s.start && minuteOfDay <= s.end)
}
