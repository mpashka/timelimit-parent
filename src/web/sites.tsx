import { useState } from 'preact/hooks'
import type { SitesView, UrlFilter } from './api.ts'
import { filterLines } from './format.ts'
import { ActionButton, SubmitButton, useApp, useBusy, useScreen } from './ui.tsx'

// @tag:parent-console

export function Sites () {
  const { child, family, run } = useApp()
  const view = useScreen<SitesView>()
  const saved = view.urlFilter
  const [allow, setAllow] = useState<string | null>(null)
  const [block, setBlock] = useState<string | null>(null)
  const [phase, wrap] = useBusy()
  const supported = view.supported
  const allowText = allow ?? saved.allow.join('\n')
  const blockText = block ?? saved.block.join('\n')
  const dirty = allowText !== saved.allow.join('\n') || blockText !== saved.block.join('\n')

  const work = (filter: UrlFilter, key: string, done: string) => ({
    key,
    intent: 'filter-set',
    body: { filter },
    done,
    undo: () => ({ intent: 'filter-set', body: { filter: saved } })
  })

  return (
    <>
      {!supported
        ? (
          <div class='error' role='alert'>
            <div>Сервер не умеет фильтр сайтов: у него apiLevel {family.apiLevel}.</div>
            <div class='muted'>Старый сервер молча выбросит настройку. Обновите сервер до ветки parent-console — экран заработает сам.</div>
          </div>
          )
        : null}
      <section class='card'>
        <div class='row'>
          <h2>Фильтр сайтов в Chrome</h2>
          <ActionButton class={saved.enabled ? 'primary' : ''} disabled={!supported}
            work={() => work({ ...saved, enabled: !saved.enabled }, 'filter-enabled', saved.enabled ? 'Фильтр сайтов выключен' : 'Фильтр сайтов включён')}>
            {saved.enabled ? 'Включён' : 'Выключен'}
          </ActionButton>
        </div>
        <p class='muted small'>Нажатие переключает. Применяется на всех устройствах, где {child.name} — текущий пользователь.</p>
      </section>
      <form class='card form' onSubmit={(event) => {
        event.preventDefault()
        const filter = { enabled: saved.enabled, allow: filterLines(allowText), block: filterLines(blockText) }
        const item = work(filter, 'filter-lists', 'Списки сайтов сохранены')
        void wrap(async () => { if (await run(item)) { setAllow(null); setBlock(null) } })
      }}>
        <p class='muted small'>
          По одной записи в строке, формат фильтров Chrome: <code>[схема://][.]хост[:порт][/путь]</code>.
          Например, <code>google.com/search</code> запрещает поиск, но не сам google.com; <code>*</code> в запрещённых — всё, кроме разрешённых.
          До 1000 записей в списке, каждая до 256 символов.
        </p>
        <label>Разрешённые
          <textarea rows={5} disabled={!supported} value={allowText} placeholder={'wikipedia.org\nschool.example.ru'} onInput={(e) => setAllow(e.currentTarget.value)} />
        </label>
        <label>Запрещённые
          <textarea rows={5} disabled={!supported} value={blockText} placeholder={'google.com/search\nyoutube.com'} onInput={(e) => setBlock(e.currentTarget.value)} />
        </label>
        {dirty
          ? (
            <div class='chips'>
              <SubmitButton phase={phase} disabled={!supported}>Сохранить списки</SubmitButton>
              <button type='button' onClick={() => { setAllow(null); setBlock(null) }}>Отмена</button>
            </div>
            )
          : null}
      </form>
    </>
  )
}
