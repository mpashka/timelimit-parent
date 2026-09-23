import { localTime, timestampAt } from './time.ts'

// @tag:ban-schedule

export type ScheduleKind = 'sleep' | 'study'

export const SCHEDULE_KINDS: ScheduleKind[] = ['sleep', 'study']

const EVENING = 18 * 60
const MORNING = 5 * 60
const MIDNIGHT_INCLUSIVE = 24 * 60 - 1

/**
 * Sleep and study are not stored: they are names for bans of a recognisable shape, so bans made
 * by hand, in the CLI or in the Android app are recognised too. Sleep runs past midnight or up to
 * it from the evening; study lies within the day. Everything else stays a plain ban.
 */
export function scheduleKind ({ start, end }: { start: number, end: number }): ScheduleKind | null {
  if (start > end || (end === MIDNIGHT_INCLUSIVE && start >= EVENING)) return 'sleep'
  if (start >= MORNING && end < EVENING) return 'study'
  return null
}

export const SCHEDULE_SHAPE_HINT: Record<ScheduleKind, string> = {
  sleep: 'сон идёт через полночь или до 24:00, начинаясь не раньше 18:00',
  study: 'учёба лежит внутри дня: начало не раньше 05:00, конец не позже 18:00'
}

/**
 * The sleep that is on now or starts next, over the next two days. Its start is where «до конца дня»
 * ends (ui-contract, «Решения 2026-09-23»), its end is «до утра». With several sleep bans — one per
 * category with its own morning — the earliest start wins.
 */
export const sleepWindow = (bans: Array<{ days: number, start: number, end: number }>, now: number, timeZone: string): { start: number, end: number } | null =>
  scheduleWindow('sleep', bans, now, timeZone)

/** The occurrence of a schedule that is on now or starts next — «Сон начнётся сегодня в 21:00». */
export function scheduleWindow (kind: ScheduleKind, bans: Array<{ days: number, start: number, end: number }>, now: number, timeZone: string): { start: number, end: number } | null {
  const local = localTime(now, timeZone)
  let best: { start: number, end: number } | null = null
  for (const ban of bans) {
    if (scheduleKind(ban) !== kind) continue
    for (const offset of [-1, 0, 1, 2]) {
      const weekday = (local.dayOfWeek + offset + 7) % 7
      if ((ban.days & (1 << weekday)) === 0) continue
      const day = local.dayOfEpoch + offset
      const start = timestampAt({ dayOfEpoch: day, minuteOfDay: ban.start }, timeZone)
      const end = timestampAt({ dayOfEpoch: day + (ban.start > ban.end ? 1 : 0), minuteOfDay: ban.end + 1 }, timeZone)
      if (end <= now) continue
      if (best === null || start < best.start) best = { start, end }
    }
  }
  return best
}
