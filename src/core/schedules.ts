import { SCHEDULE_SHAPE_HINT, type ScheduleKind, scheduleKind } from '../shared/schedules.ts'
import { addBanActions, type Ban, type BanSpec } from './bans.ts'
import { ParentConsoleError } from './errors.ts'
import type { ParentAction } from './protocol.ts'
import type { CategoryView } from './state.ts'

// @tag:ban-schedule

// ponytail: the launcher's and the school category are known by title only; a family that renamed
// them gets them ticked by default and unticks them once in the form
const ALLOWED_TITLE = /^(allowed( apps)?|erlaubte apps|разрешено|разрешённые( приложения)?|разрешенные( приложения)?)$/i
const EDUCATION_TITLE = /^(education|учёба|учеба|обучение|школа)$/i

/**
 * Categories a new sleep or study ban covers: every root category but the launcher's one — a ban on
 * it blanks the home screen — and, for study, but the school one.
 */
export function defaultScheduleCategories (kind: ScheduleKind, categories: CategoryView[]): string[] {
  return categories
    .filter((c) => !categories.some((p) => p.id === c.base.parentCategoryId))
    .filter((c) => !ALLOWED_TITLE.test(c.base.title.trim()))
    .filter((c) => kind === 'sleep' || !EDUCATION_TITLE.test(c.base.title.trim()))
    .map((c) => c.id)
}

export type ScheduleBan = BanSpec & { categoryIds: string[] }

/**
 * Replaces every ban recognised as `kind` with `wanted` — empty switches the schedule off. Taking a
 * list rather than one ban lets an undo put back several differently shaped bans exactly.
 */
export function setScheduleActions ({ categories, bans, kind, wanted }: {
  categories: CategoryView[], bans: Ban[], kind: ScheduleKind, wanted: ScheduleBan[]
}): ParentAction[] {
  for (const ban of wanted) {
    if (scheduleKind(ban) !== kind) throw new ParentConsoleError(`the ban ${ban.start}-${ban.end} is not a ${kind} time`, SCHEDULE_SHAPE_HINT[kind])
    if (ban.categoryIds.length === 0) throw new ParentConsoleError(`the ${kind} ban has no categories`, 'tick at least one category')
  }
  const removed = bans.filter((ban) => !ban.legacy && scheduleKind(ban) === kind).flatMap((ban) => ban.ruleRefs.map((ref) => ref.ruleId))
  const removedSet = new Set(removed)
  const remaining = categories.map((c) => ({ ...c, rules: c.rules.filter((r) => !removedSet.has(r.id)) }))
  return [
    ...removed.map((ruleId): ParentAction => ({ type: 'DELETE_TIMELIMIT_RULE', ruleId })),
    ...wanted.flatMap((ban) => addBanActions(remaining.filter((c) => ban.categoryIds.includes(c.id)), ban))
  ]
}
