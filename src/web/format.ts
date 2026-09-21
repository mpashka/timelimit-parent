import { ALL_DAYS, formatClock, localTime, timestampAt } from '../shared/time.ts'

// @tag:parent-console

export { ALL_DAYS }
export const MINUTE_MAX = 24 * 60 - 1

export const DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** A ban as both the screens and the intents name it: from `start` to `end` inclusive on `days`. */
export interface BanSpec {
  days: number
  start: number
  end: number
  hard: boolean
}

export interface Loophole {
  kind: 'no-rule-now' | 'no-rules' | 'limits-disabled' | 'unassigned-apps-category'
  categoryId: string
}

export function formatDuration (ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60000), 0)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  return m === 0 ? `${h} ч` : `${h} ч ${String(m).padStart(2, '0')} мин`
}

/** `2:59:07` for a running countdown; zero when it is over. */
export function formatCountdown (ms: number): string {
  const total = Math.max(Math.ceil(ms / 1000), 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
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

export const banKey = (ban: BanSpec): string => `${ban.days}-${ban.start}-${ban.end}-${ban.hard ? 'hard' : 'soft'}`

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

/** The time of day a stale view was still fresh, as the banner names it. */
export const clockOf = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

/** Whole-day limit as the pult edits it: one number for all days, or `mixed` when the app set different ones. */
export function dailyLimitOf (rules: Array<{ maxTime: number, dayMask: number }>): { minutes: number | null, mixed: boolean } {
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

/**
 * Why a request failed, as the BFF says it — split by what the person has to do about it.
 * The browser no longer guesses it from the endpoint URL: `kind` is a field now
 * (docs/implementation/web-admin.md, "Отказы").
 */
export type FailureKind =
  | 'mail-auth-expired'
  | 'session-gone'
  | 'sync-unreachable'
  | 'sync-rejected'
  | 'not-supported'
  | 'bad-request'
  | 'internal'

export interface Failure {
  kind: FailureKind
  title: string
  hint?: string
  signInAgain: boolean
}

export class BffError extends Error {
  readonly failure: Failure

  constructor (failure: Failure) {
    super(failure.title)
    this.name = 'BffError'
    this.failure = failure
  }
}

export interface ErrorText { title: string, hint?: string, signInAgain: boolean }

export function errorText (ex: unknown): ErrorText {
  if (!(ex instanceof BffError)) return { title: ex instanceof Error ? ex.message : String(ex), signInAgain: false }
  const { kind, title, hint, signInAgain } = ex.failure
  switch (kind) {
    case 'mail-auth-expired':
      return { title: 'Подтверждение почты больше не годится', hint: 'Оно одноразовое и живёт три часа — начните вход заново.', signInAgain }
    case 'session-gone':
      return { title: 'Вход устарел', hint: 'Сессия родителя закрыта или истекла — войдите заново.', signInAgain }
    case 'sync-unreachable':
      return { title: 'Нет связи с сервером', hint: `Проверьте интернет и повторите; данные обновятся сами, когда связь вернётся. (${title})`, signInAgain }
    case 'not-supported':
      return { title: `Сервер этого не умеет: ${title}`, hint: hint ?? 'Обновите сервер синхронизации до ветки parent-console.', signInAgain }
    default:
      return { title, hint, signInAgain }
  }
}
