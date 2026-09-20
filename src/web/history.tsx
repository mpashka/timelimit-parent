import type { HistoryView } from './api.ts'
import { dayLabel, formatDuration, loopholeText } from './format.ts'
import { useApp, useScreen } from './ui.tsx'

// @tag:parent-console

const DAYS = 7

export function History () {
  const { child, now } = useApp()
  const view = useScreen<HistoryView>()
  const titles = new Map(view.categories.map((c) => [c.id, c.title]))
  const days = [...view.days].reverse()

  return (
    <>
      <section class='card'>
        <h2>Время по категориям, {DAYS} дней</h2>
        <div class='scroll'>
          <table>
            <thead>
              <tr><th>день</th>{view.categories.map((c) => <th key={c.id}>{c.title}</th>)}</tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.dayOfEpoch}>
                  <td>{dayLabel(day.dayOfEpoch)}</td>
                  {view.categories.map((c) => <td key={c.id} class={day.byCategory[c.id] ? '' : 'muted'}>{day.byCategory[c.id] ? formatDuration(day.byCategory[c.id]) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class='muted small'>Время записывается, только пока у категории действует правило; «—» не значит, что приложения не открывали.</p>
      </section>
      <section class='card'>
        <h2>Где время может уходить незаметно</h2>
        {view.loopholes.length === 0
          ? <p class='muted'>Сейчас лазеек не видно: время всех категорий считается.</p>
          : <ul>{view.loopholes.map((l) => <li key={l.kind + l.categoryId}>{loopholeText(l, titles, now, child.timeZone)}</li>)}</ul>}
        <p class='muted small'>Время по отдельным приложениям на сервер не попадает — смотрите его на планшете, экран «Время по приложениям».</p>
      </section>
    </>
  )
}
