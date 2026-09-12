import { banKey } from '../core/bans.ts'
import type { ChildOverview } from '../core/overview.ts'
import type { ParentAction } from '../core/protocol.ts'

export const hours = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '-'
  const minutes = Math.round(ms / 60000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export const localDateTime = (timestamp: number, timeZone: string): string =>
  new Date(timestamp).toLocaleString('sv-SE', { timeZone, hour12: false }).slice(0, 16)

export function table (header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd()
  return [line(header), ...rows.map(line)].join('\n')
}

export function formatOverview (overview: ChildOverview): string {
  const { child } = overview
  const titles = new Map(overview.categories.map((c) => [c.id, c.title]))
  const state = (c: ChildOverview['categories'][number]): string => {
    const parts: string[] = []
    if (c.blockedNow) parts.push(c.blockedNow + (c.temporarilyBlocked?.until ? ` until ${localDateTime(c.temporarilyBlocked.until, child.timeZone)}` : ''))
    if (c.blockedByParent) parts.push(`blocked via ${titles.get(c.blockedByParent)}`)
    if (c.limitsDisabledUntil) parts.push(`limits off until ${localDateTime(c.limitsDisabledUntil, child.timeZone)}`)
    if (!c.countsTimeNow && !c.blockedNow && !c.blockedByParent) parts.push('not counted now')
    return parts.join('; ')
  }
  const rows = overview.categories.map((c) => [
    `${'  '.repeat(c.depth)}${c.title}`, hours(c.usedTodayMs), hours(c.limitNowMs), hours(c.remaining?.includingExtraTime),
    c.extraTimeMs ? `+${hours(c.extraTimeMs)}` : '', String(c.apps.length), state(c)
  ])
  const lines = [
    `${child.name} (${child.id}, ${child.timeZone}) — ${localDateTime(overview.now, child.timeZone)}`,
    '',
    table(['category', 'used', 'limit', 'left', 'extra', 'apps', 'state'], rows)
  ]
  const banLine = (b: ChildOverview['bans'][number], i: number) =>
    `  ${i + 1}) ${banKey(b)}${b.activeNow ? ' [ACTIVE]' : ''} — ${b.categoryIds.map((id) => titles.get(id) ?? id).join(', ')}`
  lines.push('', overview.bans.length ? 'bans:' : 'bans: none', ...overview.bans.map(banLine))
  if (overview.legacyBans.length) lines.push('legacy blocked times (edit in the app):', ...overview.legacyBans.map(banLine))
  if (overview.loopholes.length) lines.push('', 'loopholes:', ...overview.loopholes.map((l) => `  - ${l.detail}`))
  lines.push('', `apps without category: ${overview.categoryForUnassignedApps ? `go to "${titles.get(overview.categoryForUnassignedApps)}"` : 'blocked'}`)
  if (overview.unassignedApps === null) lines.push('  (installed app list is not available from this server)')
  else lines.push(...overview.unassignedApps.map((a) => `  ${a.packageName}@${a.deviceId} ${a.title}`))
  return lines.join('\n')
}

export function formatActions (actions: ParentAction[]): string {
  if (actions.length === 0) return 'nothing to change'
  return actions.map((a, i) => {
    const { type, ...rest } = a
    return `${String(i + 1).padStart(3)}. ${type} ${JSON.stringify(rest)}`
  }).join('\n')
}
