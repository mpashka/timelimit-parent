import { useState } from 'preact/hooks'
import { addBanActions, type Ban, banKey, type BanSpec, createdRuleIds, removeBanActions, replaceBanActions } from '../core/bans.ts'
import { childOverview } from '../core/overview.ts'
import { ALL_DAYS, MINUTE_MAX } from '../core/protocol.ts'
import { type CategoryView, childCategories, type FamilyState } from '../core/state.ts'
import { formatClock, parseClock } from '../core/time.ts'
import { banLabel, clockAfter, DAY_NAMES } from './format.ts'
import { ActionButton, SubmitButton, useApp, useBusy, type Work } from './ui.tsx'

// @tag:parent-console

const categoriesOf = (state: FamilyState, childId: string) => childCategories(state, childId)

export function Bans () {
  const { state, child, now } = useApp()
  const [editing, setEditing] = useState<string | null>(null)
  const overview = childOverview(state, child.id, now)
  const categories = categoriesOf(state, child.id)
  const title = (id: string) => categories.find((c) => c.id === id)?.base.title ?? id

  return (
    <>
      <p class='muted small'>Запрет «с–до» по дням на выбранные категории. <b>Жёсткий</b> — доп. время не помогает, <b>мягкий</b> — «+N минут» его обходит. Снять на время — «разрешить…» на экране «Сейчас».</p>
      {editing === 'new'
        ? <BanForm categories={categories} onClose={() => setEditing(null)} />
        : <button type='button' class='primary wide' onClick={() => setEditing('new')}>Добавить запрет</button>}
      {overview.bans.length === 0 ? <p class='muted'>Запретов пока нет.</p> : null}
      {overview.bans.map((ban) => {
        const key = banKey(ban)
        return editing === key
          ? <BanForm key={key} categories={categories} ban={ban} onClose={() => setEditing(null)} />
          : <BanCard key={key} ban={ban} categories={categories} onEdit={() => setEditing(key)} />
      })}
      {overview.legacyBans.length > 0
        ? (
          <section class='card'>
            <h2>Из старой настройки приложения</h2>
            <p class='muted small'>Заблокированное время, заданное в приложении старым способом; веб-админка его показывает, но правится оно в приложении.</p>
            {overview.legacyBans.map((ban) => <div key={banKey(ban)}>{banLabel(ban)} — {ban.categoryIds.map(title).join(', ')}</div>)}
          </section>
          )
        : null}
    </>
  )
}

function BanCard ({ ban, categories, onEdit }: { ban: Ban & { activeNow: boolean }, categories: CategoryView[], onEdit: () => void }) {
  const { child, pending, run } = useApp()
  const label = banLabel(ban)
  return (
    <article class='card'>
      <div class='row'>
        <h2>{label}</h2>
        <span class='chips'>
          <span class='chip'>{ban.hard ? 'жёсткий' : 'мягкий'}</span>
          {ban.activeNow ? <span class='chip warn'>действует</span> : null}
        </span>
      </div>
      <div class='checks'>
        {categories.map((category) => {
          const on = ban.categoryIds.includes(category.id)
          const key = `ban-${banKey(ban)}-${category.id}`
          const toggle = (): Work => {
            if (on) {
              return {
                key,
                actions: removeBanActions(ban, [category.id]),
                done: `«${category.base.title}» убрано из запрета ${label}`,
                undo: (fresh) => addBanActions(categoriesOf(fresh, child.id).filter((c) => c.id === category.id), ban)
              }
            }
            const actions = addBanActions([category], ban)
            return {
              key,
              actions,
              done: `«${category.base.title}» добавлено в запрет ${label}`,
              undo: (fresh) => replaceBanActions({ categories: categoriesOf(fresh, child.id), removeRuleIds: createdRuleIds(actions), ban, categoryIds: [] })
            }
          }
          return (
            <label key={category.id} class={`check ${pending?.key === key ? 'pressed' : ''}`}>
              <input type='checkbox' checked={on} disabled={pending?.key === key} onChange={(event) => {
                event.currentTarget.checked = on
                void run(toggle())
              }} />
              {category.base.title}
              {pending?.key === key && pending.waiting ? <span class='spinner' aria-hidden='true' /> : null}
            </label>
          )
        })}
      </div>
      <div class='chips'>
        <button type='button' onClick={onEdit}>Изменить</button>
        <ActionButton work={() => ({
          key: `ban-delete-${banKey(ban)}`,
          actions: removeBanActions(ban),
          done: `Запрет ${label} удалён`,
          undo: (fresh) => replaceBanActions({ categories: categoriesOf(fresh, child.id), removeRuleIds: [], ban, categoryIds: ban.categoryIds })
        })}>Удалить</ActionButton>
      </div>
    </article>
  )
}

function BanForm ({ categories, ban, onClose }: { categories: CategoryView[], ban?: Ban, onClose: () => void }) {
  const { run, child } = useApp()
  const [phase, wrap] = useBusy()
  const [from, setFrom] = useState(formatClock(ban?.start ?? 21 * 60))
  const [to, setTo] = useState(ban ? clockAfter(ban.end).replace('24:00', '00:00') : '07:00')
  const [days, setDays] = useState(ban?.days ?? ALL_DAYS)
  const [hard, setHard] = useState(ban?.hard ?? true)
  const [selected, setSelected] = useState<string[]>(ban?.categoryIds ?? categories.filter((c) => !categories.some((p) => p.id === c.base.parentCategoryId)).map((c) => c.id))
  const problem = days === 0 ? 'Отметьте хотя бы один день.' : selected.length === 0 ? 'Отметьте хотя бы одну категорию.' : null

  const submit = (event: Event) => {
    event.preventDefault()
    if (problem) return
    const spec: BanSpec = { days, start: parseClock(from) % 1440, end: (parseClock(to) + MINUTE_MAX) % 1440, hard }
    const actions = replaceBanActions({ categories, removeRuleIds: ban ? ban.ruleRefs.map((r) => r.ruleId) : [], ban: spec, categoryIds: selected })
    void wrap(async () => {
      const ok = await run({
        key: 'ban-form',
        actions,
        done: `Запрет ${banLabel(spec)} ${ban ? 'сохранён' : 'добавлен'}`,
        undo: (fresh) => replaceBanActions({
          categories: categoriesOf(fresh, child.id),
          removeRuleIds: createdRuleIds(actions),
          ban: ban ?? spec,
          categoryIds: ban ? ban.categoryIds : []
        })
      })
      if (ok) onClose()
    })
  }

  return (
    <form class='card form' onSubmit={submit}>
      <div class='row'>
        <label>С <input type='time' required value={from} onInput={(e) => setFrom(e.currentTarget.value)} /></label>
        <label>до <input type='time' required value={to} onInput={(e) => setTo(e.currentTarget.value)} /></label>
      </div>
      <p class='muted small'>Если «до» раньше «с», запрет идёт через полночь; дни — те, в которые он начинается.</p>
      <div class='chips' role='group' aria-label='Дни'>
        {DAY_NAMES.map((name, i) => (
          <button type='button' key={name} class='day' aria-pressed={(days & (1 << i)) !== 0} onClick={() => setDays(days ^ (1 << i))}>{name}</button>
        ))}
        <button type='button' class='link' onClick={() => setDays(0b0011111)}>будни</button>
        <button type='button' class='link' onClick={() => setDays(ALL_DAYS)}>все</button>
      </div>
      <div class='checks'>
        {categories.map((category) => (
          <label key={category.id} class='check'>
            <input type='checkbox' checked={selected.includes(category.id)} onChange={(e) => setSelected(e.currentTarget.checked ? [...selected, category.id] : selected.filter((id) => id !== category.id))} />
            {category.base.title}
          </label>
        ))}
      </div>
      <label class='check'><input type='checkbox' checked={hard} onChange={(e) => setHard(e.currentTarget.checked)} />Жёсткий: доп. время не помогает</label>
      {problem ? <p class='error'>{problem}</p> : null}
      <div class='chips'>
        <SubmitButton phase={phase} disabled={problem !== null}>Сохранить</SubmitButton>
        <button type='button' onClick={onClose}>Отмена</button>
      </div>
    </form>
  )
}
