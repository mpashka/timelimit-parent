import { ParentConsoleError } from './errors.ts'
import { ALL_DAYS } from './protocol.ts'

// @tag:parent-console

export interface LocalTime {
  dayOfEpoch: number
  dayOfWeek: number
  minuteOfDay: number
}

const weekdayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

export function localTime (timestamp: number, timeZone: string): LocalTime {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23'
    }).formatToParts(new Date(timestamp))
  } catch {
    throw new ParentConsoleError(`unknown time zone "${timeZone}" of the child`, 'set the child time zone in the TimeLimit app')
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    dayOfEpoch: Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))) / 86400000,
    dayOfWeek: weekdayIndex[get('weekday')],
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute'))
  }
}

export function timestampAt ({ dayOfEpoch, minuteOfDay }: { dayOfEpoch: number, minuteOfDay: number }, timeZone: string): number {
  const guess = dayOfEpoch * 86400000 + minuteOfDay * 60000
  let result = guess
  for (let i = 0; i < 2; i++) {
    const local = localTime(result, timeZone)
    const offset = (local.dayOfEpoch * 1440 + local.minuteOfDay) * 60000 - Math.floor(result / 60000) * 60000
    result = guess - offset
  }
  return result
}

const dayNames = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']
const russianDayNames = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

function dayIndex (name: string): number {
  const lower = name.trim().toLowerCase().slice(0, 2)
  const index = Math.max(dayNames.indexOf(lower), russianDayNames.indexOf(lower))
  if (index < 0) throw new ParentConsoleError(`unknown day "${name}"`, `use ${dayNames.join(',')} or ranges like mo-fr`)
  return index
}

export function parseDays (text: string): number {
  const value = text.trim().toLowerCase()
  if (value === 'all' || value === 'daily' || value === 'все') return ALL_DAYS
  if (value === 'weekdays' || value === 'будни') return 0b0011111
  if (value === 'weekend' || value === 'выходные') return 0b1100000
  let mask = 0
  for (const part of value.split(',')) {
    const [from, to] = part.split('-')
    const start = dayIndex(from)
    const end = to === undefined ? start : dayIndex(to)
    for (let i = start; ; i = (i + 1) % 7) {
      mask |= 1 << i
      if (i === end) break
    }
  }
  return mask
}

export function formatDays (mask: number): string {
  if (mask === ALL_DAYS) return 'all'
  if (mask === 0b0011111) return 'mo-fr'
  if (mask === 0b1100000) return 'sa-su'
  return dayNames.filter((_, i) => (mask & (1 << i)) !== 0).join(',')
}

export function rotateDays (mask: number): number {
  return ((mask << 1) | (mask >> 6)) & ALL_DAYS
}

export function parseClock (text: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match || Number(match[1]) > 24 || Number(match[2]) > 59) throw new ParentConsoleError(`bad time "${text}"`, 'use HH:MM, e.g. 21:00')
  return Math.min(Number(match[1]) * 60 + Number(match[2]), 1440)
}

export const formatClock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

export function parseDurationMinutes (text: string): number {
  const value = text.trim().toLowerCase()
  if (/^\d+$/.test(value)) return Number(value)
  const match = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?$/.exec(value)
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    throw new ParentConsoleError(`bad duration "${text}"`, 'use minutes (30), 30m, 1h or 1h30m')
  }
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

export function parseUntil (text: string, now: number, timeZone: string): number {
  const value = text.trim()
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const local = localTime(now, timeZone)
    const minute = parseClock(value)
    const today = timestampAt({ dayOfEpoch: local.dayOfEpoch, minuteOfDay: minute }, timeZone)
    return today > now ? today : timestampAt({ dayOfEpoch: local.dayOfEpoch + 1, minuteOfDay: minute }, timeZone)
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return now + parseDurationMinutes(value) * 60000
}
