import type { AppFace, AppRule, AppTime, Ban, CategoryNow, DeviceWithStatus, NowView } from './api.ts'
import { ALL_DAYS, banEndsAt, clockOf, dailyLimitOf, formatDuration, formatUntil, loopholeText } from './format.ts'
import { useState } from 'preact/hooks'
import { AppIcon, appHref, NewAppRow, ruleText } from './apps.tsx'
import { statusText } from './devices.tsx'
import { countAdvancedOpened, readLocal, writeLocal } from './store.ts'
import { ActionButton, RowMenu, useApp, useScreen } from './ui.tsx'

// @tag:parent-console

const GRANTS = [15, 30, 60]
const MINUTE = 60000
/** Less than this a day is noise: such rows wait behind «ещё N — меньше минуты». */
const NOTICEABLE_MS = MINUTE

type Tab = 'apps' | 'categories'

/** Time first: what went where today, by app or by category, on all tablets or on one; actions live in the ⋮ of a row. */
export function Home () {
  const view = useScreen<NowView>()
  const [tab, setTab] = useState<Tab>(readLocal('homeTab') === 'categories' ? 'categories' : 'apps')
  const [devicesShown, setDevicesShown] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const device = view.devices.find((item) => item.deviceId === deviceId) ?? null
  const apps = (view.apps ?? [])
    .map((app) => device === null ? app : { ...app, ms: app.byDevice[device.deviceId] ?? 0 })
    .filter((app) => app.ms > 0)
    .sort((a, b) => b.ms - a.ms)
  const total = view.apps === null
    ? view.categories.filter((c) => c.depth === 0).reduce((sum, c) => sum + c.usedTodayMs, 0)
    : apps.reduce((sum, app) => sum + app.ms, 0)
  const categories = view.categories.filter((c) => c.depth === 0).map(({ id, title }) => ({ id, title }))
  const choose = (next: Tab) => { writeLocal('homeTab', next); setTab(next) }
  return (
    <div class='columns'>
      <div>
        <section class='hero row'>
          <div>
            <div class='muted small'>Сегодня{device ? ` на «${device.name}»` : ''}</div>
            <div class='big'>{formatDuration(total)}</div>
          </div>
          {view.devices.length > 0
            ? <button type='button' class={`link ${devicesShown ? 'on' : ''}`} aria-expanded={devicesShown} onClick={() => setDevicesShown(!devicesShown)}>
                Планшеты · {view.devices.length} {devicesShown ? '▴' : '▾'}
              </button>
            : null}
        </section>
        {view.devices.length === 0 ? <ChildDevices /> : null}
        {devicesShown
          ? (
            <section class='list'>
              {view.devices.map((item) => (
                <DeviceRow key={item.deviceId} device={item} chosen={item.deviceId === deviceId} choose={() => setDeviceId(item.deviceId === deviceId ? null : item.deviceId)} />
              ))}
            </section>
            )
          : null}
        {device
          ? <p class='filter'><span class='chip on'>Только «{device.name}» <button type='button' class='link' aria-label='Все планшеты' onClick={() => setDeviceId(null)}>✕</button></span></p>
          : null}
        {view.newApps.map((app) => <NewAppRow key={app.packageName} app={app} categories={categories} />)}
        <div class='view-tabs' role='tablist'>
          <button type='button' role='tab' aria-selected={tab === 'apps'} onClick={() => choose('apps')}>Приложения</button>
          <button type='button' role='tab' aria-selected={tab === 'categories'} onClick={() => choose('categories')}>Категории</button>
        </div>
        {tab === 'apps'
          ? <AppList apps={apps} />
          : <CategoryTree apps={apps} deviceChosen={device !== null} />}
        {view.appUsageProblem ? <p class='muted small'>Время по приложениям недоступно: {view.appUsageProblem}</p> : null}
      </div>
      <div>
        <ModeBox />
        <Allowances />
        <Loopholes />
      </div>
    </div>
  )
}

function DeviceRow ({ device, chosen, choose }: { device: DeviceWithStatus, chosen: boolean, choose: () => void }) {
  return (
    <div class={`line ${chosen ? 'chosen' : ''}`}>
      <button type='button' class='line-main' aria-pressed={chosen} onClick={choose}>
        <i class={device.status.online ? 'dot on' : 'dot'} aria-hidden='true' />
        <span class='grow'><span class='name'>{device.name}</span><span class='muted small'>{statusText(device)}</span></span>
        {device.status.todayMs !== null ? <span class='value'>{formatDuration(device.status.todayMs)}</span> : null}
      </button>
      <RowMenu title={device.name} subtitle={statusText(device)}>
        <button type='button' class='item' onClick={choose}>{chosen ? 'Все планшеты' : 'Что делали на нём'}</button>
        <a class='item' href='#/tablets'>Настройки планшета ›</a>
      </RowMenu>
    </div>
  )
}

/** Apps by time, the noticeable ones; the rest behind one line that says how many and why hidden. */
function AppList ({ apps }: { apps: AppTime[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? apps : apps.filter((app) => app.ms >= NOTICEABLE_MS)
  const hidden = apps.length - shown.length
  const max = Math.max(0, ...apps.map((app) => app.ms))
  if (apps.length === 0) return <p class='muted small'>Сегодня приложения не открывали.</p>
  return (
    <section class='list'>
      {shown.map((app) => <AppLine key={app.packageName} app={app} ms={app.ms} max={max} showCategory />)}
      {hidden > 0 ? <button type='button' class='foot' onClick={() => setAll(true)}>Ещё {hidden} — меньше минуты <span>показать</span></button> : null}
    </section>
  )
}

function AppLine ({ app, ms, max, showCategory = false }: { app: AppFace & { category?: { title: string } | null }, ms: number | null, max: number, showCategory?: boolean }) {
  const view = useScreen<NowView>()
  const rule = view.appRules.find((item) => item.packageName === app.packageName) ?? null
  const note = [showCategory && app.category ? app.category.title : '', rule ? ruleText(rule) : ''].filter(Boolean).join(' · ')
  return (
    <div class='line'>
      <a class='line-main' href={appHref(app.packageName)}>
        <AppIcon app={app} />
        <span class='grow'>
          <span class='name'>{app.title}</span>
          {note ? <span class='muted small'>{note}</span> : null}
          {ms !== null && max > 0 ? <span class='bar'><i style={{ width: `${Math.round(ms / max * 100)}%` }} /></span> : null}
        </span>
        <span class='value'>{ms === null || ms === 0 ? '—' : formatDuration(ms)}</span>
      </a>
      <AppMenu app={app} rule={rule} />
    </div>
  )
}

// @tag:app-allowance @tag:app-rule
function AppMenu ({ app, rule }: { app: { packageName: string, title: string }, rule: AppRule | null }) {
  const { now } = useApp()
  const view = useScreen<NowView>()
  const tz = view.child.timeZone
  const allowanceUntil = view.allowances.find((item) => item.packageName === app.packageName)?.until ?? null
  const current = rule ?? { days: ALL_DAYS, limitMinutes: -1 }
  const closed = current.days === 0
  const allow = (minutes: number) => () => {
    const until = Math.max(now, allowanceUntil ?? 0) + minutes * MINUTE
    return {
      key: `allow-${app.packageName}-${minutes}`,
      intent: 'app-allow',
      body: { package: app.packageName, until },
      done: `${app.title}: разрешено ${formatUntil(until, now, tz)}`,
      undo: () => ({ intent: 'app-allow', body: { package: app.packageName, until: allowanceUntil ?? 0 } })
    }
  }
  const close = () => ({
    key: `close-app-${app.packageName}`,
    intent: 'app-rule',
    body: { package: app.packageName, ...current, days: closed ? ALL_DAYS : 0 },
    done: closed ? `${app.title} снова открывается` : `${app.title} закрыто всегда`,
    undo: () => ({ intent: 'app-rule', body: { package: app.packageName, ...current } })
  })
  return (
    <RowMenu title={app.title} subtitle={allowanceUntil ? `разрешено ${formatUntil(allowanceUntil, now, tz)}` : undefined}>
      <div class='item-label'>Разрешить сверх лимита</div>
      <div class='chips grants'>{GRANTS.map((minutes) => <ActionButton key={minutes} work={allow(minutes)}>+{formatDuration(minutes * MINUTE)}</ActionButton>)}</div>
      <ActionButton class='item closer' work={close}>{closed ? 'Открыть снова' : 'Закрыть всегда'}</ActionButton>
      <a class='item' href={appHref(app.packageName)}>Категория, свой лимит, неделя ›</a>
    </RowMenu>
  )
}

/** The category tree: headers with tree lines; one category open at a time, its apps on their own backing. */
// @tag:category-tree
function CategoryTree ({ apps, deviceChosen }: { apps: AppTime[], deviceChosen: boolean }) {
  const view = useScreen<NowView>()
  const [open, setOpen] = useState<string | null>(null)
  const siblings = (category: CategoryNow) => view.categories.filter((item) => item.parentId === category.parentId)
  return (
    <section class='list tree'>
      {view.categories.map((category) => {
        const list = siblings(category)
        return (
          <CategoryNode key={category.id} category={category} apps={apps} deviceChosen={deviceChosen}
            last={list[list.length - 1]?.id === category.id} open={open === category.id} toggle={() => setOpen(open === category.id ? null : category.id)} />
        )
      })}
    </section>
  )
}

function descendantIds (categories: CategoryNow[], id: string): Set<string> {
  const result = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const item of categories) {
      if (item.parentId !== null && result.has(item.parentId) && !result.has(item.id)) { result.add(item.id); grew = true }
    }
  }
  return result
}

/** What stands in the way now, in a few words, or null when nothing does. */
function stateText (category: CategoryNow, view: NowView, now: number): string | null {
  const tz = view.child.timeZone
  const activeBan: Ban | undefined = view.bans.find((ban) => ban.activeNow && ban.categoryIds.includes(category.id))
  if (category.temporarilyBlocked) return `закрыто ${category.temporarilyBlocked.until ? formatUntil(category.temporarilyBlocked.until, now, tz) : 'до снятия'}`
  if (category.blockedNow === 'ban' || category.blockedNow === 'legacy-blocked-time') return `запрет ${activeBan ? formatUntil(banEndsAt(activeBan, now, tz), now, tz) : ''}`.trim()
  if (category.blockedNow === 'limit-reached') return 'время вышло'
  if (category.blockedByParent) return `закрыто вместе с «${view.categories.find((c) => c.id === category.blockedByParent)?.title ?? ''}»`
  if (category.limitsDisabledUntil) return `лимиты сняты ${formatUntil(category.limitsDisabledUntil, now, tz)}`
  return null
}

function CategoryNode ({ category, apps, deviceChosen, last, open, toggle }: {
  category: CategoryNow, apps: AppTime[], deviceChosen: boolean, last: boolean, open: boolean, toggle: () => void
}) {
  const { now } = useApp()
  const view = useScreen<NowView>()
  const ids = descendantIds(view.categories, category.id)
  const deviceMs = apps.filter((app) => app.category !== null && ids.has(app.category.id)).reduce((sum, app) => sum + app.ms, 0)
  const remaining = category.remaining?.includingExtraTime ?? null
  const limit = category.limitNowMs
  const state = stateText(category, view, now)
  const blocked = category.blockedNow !== null || category.blockedByParent !== null
  const tone = blocked ? 'closed' : remaining !== null && remaining < 15 * MINUTE ? 'warn' : 'ok'
  const value = deviceChosen
    ? formatDuration(deviceMs)
    : remaining !== null ? `осталось ${formatDuration(remaining)}` : formatDuration(category.usedTodayMs)
  return (
    <>
      <div class={`line category depth-${Math.min(category.depth, 3)} ${category.depth > 0 ? 'branch' : ''} ${last ? 'last' : ''} ${open ? 'open' : ''}`}
        style={{ '--depth': category.depth }}>
        <button type='button' class='line-main' aria-expanded={open} onClick={toggle}>
          <span class='chev' aria-hidden='true'>›</span>
          <span class='grow'>
            <span class='name'>{category.title}</span>
            {state
              ? <span class={`small state ${tone}`}>{state}</span>
              : limit === null ? <span class='muted small'>без лимита</span> : null}
            {limit !== null && !deviceChosen
              ? <span class={`bar ${tone}`}><i style={{ width: `${Math.min(100, Math.round(category.usedTodayMs / (limit + category.extraTimeMs) * 100))}%` }} /></span>
              : null}
          </span>
          <span class='value'>{value}{limit !== null && !deviceChosen ? <small class='muted'>{formatDuration(category.usedTodayMs)} из {formatDuration(limit)}</small> : null}</span>
        </button>
        <CategoryMenu category={category} />
      </div>
      {open ? <CategoryApps category={category} apps={apps} /> : null}
    </>
  )
}

type Mode = 'time' | 'manage'

/** Inside an open category: its apps by time (only those used, «все» next to it) or all of them by name with the limit. */
function CategoryApps ({ category, apps }: { category: CategoryNow, apps: AppTime[] }) {
  const [mode, setMode] = useState<Mode>('time')
  const [all, setAll] = useState(false)
  const timeOf = new Map(apps.filter((app) => app.category?.id === category.id).map((app) => [app.packageName, app.ms]))
  const everyApp = [...category.appList]
  for (const [packageName] of timeOf) {
    if (!everyApp.some((app) => app.packageName === packageName)) everyApp.push(apps.find((app) => app.packageName === packageName)!)
  }
  const used = everyApp.filter((app) => (timeOf.get(app.packageName) ?? 0) >= NOTICEABLE_MS)
    .sort((a, b) => (timeOf.get(b.packageName) ?? 0) - (timeOf.get(a.packageName) ?? 0))
  const listed = mode === 'manage'
    ? [...everyApp].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    : all ? [...everyApp].sort((a, b) => (timeOf.get(b.packageName) ?? 0) - (timeOf.get(a.packageName) ?? 0) || a.title.localeCompare(b.title, 'ru')) : used
  const max = Math.max(0, ...timeOf.values())
  return (
    <div class='category-apps'>
      <div class='view-tabs small' role='tablist'>
        <button type='button' role='tab' aria-selected={mode === 'time'} onClick={() => setMode('time')}>Время</button>
        <button type='button' role='tab' aria-selected={mode === 'manage'} onClick={() => setMode('manage')}>Управление</button>
      </div>
      {mode === 'manage' ? <DailyLimit category={category} /> : null}
      {listed.length === 0 ? <p class='muted small'>{everyApp.length === 0 ? 'В категории нет приложений.' : 'Сегодня приложения этой категории не открывали.'}</p> : null}
      {listed.map((app) => <AppLine key={app.packageName} app={app} ms={timeOf.get(app.packageName) ?? 0} max={mode === 'time' ? max : 0} />)}
      {mode === 'time' && !all && everyApp.length > used.length
        ? <button type='button' class='foot' onClick={() => setAll(true)}>Все приложения категории · {everyApp.length} <span>показать</span></button>
        : null}
      {mode === 'manage' ? <p class='muted small'><a href={`#/category/${category.id}`} onClick={countAdvancedOpened}>Правила и неделя ›</a></p> : null}
    </div>
  )
}

/** What is on now and «Закрыть всё»; while closed, the way back is on the same line. */
function ModeBox () {
  const { now } = useApp()
  const view = useScreen<NowView>()
  const tz = view.child.timeZone
  const rootViews = view.categories.filter((c) => c.depth === 0)
  const locked = rootViews.length > 0 && rootViews.every((c) => c.temporarilyBlocked) ? rootViews : []
  const lockedUntil = locked.length > 0 && locked.every((c) => c.temporarilyBlocked!.until) ? Math.max(...locked.map((c) => c.temporarilyBlocked!.until!)) : null
  const activeBan = view.bans.find((ban) => ban.activeNow)
  const morning = view.sleep?.end ?? null

  // ponytail: undo of a lock lets every category go, where the old console put back exactly the
  // blocks that were there before; one intent instead of a snapshot of the whole child
  const lock = (until: number | null, label: string) => () => ({
    key: `lock-${label}`,
    intent: 'lock',
    body: { until: until ?? undefined },
    done: `Всё закрыто ${until ? formatUntil(until, now, tz) : 'до снятия'}`,
    undo: () => ({ intent: 'lock', body: { off: true } })
  })

  if (locked.length > 0) {
    return (
      <section class='card mode closed'>
        <div class='row'>
          <span><b>Всё закрыто</b> {lockedUntil ? formatUntil(lockedUntil, now, tz) : 'до снятия'}</span>
          <ActionButton class='primary' work={() => ({
            key: 'unlock',
            intent: 'lock',
            body: { off: true },
            done: 'Снова открыто',
            undo: () => ({ intent: 'lock', body: { until: lockedUntil ?? undefined } })
          })}>Открыть</ActionButton>
        </div>
      </section>
    )
  }

  const status = view.activeSchedule === 'sleep' && morning !== null
    ? <><b>Сейчас Сон</b> {formatUntil(morning, now, tz)}</>
    : view.activeSchedule === 'study' && activeBan
      ? <><b>Сейчас Учёба</b> {formatUntil(banEndsAt(activeBan, now, tz), now, tz)}</>
      : <><b>Сейчас можно</b>{view.sleep && view.sleep.start > now ? <span class='muted'> · Сон с {clockOf(view.sleep.start)}</span> : null}</>
  return (
    <section class='card mode'>
      <div>{status}</div>
      <div class='row'>
        <span>Закрыть всё</span>
        <div class='chips'>
          <ActionButton disabled={rootViews.length === 0} work={lock(now + 30 * MINUTE, '30')}>30 мин</ActionButton>
          <ActionButton disabled={rootViews.length === 0} work={lock(now + 60 * MINUTE, '60')}>1 ч</ActionButton>
          {morning !== null
            ? <ActionButton disabled={rootViews.length === 0} work={lock(morning, 'morning')}>до утра</ActionButton>
            : <ActionButton disabled={rootViews.length === 0} work={lock(null, 'off')}>до снятия</ActionButton>}
        </div>
      </div>
    </section>
  )
}

// @tag:app-allowance
function Allowances () {
  const { now } = useApp()
  const view = useScreen<NowView>()
  if (view.allowances.length === 0) return null
  const tz = view.child.timeZone
  return (
    <section class='card'>
      <h2>Разрешено поверх лимитов</h2>
      <ul class='plain'>
        {view.allowances.map((item) => (
          <li key={item.packageName} class='row'>
            <span>{item.title} <span class='muted small'>{formatUntil(item.until, now, tz)}</span></span>
            <ActionButton class='link' work={() => ({
              key: `allowance-off-${item.packageName}`,
              intent: 'app-allow',
              body: { package: item.packageName, until: 0 },
              done: `${item.title}: разрешение снято`,
              undo: () => ({ intent: 'app-allow', body: { package: item.packageName, until: item.until } })
            })}>снять</ActionButton>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Until a tablet is connected there is nothing to limit, and that is the first thing to say. */
function ChildDevices () {
  return (
    <section class='card'>
      <p><b>Детский планшет ещё не подключён</b> — пока ограничивать нечего.</p>
      <button type='button' class='primary wide' onClick={() => { location.hash = '#/device' }}>Подключить планшет</button>
    </section>
  )
}

/** One menu for a category: time for today first, then closing, then the lasting settings. */
function CategoryMenu ({ category }: { category: CategoryNow }) {
  const { now } = useApp()
  const view = useScreen<NowView>()
  const tz = view.child.timeZone
  const title = (id: string) => view.categories.find((c) => c.id === id)?.title ?? id
  const remaining = category.remaining?.includingExtraTime ?? null
  const limit = category.limitNowMs
  const activeBan: Ban | undefined = view.bans.find((ban) => ban.activeNow && ban.categoryIds.includes(category.id))
  const banned = category.blockedNow === 'ban' || category.blockedNow === 'legacy-blocked-time'
  // ponytail: the view says until when limits are off, not whether that came from the category or
  // from the whole child, so "вернуть" appears only when the category outlives the child's permit
  const ownLimitsOff = category.limitsDisabledUntil !== null && category.limitsDisabledUntil > view.child.disableLimitsUntil
  // extra time does not get through a hard ban, so during one "+N" lifts the limits for N minutes instead
  const duringBan = banned || activeBan !== undefined

  const allowFor = (until: number, label: string) => () => ({
    key: `grant-${category.id}-${label}`,
    intent: 'allow',
    body: { category: category.id, until },
    done: `«${category.title}» разрешено ${formatUntil(until, now, tz)}`,
    undo: () => ({ intent: 'allow', body: { category: category.id, until: ownLimitsOff ? category.limitsDisabledUntil : 0 } })
  })
  const grant = (minutes: number) => duringBan
    ? allowFor(Math.max(now, category.limitsDisabledUntil ?? 0) + minutes * MINUTE, String(minutes))
    : () => ({
        key: `grant-${category.id}-${minutes}`,
        intent: 'grant',
        body: { category: category.id, minutes },
        done: `+${formatDuration(minutes * MINUTE)} к «${category.title}»`,
        undo: () => ({ intent: 'grant', body: { category: category.id, minutes: -minutes } })
      })

  const subtitle = [
    remaining === null ? 'без лимита сейчас' : `осталось ${formatDuration(remaining)}`,
    category.extraTimeMs > 0 ? `доп. ${formatDuration(category.extraTimeMs)}` : '',
    !category.countsTimeNow && !category.blockedNow && !category.blockedByParent && !category.limitsDisabledUntil ? 'время сейчас не считается' : ''
  ].filter(Boolean).join(' · ')

  return (
    <RowMenu title={category.title} subtitle={subtitle}>
      {limit !== null || duringBan
        ? (
          <>
            <div class='item-label'>Добавить на сегодня</div>
            <div class='chips grants'>
              {GRANTS.map((minutes) => <ActionButton key={minutes} work={grant(minutes)}>+{formatDuration(minutes * MINUTE)}</ActionButton>)}
              {activeBan ? <ActionButton class='link' work={allowFor(banEndsAt(activeBan, now, tz), 'end')}>до конца запрета</ActionButton> : null}
            </div>
          </>
          )
        : null}
      {category.temporarilyBlocked
        ? <ActionButton class='item' work={() => ({
          key: `unblock-${category.id}`,
          intent: 'lock',
          body: { category: category.id, off: true },
          done: `«${category.title}» открыто`,
          undo: () => ({ intent: 'lock', body: { category: category.id, until: category.temporarilyBlocked?.until ?? undefined } })
        })}>Открыть</ActionButton>
        : view.sleep !== null && category.depth === 0
          ? <ActionButton class='item closer' work={() => ({
            key: `close-${category.id}`,
            intent: 'lock',
            body: { category: category.id, until: view.sleep!.end },
            done: `«${category.title}» закрыто ${formatUntil(view.sleep!.end, now, tz)}`,
            undo: () => ({ intent: 'lock', body: { category: category.id, off: true } })
          })}>Закрыть до утра <span class='muted small'>до {clockOf(view.sleep.end)}</span></ActionButton>
          : null}
      {ownLimitsOff
        ? <ActionButton class='item' work={() => ({ key: `relimit-${category.id}`, intent: 'allow', body: { category: category.id, until: 0 }, done: `Лимиты «${category.title}» снова действуют`, undo: () => ({ intent: 'allow', body: { category: category.id, until: category.limitsDisabledUntil } }) })}>Вернуть лимиты</ActionButton>
        : null}
      {category.blockedByParent ? <div class='item-label'>Закрыто вместе с «{title(category.blockedByParent)}»</div> : null}
      <a class='item' href={`#/category/${category.id}`} onClick={countAdvancedOpened}>Правила и неделя ›</a>
    </RowMenu>
  )
}

const LIMIT_PRESETS = [30, 60, 90, 120]

/** The category's daily limit, edited on its own row: ready values in one tap, like an app's own limit. */
// @tag:category-limits
function DailyLimit ({ category }: { category: CategoryNow }) {
  const current = dailyLimitOf(category.dailyLimits)
  const presets = current.minutes !== null && !LIMIT_PRESETS.includes(current.minutes) ? [...LIMIT_PRESETS, current.minutes].sort((a, b) => a - b) : LIMIT_PRESETS
  // ponytail: undo puts back one limit for all days; a category whose days had different limits
  // (only the Android app can set that) comes back as the single limit shown here
  const change = (next: number | null) => () => ({
    key: `limit-${category.id}-${next}`,
    intent: 'limit-set',
    body: { category: category.id, minutes: next },
    done: next === null ? `«${category.title}»: без дневного лимита` : `«${category.title}»: лимит ${formatDuration(next * MINUTE)} в день`,
    undo: () => ({ intent: 'limit-set', body: { category: category.id, minutes: current.minutes } })
  })
  return (
    <div class='limit-line'>
      <span class='muted small'>Лимит в день</span>
      <div class='chips'>
        <ActionButton class={current.minutes === null ? 'primary' : ''} disabled={current.minutes === null} work={change(null)}>нет</ActionButton>
        {presets.map((minutes) => (
          <ActionButton key={minutes} class={current.minutes === minutes ? 'primary' : ''} disabled={current.minutes === minutes} work={change(minutes)}>
            {formatDuration(minutes * MINUTE)}
          </ActionButton>
        ))}
      </div>
      {current.mixed ? <div class='muted small'>В приложении на планшете заданы разные лимиты по дням (показан наименьший); нажатие заменит их одним на все дни.</div> : null}
    </div>
  )
}

/** A loophole shows as a line only while there is one — «История» used to hold it for good. */
export function Loopholes () {
  const { child, now } = useApp()
  const view = useScreen<NowView>()
  if (view.loopholes.length === 0) return null
  const titles = new Map(view.categories.map((c) => [c.id, c.title]))
  return (
    <section class='card warn-card'>
      <h2>Где время может уходить незаметно</h2>
      <ul>{view.loopholes.map((l) => <li key={l.kind + l.categoryId}>{loopholeText(l, titles, now, child.timeZone, view.child.disableLimitsUntil)}</li>)}</ul>
    </section>
  )
}
