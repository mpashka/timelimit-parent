import { useState } from 'preact/hooks'
import {
  allowCategoryUntil, allowChildUntil, grantExtraTime, lockChild, restoreTemporaryBlocks, revokeExtraTime, rootCategories, unlockChild
} from '../core/operations.ts'
import { type CategoryOverview, type ChildOverview, childOverview } from '../core/overview.ts'
import { childCategories, type FamilyState } from '../core/state.ts'
import { banEndsAt, formatDuration, formatUntil } from './format.ts'
import { countAdvancedOpened } from './store.ts'
import { ActionButton, useApp } from './ui.tsx'

// @tag:parent-console

const GRANTS = [15, 30, 60]
const MINUTE = 60000

const categoryIn = (state: FamilyState, childId: string, id: string) => childCategories(state, childId).find((c) => c.id === id)

export function Home () {
  const { state, child, now } = useApp()
  const overview = childOverview(state, child.id, now)
  return (
    <>
      <ChildActions overview={overview} />
      <section class='list'>
        {overview.categories.map((category) => <CategoryRow key={category.id} category={category} overview={overview} />)}
      </section>
      {overview.unassignedApps === null
        ? <p class='muted small'>Новые приложения без категории здесь не видны: сервер отдаёт список установленных только зашифрованным.</p>
        : null}
    </>
  )
}

function ChildActions ({ overview }: { overview: ChildOverview }) {
  const { state, child, now } = useApp()
  const tz = child.timeZone
  const roots = rootCategories(state, child.id)
  const rootViews = overview.categories.filter((c) => c.depth === 0)
  const locked = rootViews.every((c) => c.temporarilyBlocked) ? rootViews : []
  const lockedUntil = locked.length > 0 && locked.every((c) => c.temporarilyBlocked!.until) ? Math.max(...locked.map((c) => c.temporarilyBlocked!.until!)) : null
  const allowedUntil = child.disableLimitsUntil > now ? child.disableLimitsUntil : null

  const lock = (minutes: number | null) => () => ({
    key: `lock-${minutes}`,
    actions: lockChild({ state, child, until: minutes ? now + minutes * MINUTE : undefined }),
    done: minutes ? `Заблокировано на ${formatDuration(minutes * MINUTE)}` : 'Заблокировано до снятия',
    undo: () => restoreTemporaryBlocks(childCategories(state, child.id))
  })
  const allowAll = (minutes: number) => () => ({
    key: `allow-all-${minutes}`,
    actions: allowChildUntil(child, now + minutes * MINUTE),
    done: `Всё разрешено на ${formatDuration(minutes * MINUTE)}`,
    undo: () => allowChildUntil(child, child.disableLimitsUntil)
  })

  return (
    <section class='card actions'>
      {locked.length > 0
        ? (
          <div class='row'>
            <span><b>Заблокировано</b> {lockedUntil ? formatUntil(lockedUntil, now, tz) : 'до снятия'}</span>
            <ActionButton class='primary' work={() => ({
              key: 'unlock',
              actions: unlockChild({ state, child }),
              done: 'Блокировка снята',
              undo: () => restoreTemporaryBlocks(childCategories(state, child.id))
            })}>Разблокировать</ActionButton>
          </div>
          )
        : (
          <div class='row'>
            <span>Заблокировать</span>
            <div class='chips'>
              <ActionButton disabled={roots.length === 0} work={lock(30)}>30 мин</ActionButton>
              <ActionButton disabled={roots.length === 0} work={lock(60)}>1 ч</ActionButton>
              <ActionButton disabled={roots.length === 0} work={lock(null)}>до снятия</ActionButton>
            </div>
          </div>
          )}
      {allowedUntil
        ? (
          <div class='row'>
            <span><b>Всё разрешено</b> {formatUntil(allowedUntil, now, tz)}</span>
            <ActionButton work={() => ({ key: 'allow-all-off', actions: allowChildUntil(child, 0), done: 'Лимиты снова действуют', undo: () => allowChildUntil(child, allowedUntil) })}>Вернуть лимиты</ActionButton>
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

function CategoryRow ({ category, overview }: { category: CategoryOverview, overview: ChildOverview }) {
  const { state, child, now } = useApp()
  const [allowing, setAllowing] = useState(false)
  const tz = child.timeZone
  const view = categoryIn(state, child.id, category.id)
  if (!view) return null
  const title = (id: string) => overview.categories.find((c) => c.id === id)?.title ?? id
  const remaining = category.remaining?.includingExtraTime ?? null
  const limit = category.limitNowMs
  const activeBan = overview.bans.find((b) => b.activeNow && b.categoryIds.includes(category.id))
  const banned = category.blockedNow === 'ban' || category.blockedNow === 'legacy-blocked-time'

  const grant = (minutes: number) => () => ({
    key: `grant-${category.id}-${minutes}`,
    actions: grantExtraTime({ state, category: view, minutes, now }),
    done: `+${formatDuration(minutes * MINUTE)} к «${category.title}»`,
    undo: (fresh: FamilyState) => revokeExtraTime({ state: fresh, category: categoryIn(fresh, child.id, category.id) ?? view, minutes, now: Date.now() })
  })
  const allowFor = (until: number, label: string) => () => ({
    key: `allow-${category.id}-${label}`,
    actions: allowCategoryUntil(view, until),
    done: `«${category.title}» разрешено ${formatUntil(until, now, tz)}`,
    undo: () => allowCategoryUntil(view, view.base.dlu)
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
                actions: [{ type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED', categoryId: category.id, blocked: false }],
                done: `«${category.title}» разблокировано`,
                undo: () => restoreTemporaryBlocks([view])
              })}>снять</ActionButton>
            </span>
            )
          : null}
        {banned
          ? <span class='chip warn'>запрет {activeBan ? formatUntil(banEndsAt(activeBan, now, tz), now, tz) : ''}<button type='button' class='link' aria-expanded={allowing} onClick={() => setAllowing(!allowing)}>разрешить…</button></span>
          : null}
        {category.limitsDisabledUntil
          ? (
            <span class='chip'>лимиты сняты {formatUntil(category.limitsDisabledUntil, now, tz)}
              {view.base.dlu > now
                ? <ActionButton class='link' work={() => ({ key: `relimit-${category.id}`, actions: allowCategoryUntil(view, 0), done: `Лимиты «${category.title}» снова действуют`, undo: () => allowCategoryUntil(view, view.base.dlu) })}>вернуть</ActionButton>
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
      {allowing && banned
        ? (
          <div class='chips' role='group' aria-label='На сколько разрешить'>
            <ActionButton work={allowFor(now + 20 * MINUTE, '20')}>20 мин</ActionButton>
            <ActionButton work={allowFor(now + 60 * MINUTE, '60')}>1 ч</ActionButton>
            {activeBan ? <ActionButton work={allowFor(banEndsAt(activeBan, now, tz), 'end')}>до конца запрета</ActionButton> : null}
            <button type='button' class='link' onClick={() => setAllowing(false)}>отмена</button>
          </div>
          )
        : null}
      {limit !== null
        ? (
          <div class='chips grants'>
            {GRANTS.map((minutes) => <ActionButton key={minutes} work={grant(minutes)}>+{minutes}</ActionButton>)}
          </div>
          )
        : null}
    </article>
  )
}
