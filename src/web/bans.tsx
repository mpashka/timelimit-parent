import { useState } from 'preact/hooks'
import type { Ban, BansView } from './api.ts'
import { ALL_DAYS, type BanSpec, banKey, banLabel, clockAfter, DAY_NAMES, MINUTE_MAX } from './format.ts'
import { formatClock, parseClock } from './time.ts'
import { ActionButton, SubmitButton, useApp, useBusy, useScreen, type Work } from './ui.tsx'

// @tag:parent-console

const specOf = ({ days, start, end, hard }: BanSpec): BanSpec => ({ days, start, end, hard })

/** An undo addresses the ban by its place in the list, so it is looked up again in the fresh view. */
function indexOfBan (fresh: unknown, spec: BanSpec): number {
  const index = (fresh as BansView).bans.findIndex((ban) => banKey(ban) === banKey(spec))
  if (index < 0) throw new Error(`Запрет ${banLabel(spec)} уже изменился — отменять нечего`)
  return index
}

export function Bans () {
  const view = useScreen<BansView>()
  const [editing, setEditing] = useState<string | null>(null)
  const title = (id: string) => view.categories.find((c) => c.id === id)?.title ?? id

  return (
    <>
      <p class='muted small'>Запрет «с–до» по дням на выбранные категории. <b>Жёсткий</b> — доп. время не помогает, <b>мягкий</b> — «+N минут» его обходит. Снять на время — «разрешить…» на экране «Сейчас».</p>
      {editing === 'new'
        ? <BanForm categories={view.categories} onClose={() => setEditing(null)} />
        : <button type='button' class='primary wide' onClick={() => setEditing('new')}>Добавить запрет</button>}
      {view.bans.length === 0 ? <p class='muted'>Запретов пока нет.</p> : null}
      {view.bans.map((ban, index) => {
        const key = banKey(ban)
        return editing === key
          ? <BanForm key={key} categories={view.categories} ban={ban} index={index} onClose={() => setEditing(null)} />
          : <BanCard key={key} ban={ban} index={index} categories={view.categories} onEdit={() => setEditing(key)} />
      })}
      {view.legacyBans.length > 0
        ? (
          <section class='card'>
            <h2>Из старой настройки приложения</h2>
            <p class='muted small'>Заблокированное время, заданное в приложении старым способом; веб-админка его показывает, но правится оно в приложении.</p>
            {view.legacyBans.map((ban) => <div key={banKey(ban)}>{banLabel(ban)} — {ban.categoryIds.map(title).join(', ')}</div>)}
          </section>
          )
        : null}
    </>
  )
}

function BanCard ({ ban, index, categories, onEdit }: { ban: Ban, index: number, categories: BansView['categories'], onEdit: () => void }) {
  const { pending, run } = useApp()
  const label = banLabel(ban)
  const spec = specOf(ban)
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
          const without = ban.categoryIds.filter((id) => id !== category.id)
          const toggle = (): Work => on
            ? {
                key,
                ...(without.length === 0
                  ? { intent: 'ban-remove', body: { index } }
                  : { intent: 'ban-replace', body: { index, ...spec, categories: without } }),
                done: `«${category.title}» убрано из запрета ${label}`,
                undo: () => ({ intent: 'ban-add', body: { categories: [category.id], ...spec } })
              }
            : {
                key,
                intent: 'ban-add',
                body: { categories: [category.id], ...spec },
                done: `«${category.title}» добавлено в запрет ${label}`,
                undo: (fresh) => {
                  const at = indexOfBan(fresh, spec)
                  const rest = (fresh as BansView).bans[at].categoryIds.filter((id) => id !== category.id)
                  return rest.length === 0
                    ? { intent: 'ban-remove', body: { index: at } }
                    : { intent: 'ban-replace', body: { index: at, ...spec, categories: rest } }
                }
              }
          return (
            <label key={category.id} class={`check ${pending?.key === key ? 'pressed' : ''}`}>
              <input type='checkbox' checked={on} disabled={pending?.key === key} onChange={(event) => {
                event.currentTarget.checked = on
                void run(toggle())
              }} />
              {category.title}
              {pending?.key === key && pending.waiting ? <span class='spinner' aria-hidden='true' /> : null}
            </label>
          )
        })}
      </div>
      <div class='chips'>
        <button type='button' onClick={onEdit}>Изменить</button>
        <ActionButton work={() => ({
          key: `ban-delete-${banKey(ban)}`,
          intent: 'ban-remove',
          body: { index },
          done: `Запрет ${label} удалён`,
          undo: () => ({ intent: 'ban-add', body: { categories: ban.categoryIds, ...spec } })
        })}>Удалить</ActionButton>
      </div>
    </article>
  )
}

function BanForm ({ categories, ban, index, onClose }: { categories: BansView['categories'], ban?: Ban, index?: number, onClose: () => void }) {
  const { run } = useApp()
  const [phase, wrap] = useBusy()
  const [from, setFrom] = useState(formatClock(ban?.start ?? 21 * 60))
  const [to, setTo] = useState(ban ? clockAfter(ban.end).replace('24:00', '00:00') : '07:00')
  const [days, setDays] = useState(ban?.days ?? ALL_DAYS)
  const [hard, setHard] = useState(ban?.hard ?? true)
  const [selected, setSelected] = useState<string[]>(ban?.categoryIds ?? categories.filter((c) => !categories.some((p) => p.id === c.parentId)).map((c) => c.id))
  const problem = days === 0 ? 'Отметьте хотя бы один день.' : selected.length === 0 ? 'Отметьте хотя бы одну категорию.' : null

  const submit = (event: Event) => {
    event.preventDefault()
    if (problem) return
    const spec: BanSpec = { days, start: parseClock(from) % 1440, end: (parseClock(to) + MINUTE_MAX) % 1440, hard }
    const done = `Запрет ${banLabel(spec)} ${ban ? 'сохранён' : 'добавлен'}`
    const work: Work = ban && index !== undefined
      ? {
          key: 'ban-form',
          intent: 'ban-replace',
          body: { index, ...spec, categories: selected },
          done,
          undo: (fresh) => ({ intent: 'ban-replace', body: { index: indexOfBan(fresh, spec), ...specOf(ban), categories: ban.categoryIds } })
        }
      : {
          key: 'ban-form',
          intent: 'ban-add',
          body: { categories: selected, ...spec },
          done,
          undo: (fresh) => ({ intent: 'ban-remove', body: { index: indexOfBan(fresh, spec) } })
        }
    void wrap(async () => { if (await run(work)) onClose() })
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
            {category.title}
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
