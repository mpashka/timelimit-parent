import { useState } from 'preact/hooks'
import type { CategoryView, LimitsView } from './api.ts'
import { clockAfter, dailyLimitOf, formatDaysRu, formatDuration } from './format.ts'
import { countAdvancedOpened } from './store.ts'
import { formatClock } from './time.ts'
import { ActionButton, SubmitButton, useApp, useBusy, useScreen } from './ui.tsx'

// @tag:parent-console

const MAX_MINUTES = 1440

type Category = LimitsView['categories'][number]

/** Parents before their children, each shifted right — the order the app shows categories in. */
function depthOrder (categories: Category[]): Array<{ category: Category, depth: number }> {
  const ids = new Set(categories.map((c) => c.id))
  const result: Array<{ category: Category, depth: number }> = []
  const visit = (parentId: string | null, depth: number) => {
    for (const category of categories) {
      const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null
      if (parent === parentId && category.id !== parentId && !result.some((r) => r.category.id === category.id)) {
        result.push({ category, depth })
        visit(category.id, depth + 1)
      }
    }
  }
  visit(null, 0)
  for (const category of categories) {
    if (!result.some((r) => r.category.id === category.id)) result.push({ category, depth: 0 })
  }
  return result
}

export function Limits () {
  const view = useScreen<LimitsView>()
  return (
    <>
      <p class='muted small'>Дневной лимит — сколько минут в день можно тратить на категорию; одинаковый на все дни.</p>
      {depthOrder(view.categories).map(({ category, depth }) => <LimitCard key={category.id} category={category} depth={depth} />)}
      <p class='muted small'>Лимит на приложение ставится только на уже распределённые по категориям приложения: список установленных сервер отдаёт зашифрованным.</p>
    </>
  )
}

function LimitCard ({ category, depth }: { category: Category, depth: number }) {
  const { run } = useApp()
  const current = dailyLimitOf(category.dailyLimits)
  const [draft, setDraft] = useState<string | null>(null)
  const [phase, wrap] = useBusy()
  const value = draft ?? (current.minutes === null ? '' : String(current.minutes))
  const minutes = Number(value)
  const valid = /^\d+$/.test(value) && minutes >= 1 && minutes <= MAX_MINUTES
  const dirty = draft !== null && draft !== (current.minutes === null ? '' : String(current.minutes))
  const title = category.title

  // ponytail: undo puts back one limit for all days; a category whose days had different limits
  // (only the Android app can set that) comes back as the single limit shown here
  const change = (next: number | null) => ({
    key: `limit-${category.id}-${next}`,
    intent: 'limit-set',
    body: { category: category.id, minutes: next },
    done: next === null ? `«${title}»: без дневного лимита` : `«${title}»: лимит ${formatDuration(next * 60000)} в день`,
    undo: () => ({ intent: 'limit-set', body: { category: category.id, minutes: current.minutes } })
  })

  return (
    <article class='card' style={{ marginInlineStart: `${depth * 12}px` }}>
      <div class='row'>
        <h2>{title}</h2>
        <a class='small' href={`#/category/${category.id}`} onClick={countAdvancedOpened}>Настроить подробнее</a>
      </div>
      <form class='row' onSubmit={(event) => {
        event.preventDefault()
        if (!valid || !dirty) return
        void wrap(async () => { if (await run(change(minutes))) setDraft(null) })
      }}>
        <label class='inline'>Дневной лимит
          <input type='number' inputMode='numeric' min={1} max={MAX_MINUTES} step={1} placeholder='нет' value={value}
            onInput={(e) => setDraft(e.currentTarget.value)} /> мин
        </label>
        {dirty
          ? (
            <span class='chips'>
              <SubmitButton phase={phase} disabled={!valid}>Сохранить</SubmitButton>
              <button type='button' onClick={() => setDraft(null)}>Отмена</button>
            </span>
            )
          : current.minutes !== null
            ? <ActionButton work={() => change(null)}>Без лимита</ActionButton>
            : null}
      </form>
      {dirty && !valid ? <p class='error small'>Целое число минут от 1 до {MAX_MINUTES}.</p> : null}
      {current.mixed ? <p class='muted small'>В приложении заданы разные лимиты по дням (показан наименьший); сохранение заменит их одним на все дни.</p> : null}
      {category.apps.length > 0 ? <AppLimit category={category} /> : null}
    </article>
  )
}

function AppLimit ({ category }: { category: Category }) {
  const { run } = useApp()
  const [open, setOpen] = useState(false)
  const [packageName, setPackageName] = useState(category.apps[0])
  const [minutes, setMinutes] = useState('30')
  const [phase, wrap] = useBusy()
  const valid = /^\d+$/.test(minutes) && Number(minutes) >= 1 && Number(minutes) <= MAX_MINUTES
  if (!open) return <button type='button' class='link small' onClick={() => setOpen(true)}>Лимит на приложение ({category.apps.length})…</button>
  return (
    <form class='form' onSubmit={(event) => {
      event.preventDefault()
      if (!valid) return
      void wrap(async () => {
        const ok = await run({
          key: `app-limit-${packageName}`,
          intent: 'limit-app',
          body: { package: packageName, minutes: Number(minutes) },
          done: `${packageName}: лимит ${formatDuration(Number(minutes) * 60000)} в день`,
          undo: () => ({ intent: 'limit-app', body: { package: packageName, category: category.id, undo: true } })
        })
        if (ok) setOpen(false)
      })
    }}>
      <label>Приложение
        <select value={packageName} onChange={(e) => setPackageName(e.currentTarget.value)}>
          {category.apps.map((app) => <option key={app} value={app}>{app}</option>)}
        </select>
      </label>
      <label class='inline'>Лимит <input type='number' inputMode='numeric' min={1} max={MAX_MINUTES} value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} /> мин в день</label>
      <p class='muted small'>Приложение переедет в свою подкатегорию внутри «{category.title}»: лимит категории продолжит действовать.</p>
      <div class='chips'>
        <SubmitButton phase={phase} disabled={!valid}>Поставить лимит</SubmitButton>
        <button type='button' onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  )
}

export function CategoryDetails () {
  const category = useScreen<CategoryView>()
  return (
    <>
      <p><a href='#/limits'>← Назад</a></p>
      <article class='card'>
        <h2>{category.title}</h2>
        <p class='muted small'>Только просмотр. Сессии, заряд, сети и предупреждения правятся в приложении TimeLimit.</p>
        <h3>Правила</h3>
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
        <h3>Приложения ({category.apps.length})</h3>
        <ul class='apps'>{category.apps.map((app) => <li key={app}>{app}</li>)}</ul>
      </article>
    </>
  )
}
