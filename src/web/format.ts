import type { BanSpec } from '../core/bans.ts'
import { ApiError, ParentConsoleError } from '../core/errors.ts'
import { dailyLimitRules } from '../core/operations.ts'
import type { Loophole } from '../core/overview.ts'
import { ALL_DAYS, MINUTE_MAX } from '../core/protocol.ts'
import type { CategoryView } from '../core/state.ts'
import { formatClock, localTime, timestampAt } from '../core/time.ts'

// @tag:parent-console

export const DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

export function formatDuration (ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60000), 0)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  return m === 0 ? `${h} ч` : `${h} ч ${String(m).padStart(2, '0')} мин`
}

export function formatDaysRu (mask: number): string {
  if (mask === ALL_DAYS) return 'пн–вс'
  const parts: string[] = []
  for (let i = 0; i < 7; i++) {
    if ((mask & (1 << i)) === 0) continue
    let j = i
    while (j + 1 < 7 && (mask & (1 << (j + 1))) !== 0) j++
    parts.push(j - i >= 2 ? `${DAY_NAMES[i]}–${DAY_NAMES[j]}` : DAY_NAMES.slice(i, j + 1).join(', '))
    i = j
  }
  return parts.join(', ')
}

export const clockAfter = (endInclusive: number): string => endInclusive === MINUTE_MAX ? '24:00' : formatClock(endInclusive + 1)

export const banLabel = (ban: BanSpec): string => `${formatClock(ban.start)}–${clockAfter(ban.end)}, ${formatDaysRu(ban.days)}`

/** When an active ban lets go: its end today, or tomorrow if now is in the evening part of an overnight ban. */
export function banEndsAt (ban: BanSpec, now: number, timeZone: string): number {
  const local = localTime(now, timeZone)
  const endsTomorrow = ban.start > ban.end && local.minuteOfDay >= ban.start
  return timestampAt({ dayOfEpoch: local.dayOfEpoch + (endsTomorrow ? 1 : 0), minuteOfDay: ban.end + 1 }, timeZone)
}

export function formatUntil (timestamp: number, now: number, timeZone: string): string {
  const target = localTime(timestamp, timeZone)
  const today = localTime(now, timeZone).dayOfEpoch
  const clock = formatClock(target.minuteOfDay)
  if (target.dayOfEpoch === today) return `до ${clock}`
  if (target.dayOfEpoch === today + 1) return `до завтра ${clock}`
  return `до ${dayLabel(target.dayOfEpoch)} ${clock}`
}

export function dayLabel (dayOfEpoch: number): string {
  const date = new Date(dayOfEpoch * 86400000)
  const weekday = DAY_NAMES[(date.getUTCDay() + 6) % 7]
  return `${weekday} ${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Whole-day limit as the pult edits it: one number for all days, or `mixed` when the app set different ones. */
export function dailyLimitOf (category: CategoryView): { minutes: number | null, mixed: boolean } {
  const rules = dailyLimitRules(category)
  if (rules.length === 0) return { minutes: null, mixed: false }
  const uniform = rules.length === 1 && rules[0].dayMask === ALL_DAYS
  return { minutes: Math.round(Math.min(...rules.map((r) => r.maxTime)) / 60000), mixed: !uniform }
}

export function loopholeText (loophole: Loophole, titles: Map<string, string>, now: number, timeZone: string, disabledUntil?: number | null): string {
  const title = `«${titles.get(loophole.categoryId) ?? loophole.categoryId}»`
  switch (loophole.kind) {
    case 'no-rules': return `${title}: нет ни одного правила — приложения работают без ограничений, время не записывается`
    case 'no-rule-now': return `${title}: сейчас не действует ни одно правило — время не записывается`
    case 'limits-disabled': return `${title}: лимиты сняты ${disabledUntil ? formatUntil(disabledUntil, now, timeZone) : ''}`.trim()
    case 'unassigned-apps-category': return `приложения без категории попадают в ${title}, а она сейчас не ограничена`
  }
}

export const filterLines = (text: string): string[] => text.split('\n').map((s) => s.trim()).filter(Boolean)

export interface ErrorText { title: string, hint?: string, signInAgain: boolean }

export function errorText (ex: unknown): ErrorText {
  if (ex instanceof ApiError && ex.status === 401) {
    return { title: 'Сервер не знает это устройство', hint: 'Пульт удалили из семьи или вход устарел — войдите заново.', signInAgain: true }
  }
  if (ex instanceof ParentConsoleError && /cannot reach/.test(ex.message)) {
    return { title: 'Нет связи с сервером', hint: `Проверьте интернет и повторите; данные обновятся сами, когда связь вернётся. (${ex.message})`, signInAgain: false }
  }
  if (ex instanceof ParentConsoleError) return { title: ex.message, hint: ex.hint, signInAgain: false }
  return { title: ex instanceof Error ? ex.message : String(ex), signInAgain: false }
}
