import type { Ban, CategoryNow, NowView } from './api.ts'
import { banEndsAt, clockOf, formatDuration, formatUntil } from './format.ts'
import { AppRow, NewAppRow } from './apps.tsx'
import { DeviceLine } from './devices.tsx'
import { countAdvancedOpened } from './store.ts'
import { ActionButton, useApp, useScreen } from './ui.tsx'

// @tag:parent-console

const GRANTS = [15, 30, 60]
const MINUTE = 60000

export function Home () {
  const view = useScreen<NowView>()
  const categoryTotal = view.categories.filter((c) => c.depth === 0).reduce((sum, c) => sum + c.usedTodayMs, 0)
  const total = view.apps === null ? categoryTotal : view.apps.reduce((sum, app) => sum + app.ms, 0)
  const categories = view.categories.filter((c) => c.depth === 0).map(({ id, title }) => ({ id, title }))
  const max = Math.max(0, ...(view.apps ?? []).map((app) => app.ms))
  return (
    <div class='columns'>
      <div>
        <section class='hero'>
          <div class='muted small'>Сегодня</div>
          <div class='big'>{formatDuration(total)}{view.devices.length > 1 ? <small class='muted'> на {view.devices.length} планшетах</small> : null}</div>
        </section>
        {view.devices.length === 0 ? <ChildDevices /> : null}
        {view.newApps.length > 0 || (view.apps ?? []).length > 0 ? <h2 class='section'>Приложения <a class='small' href='#/apps'>все</a></h2> : null}
        {view.newApps.map((app) => <NewAppRow key={app.packageName} app={app} categories={categories} />)}
        <section class='list'>
          {(view.apps ?? []).map((app) => <AppRow key={app.packageName} app={app} max={max} />)}
        </section>
        {view.appUsageProblem ? <p class='muted small'>Время по приложениям недоступно: {view.appUsageProblem}</p> : null}
      </div>
      <div>
        <ModeBox />
        <Allowances />
        <h2 class='section'>Категории</h2>
        <section class='list'>
          {view.categories.map((category) => <CategoryRow key={category.id} category={category} />)}
        </section>
        {view.devices.length > 0 ? <ChildDevices /> : null}
      </div>
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

/** Devices of the child and devices that joined but have no user yet; the entry to connecting another one. */
function ChildDevices () {
  const view = useScreen<NowView>()
  if (view.devices.length === 0) {
    return (
      <section class='card'>
        <p><b>Детский планшет ещё не подключён</b> — пока ограничивать нечего.</p>
        <button type='button' class='primary wide' onClick={() => { location.hash = '#/device' }}>Подключить планшет</button>
      </section>
    )
  }
  return (
    <>
      <h2 class='section'>Планшеты <a class='small' href='#/tablets'>все</a></h2>
      <ul class='plain card'>{view.devices.map((device) => <DeviceLine key={device.deviceId} device={device} />)}</ul>
    </>
  )
}

function CategoryRow ({ category }: { category: CategoryNow }) {
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

  return (
    <article class='card category' style={{ marginInlineStart: `${category.depth * 12}px` }}>
      <div class='row'>
        <h2>{category.title}</h2>
        <span class='remaining'>{remaining === null ? 'без лимита сейчас' : `осталось ${formatDuration(remaining)}`}</span>
      </div>
      {limit !== null
        ? <progress max={limit + category.extraTimeMs} value={Math.min(category.usedTodayMs, limit + category.extraTimeMs)} />
        : null}
      <div class='muted small'>
        сегодня {formatDuration(category.usedTodayMs)}
        {limit !== null ? ` из ${formatDuration(limit)}` : ''}
        {category.extraTimeMs > 0 ? ` · доп. ${formatDuration(category.extraTimeMs)}` : ''}
        {' · '}<a href={`#/category/${category.id}`} onClick={countAdvancedOpened}>подробнее</a>
      </div>
      <div class='chips'>
        {category.temporarilyBlocked
          ? (
            <span class='chip warn'>заблокировано {category.temporarilyBlocked.until ? formatUntil(category.temporarilyBlocked.until, now, tz) : 'до снятия'}
              <ActionButton class='link' work={() => ({
                key: `unblock-${category.id}`,
                intent: 'lock',
                body: { category: category.id, off: true },
                done: `«${category.title}» разблокировано`,
                undo: () => ({ intent: 'lock', body: { category: category.id, until: category.temporarilyBlocked?.until ?? undefined } })
              })}>снять</ActionButton>
            </span>
            )
          : null}
        {banned
          ? <span class='chip warn'>запрет {activeBan ? formatUntil(banEndsAt(activeBan, now, tz), now, tz) : ''}</span>
          : null}
        {category.limitsDisabledUntil
          ? (
            <span class='chip'>лимиты сняты {formatUntil(category.limitsDisabledUntil, now, tz)}
              {ownLimitsOff
                ? <ActionButton class='link' work={() => ({ key: `relimit-${category.id}`, intent: 'allow', body: { category: category.id, until: 0 }, done: `Лимиты «${category.title}» снова действуют`, undo: () => ({ intent: 'allow', body: { category: category.id, until: category.limitsDisabledUntil } }) })}>вернуть</ActionButton>
                : null}
            </span>
            )
          : null}
        {category.blockedNow === 'limit-reached' ? <span class='chip warn'>время вышло</span> : null}
        {category.blockedByParent ? <span class='chip'>заблокировано вместе с «{title(category.blockedByParent)}»</span> : null}
        {!category.countsTimeNow && !category.blockedNow && !category.blockedByParent && !category.limitsDisabledUntil
          ? <span class='chip'>время сейчас не считается</span>
          : null}
      </div>
      {limit !== null || duringBan
        ? (
          <div class='chips grants'>
            {GRANTS.map((minutes) => <ActionButton key={minutes} work={grant(minutes)}>+{minutes}</ActionButton>)}
            {activeBan ? <ActionButton class='link' work={allowFor(banEndsAt(activeBan, now, tz), 'end')}>до конца запрета</ActionButton> : null}
            {view.sleep !== null && !category.temporarilyBlocked && category.depth === 0
              ? <ActionButton class='closer' work={() => ({
                key: `close-${category.id}`,
                intent: 'lock',
                body: { category: category.id, until: view.sleep!.end },
                done: `«${category.title}» закрыто ${formatUntil(view.sleep!.end, now, tz)}`,
                undo: () => ({ intent: 'lock', body: { category: category.id, off: true } })
              })}>Закрыть до утра</ActionButton>
              : null}
          </div>
          )
        : null}
    </article>
  )
}
