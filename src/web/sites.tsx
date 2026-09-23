import { useState } from 'preact/hooks'
import type { SitesView, UrlFilter } from './api.ts'
import { ActionButton, useApp, useScreen, type Work } from './ui.tsx'

// @tag:parent-console @tag:url-filter

const EVERYTHING = '*'

/** Chrome's own filter format; a pasted address loses its scheme and trailing slash so that lists stay readable. */
const normalize = (text: string): string => text.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')

export function Sites () {
  const { child, family, run } = useApp()
  const view = useScreen<SitesView>()
  const saved = view.urlFilter
  const [address, setAddress] = useState('')
  const onlyAllowed = saved.block.includes(EVERYTHING)
  const blocked = saved.block.filter((item) => item !== EVERYTHING)

  const work = (filter: UrlFilter, key: string, done: string): Work => ({
    key,
    intent: 'filter-set',
    body: { filter },
    done,
    undo: () => ({ intent: 'filter-set', body: { filter: saved } })
  })
  const add = (list: 'allow' | 'block') => {
    const site = normalize(address)
    if (site === '') return
    const allow = saved.allow.filter((item) => item !== site)
    const block = saved.block.filter((item) => item !== site)
    const filter = { enabled: true, allow: list === 'allow' ? [...allow, site] : allow, block: list === 'block' ? [...block, site] : block }
    void run(work(filter, `add-${list}`, list === 'allow' ? `${site} разрешён` : `${site} запрещён`)).then((ok) => { if (ok) setAddress('') })
  }
  const remove = (list: 'allow' | 'block', site: string) => () =>
    work({ ...saved, [list]: saved[list].filter((item) => item !== site) }, `remove-${list}-${site}`, `${site} убран из списка`)
  const mode = (only: boolean) => () => work(
    { ...saved, enabled: true, block: only ? [EVERYTHING, ...blocked] : blocked },
    `mode-${only}`,
    only ? 'Открываются только разрешённые сайты' : 'Открывается всё, кроме запрещённых'
  )

  if (!view.supported) {
    return (
      <div class='error' role='alert'>
        <div>Сервер не умеет фильтр сайтов: у него apiLevel {family.apiLevel}.</div>
        <div class='muted'>Старый сервер молча выбросит настройку. Обновите сервер — экран заработает сам.</div>
      </div>
    )
  }

  return (
    <>
      <p class='muted small'>Сайты в Chrome на всех планшетах {child.name}.</p>
      {!saved.enabled
        ? (
          <section class='card'>
            <div class='row'>
              <span><b>Фильтр сайтов выключен</b> — открывается всё.</span>
              <ActionButton class='primary' work={() => work({ ...saved, enabled: true }, 'filter-on', 'Фильтр сайтов включён')}>Включить</ActionButton>
            </div>
          </section>
          )
        : (
          <div class='segmented' role='tablist'>
            <ActionButton class={onlyAllowed ? '' : 'primary'} disabled={!onlyAllowed} work={mode(false)}>Всё, кроме запрещённых</ActionButton>
            <ActionButton class={onlyAllowed ? 'primary' : ''} disabled={onlyAllowed} work={mode(true)}>Только разрешённые</ActionButton>
          </div>
          )}
      <form class='card site-add' onSubmit={(event) => { event.preventDefault(); add('allow') }}>
        <input type='text' inputMode='url' autoFocus placeholder='scratch.mit.edu' value={address} onInput={(event) => setAddress(event.currentTarget.value)} />
        <button type='submit' class='primary' disabled={normalize(address) === ''}>Разрешить</button>
        <button type='button' disabled={normalize(address) === ''} onClick={() => add('block')}>Запретить</button>
      </form>
      <SiteList title='Разрешены' items={saved.allow} remove={(site) => remove('allow', site)} />
      <SiteList title='Запрещены' items={blocked} remove={(site) => remove('block', site)} />
      <p class='muted small'>
        Формат фильтров Chrome: <code>google.com/search</code> запрещает поиск, но не сам google.com.
        {saved.enabled ? <> · <ActionButton class='link small' work={() => work({ ...saved, enabled: false }, 'filter-off', 'Фильтр сайтов выключен')}>выключить фильтр</ActionButton></> : null}
      </p>
    </>
  )
}

function SiteList ({ title, items, remove }: { title: string, items: string[], remove: (site: string) => () => Work }) {
  if (items.length === 0) return null
  return (
    <section class='card'>
      <h2>{title} · {items.length}</h2>
      <ul class='plain'>
        {items.map((site) => (
          <li key={site} class='row'>
            <span>{site}</span>
            <ActionButton class='link' work={remove(site)}><span aria-label={`убрать ${site}`}>✕</span></ActionButton>
          </li>
        ))}
      </ul>
    </section>
  )
}
