import type { CategoryView } from './api.ts'
import { appHref } from './apps.tsx'
import { clockAfter, dayLabel, formatDaysRu, formatDuration } from './format.ts'
import { formatClock } from '../shared/time.ts'
import { useState } from 'preact/hooks'
import { CATEGORY_TITLE_MAX, categoryTitleProblem } from '../shared/category-title.ts'
import { SubmitButton, useApp, useBusy, useScreen } from './ui.tsx'

// @tag:parent-console @tag:category-limits

const MINUTE = 60000

/** «подробнее» on a category row: the week, the apps and the rules as the tablet keeps them, read-only. */
export function CategoryDetails () {
  const category = useScreen<CategoryView>()
  const max = Math.max(1, ...category.week.map((item) => item.ms))
  return (
    <>
      <p class='muted small'><a href='#/'>Сегодня</a> ›</p>
      <article class='card'>
        <CategoryTitle category={category} />
        <h3>Неделя</h3>
        <div class='week'>
          {category.week.map((item) => (
            <div class='day-bar' key={item.day}>
              <span class='muted small'>{Math.round(item.ms / MINUTE)}</span>
              <i style={{ height: `${Math.round(item.ms / max * 100)}%` }} />
              <span class='muted small'>{dayLabel(item.day).split(' ')[0]}</span>
            </div>
          ))}
        </div>
        <p class='muted small'>Время записывается, только пока у категории действует правило: ноль не значит, что приложения не открывали.</p>
        <h3>Приложения ({category.apps.length})</h3>
        <ul class='plain'>
          {category.apps.map((app) => <li key={app.packageName}>{app.packageName.includes(':') ? app.title : <a href={appHref(app.packageName)}>{app.title}</a>}</li>)}
        </ul>
        <h3>Правила</h3>
        <p class='muted small'>Только просмотр. Сессии, заряд, сети и предупреждения правятся в приложении TimeLimit.</p>
        {category.rules.length === 0 ? <p class='muted'>Правил нет: время не считается.</p> : null}
        <div class='scroll'>
          <table>
            <thead><tr><th>дни</th><th>время</th><th>что</th></tr></thead>
            <tbody>
              {category.rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{formatDaysRu(rule.dayMask)}</td>
                  <td>{formatClock(rule.start)}–{clockAfter(rule.end)}</td>
                  <td>
                    {rule.maxTime === 0 && rule.e === undefined
                      ? (rule.extraTime ? 'жёсткий запрет' : 'мягкий запрет')
                      : `лимит ${formatDuration(rule.maxTime)}${rule.perDay ? ' в день' : ' в неделю'}`}
                    {rule.session > 0 ? `, сессия ${formatDuration(rule.session)} / пауза ${formatDuration(rule.pause)}` : ''}
                    {rule.e !== undefined ? ', временное' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </>
  )
}

/** The title is the parent's own words — whatever language, emoji included; the tablet shows it as typed. */
function CategoryTitle ({ category }: { category: CategoryView }) {
  const { run } = useApp()
  const [draft, setDraft] = useState<string | null>(null)
  const [phase, wrap] = useBusy()
  if (draft === null) {
    return (
      <div class='row'>
        <h2>{category.title}</h2>
        <button type='button' class='link' onClick={() => setDraft(category.title)}>Изменить название</button>
      </div>
    )
  }
  const problem = categoryTitleProblem(draft)
  const unchanged = draft.trim() === category.title
  return (
    <form class='form' onSubmit={(event) => {
      event.preventDefault()
      if (problem !== null || unchanged) return
      const title = draft.trim()
      void wrap(async () => {
        const ok = await run({
          key: `rename-${category.id}`,
          intent: 'category-rename',
          body: { category: category.id, title },
          done: `Категория теперь «${title}»`,
          undo: () => ({ intent: 'category-rename', body: { category: category.id, title: category.title } })
        })
        if (ok) setDraft(null)
      })
    }}>
      <label>Название
        <input type='text' autoFocus value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
      </label>
      <div class={problem ? 'error small' : 'muted small'}>
        {problem ?? `До ${CATEGORY_TITLE_MAX} знаков, любой язык и эмодзи. Название видят и ребёнок на планшете, и вы.`}
      </div>
      <div class='chips'>
        <SubmitButton phase={phase} disabled={problem !== null || unchanged}>Переименовать</SubmitButton>
        <button type='button' onClick={() => setDraft(null)}>Отмена</button>
      </div>
    </form>
  )
}
