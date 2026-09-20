// @tag:parent-console

/**
 * The child's wall clock, as the screens need it to say "до 21:00" and "до завтра 07:00".
 * A copy of the four helpers of `src/core/time.ts` on purpose: the browser imports nothing from
 * `src/core` any more — everything about the protocol is computed in the BFF now
 * (docs/implementation/web-admin.md, "Контракт BFF ⇄ браузер").
 */

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
    throw new Error(`Часовой пояс ребёнка «${timeZone}» браузеру неизвестен — поправьте его в приложении TimeLimit`)
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

export const formatClock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

export function parseClock (text: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match || Number(match[1]) > 24 || Number(match[2]) > 59) throw new Error(`Не время: «${text}». Нужно ЧЧ:ММ, например 21:00`)
  return Math.min(Number(match[1]) * 60 + Number(match[2]), 1440)
}
