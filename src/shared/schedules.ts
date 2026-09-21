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
