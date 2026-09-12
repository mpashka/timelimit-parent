import { useState } from 'preact/hooks'
import { isBanRule } from '../core/bans.ts'
import { dailyLimitRules, limitApp, restoreDailyLimits, setDailyLimit, undoLimitApp } from '../core/operations.ts'
import { categoryDepthOrder } from '../core/overview.ts'
import type { ParentAction } from '../core/protocol.ts'
import { type CategoryView, childCategories, type FamilyState } from '../core/state.ts'
import { formatClock } from '../core/time.ts'
import { clockAfter, dailyLimitOf, formatDaysRu, formatDuration } from './format.ts'
import { countAdvancedOpened } from './store.ts'
import { ActionButton, SubmitButton, useApp, useBusy } from './ui.tsx'

// @tag:parent-console

const MAX_MINUTES = 1440

const categoryIn = (state: FamilyState, childId: string, id: string) => childCategories(state, childId).find((c) => c.id === id)

export function Limits () {
  const { state, child } = useApp()
  const ordered = categoryDepthOrder(childCategories(state, child.id))
  return (
    <>
      <p class='muted small'>Дневной лимит — сколько минут в день можно тратить на категорию; одинаковый на все дни.</p>
      {ordered.map(({ category, depth }) => <LimitCard key={category.id} category={category} depth={depth} />)}
      <p class='muted small'>Лимит на приложение ставится только на уже распределённые по категориям приложения: список установленных сервер отдаёт зашифрованным.</p>
    </>
  )
}

function LimitCard ({ category, depth }: { category: CategoryView, depth: number }) {
  const { run, child } = useApp()
  const current = dailyLimitOf(category)
  const [draft, setDraft] = useState<string | null>(null)
  const [phase, wrap] = useBusy()
  const value = draft ?? (current.minutes === null ? '' : String(current.minutes))
  const minutes = Number(value)
  const valid = /^\d+$/.test(value) && minutes >= 1 && minutes <= MAX_MINUTES
  const dirty = draft !== null && draft !== (current.minutes === null ? '' : String(current.minutes))
  const title = category.base.title

  const change = (next: number | null) => {
    const snapshot = dailyLimitRules(category)
    return {
      key: `limit-${category.id}-${next}`,
      actions: setDailyLimit({ category, minutes: next }),
      done: next === null ? `«${title}»: без дневного лимита` : `«${title}»: лимит ${formatDuration(next * 60000)} в день`,
      undo: (fresh: FamilyState) => restoreDailyLimits({ category: categoryIn(fresh, child.id, category.id) ?? category, snapshot })
    }
  }

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
          <input type='number' inputMode='numeric' min={1} max={MAX_MINUTES} step={5} placeholder='нет' value={value}
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

function AppLimit ({ category }: { category: CategoryView }) {
  const { state, child, run } = useApp()
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
      const actions: ParentAction[] = limitApp({ state, childId: child.id, packageName, minutes: Number(minutes) })
      void wrap(async () => {
        const ok = await run({
          key: `app-limit-${packageName}`,
          actions,
          done: `${packageName}: лимит ${formatDuration(Number(minutes) * 60000)} в день`,
          undo: () => undoLimitApp({ actions, packageName, previousCategoryId: category.id })
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
      <p class='muted small'>Приложение переедет в свою подкатегорию внутри «{category.base.title}»: лимит категории продолжит действовать.</p>
      <div class='chips'>
        <SubmitButton phase={phase} disabled={!valid}>Поставить лимит</SubmitButton>
        <button type='button' onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  )
}

export function CategoryDetails ({ categoryId }: { categoryId: string }) {
  const { state, child } = useApp()
  const category = categoryIn(state, child.id, categoryId)
  return (
    <>
      <p><a href='#/limits'>← Назад</a></p>
      {!category
        ? <p class='muted'>Такой категории у {child.name} нет — возможно, её удалили в приложении.</p>
        : (
          <article class='card'>
            <h2>{category.base.title}</h2>
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
                        {isBanRule(rule) ? (rule.extraTime ? 'жёсткий запрет' : 'мягкий запрет') : `лимит ${formatDuration(rule.maxTime)}${rule.perDay ? ' в день' : ' в неделю'}`}
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
          )}
    </>
  )
}
