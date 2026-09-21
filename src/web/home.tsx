import type { Ban, CategoryNow, NowView } from './api.ts'
import { banEndsAt, formatDuration, formatUntil } from './format.ts'
import { countAdvancedOpened } from './store.ts'
import { ActionButton, useApp, useScreen } from './ui.tsx'

// @tag:parent-console

const GRANTS = [15, 30, 60]
const MINUTE = 60000

export function Home () {
  const view = useScreen<NowView>()
  return (
    <>
      {view.devices.length === 0 ? <ChildDevices /> : null}
      <ChildActions />
      <section class='list'>
        {view.categories.map((category) => <CategoryRow key={category.id} category={category} />)}
      </section>
      {view.devices.length > 0 ? <ChildDevices /> : null}
      {view.unassignedApps === null
        ? <p class='muted small'>Новые приложения без категории здесь не видны: сервер отдаёт список установленных только зашифрованным.</p>
        : null}
    </>
  )
}

/** Devices of the child and devices that joined but have no user yet; the entry to connecting another one. */
function ChildDevices () {
  const { family, child } = useApp()
  const view = useScreen<NowView>()
  const users = new Set([...family.children, ...family.parents].map((person) => person.id))
  const own = view.devices
  const unassigned = family.devices.filter((device) => !users.has(device.currentUserId))
  return (
    <section class='card'>
      {own.length === 0
        ? <p><b>Детское устройство ещё не подключено</b> — пока ограничивать нечего.</p>
        : <h2>Устройства: {child.name}</h2>}
      {own.length > 0 ? <ul class='plain'>{own.map((d) => <li key={d.deviceId}>{d.name} <span class='muted small'>{d.model}</span></li>)}</ul> : null}
      {unassigned.length > 0
        ? <p class='muted small'>Подключены, но пользователь не выбран: {unassigned.map((d) => `«${d.name}»`).join(', ')} — выберите «{child.name}» на самом устройстве.</p>
        : null}
      <button type='button' class={own.length === 0 ? 'primary wide' : 'wide'} onClick={() => { location.hash = '#/device' }}>Подключить устройство</button>
    </section>
  )
}

function ChildActions () {
  const { now } = useApp()
  const view = useScreen<NowView>()
  const child = view.child
  const tz = child.timeZone
  const rootViews = view.categories.filter((c) => c.depth === 0)
  const locked = rootViews.length > 0 && rootViews.every((c) => c.temporarilyBlocked) ? rootViews : []
  const lockedUntil = locked.length > 0 && locked.every((c) => c.temporarilyBlocked!.until) ? Math.max(...locked.map((c) => c.temporarilyBlocked!.until!)) : null
  const allowedUntil = child.disableLimitsUntil > now ? child.disableLimitsUntil : null

  // ponytail: undo of a lock lets every category go, where the old console put back exactly the
  // blocks that were there before; one intent instead of a snapshot of the whole child
  const lock = (minutes: number | null) => () => ({
    key: `lock-${minutes}`,
    intent: 'lock',
    body: { until: minutes ? now + minutes * MINUTE : undefined },
    done: minutes ? `Заблокировано на ${formatDuration(minutes * MINUTE)}` : 'Заблокировано до снятия',
    undo: () => ({ intent: 'lock', body: { off: true } })
  })
  const allowAll = (minutes: number) => () => ({
    key: `allow-all-${minutes}`,
    intent: 'allow',
    body: { until: now + minutes * MINUTE },
    done: `Всё разрешено на ${formatDuration(minutes * MINUTE)}`,
    undo: () => ({ intent: 'allow', body: { until: child.disableLimitsUntil } })
  })

  return (
    <section class='card actions'>
      {locked.length > 0
        ? (
          <div class='row'>
            <span><b>Заблокировано</b> {lockedUntil ? formatUntil(lockedUntil, now, tz) : 'до снятия'}</span>
            <ActionButton class='primary' work={() => ({
              key: 'unlock',
              intent: 'lock',
              body: { off: true },
              done: 'Блокировка снята',
              undo: () => ({ intent: 'lock', body: { until: lockedUntil ?? undefined } })
            })}>Разблокировать</ActionButton>
          </div>
          )
        : (
          <div class='row'>
            <span>Заблокировать</span>
            <div class='chips'>
              <ActionButton disabled={rootViews.length === 0} work={lock(30)}>30 мин</ActionButton>
              <ActionButton disabled={rootViews.length === 0} work={lock(60)}>1 ч</ActionButton>
              <ActionButton disabled={rootViews.length === 0} work={lock(null)}>до снятия</ActionButton>
            </div>
          </div>
          )}
      {allowedUntil
        ? (
          <div class='row'>
            <span><b>Всё разрешено</b> {formatUntil(allowedUntil, now, tz)}</span>
            <ActionButton work={() => ({ key: 'allow-all-off', intent: 'allow', body: { until: 0 }, done: 'Лимиты снова действуют', undo: () => ({ intent: 'allow', body: { until: allowedUntil } }) })}>Вернуть лимиты</ActionButton>
          </div>
          )
        : (
          <div class='row'>
            <span>Разрешить всё</span>
            <div class='chips'>
              <ActionButton work={allowAll(20)}>20 мин</ActionButton>
              <ActionButton work={allowAll(60)}>1 ч</ActionButton>
              <ActionButton work={allowAll(120)}>2 ч</ActionButton>
            </div>
          </div>
          )}
    </section>
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
          </div>
          )
        : null}
    </article>
  )
}
