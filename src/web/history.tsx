import { childOverview, usageHistory } from '../core/overview.ts'
import { dayLabel, formatDuration, loopholeText } from './format.ts'
import { useApp } from './ui.tsx'

// @tag:parent-console

const DAYS = 7

export function History () {
  const { state, child, now } = useApp()
  const history = usageHistory(state, child.id, now, DAYS)
  const overview = childOverview(state, child.id, now)
  const titles = new Map(overview.categories.map((c) => [c.id, c.title]))
  const disabledUntil = new Map(overview.categories.map((c) => [c.id, c.limitsDisabledUntil]))
  const days = [...history.days].reverse()

  return (
    <>
      <section class='card'>
        <h2>Время по категориям, {DAYS} дней</h2>
        <div class='scroll'>
          <table>
            <thead>
              <tr><th>день</th>{history.categories.map((c) => <th key={c.id}>{c.title}</th>)}</tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.dayOfEpoch}>
                  <td>{dayLabel(day.dayOfEpoch)}</td>
                  {history.categories.map((c) => <td key={c.id} class={day.byCategory[c.id] ? '' : 'muted'}>{day.byCategory[c.id] ? formatDuration(day.byCategory[c.id]) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class='muted small'>Время записывается, только пока у категории действует правило; «—» не значит, что приложения не открывали.</p>
      </section>
      <section class='card'>
        <h2>Где время может уходить незаметно</h2>
        {overview.loopholes.length === 0
          ? <p class='muted'>Сейчас лазеек не видно: время всех категорий считается.</p>
          : <ul>{overview.loopholes.map((l) => <li key={l.kind + l.categoryId}>{loopholeText(l, titles, now, child.timeZone, disabledUntil.get(l.categoryId))}</li>)}</ul>}
        <p class='muted small'>Время по отдельным приложениям на сервер не попадает — смотрите его на планшете, экран «Время по приложениям».</p>
      </section>
    </>
  )
}
