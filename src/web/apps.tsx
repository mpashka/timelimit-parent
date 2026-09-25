import type { AppCardView, AppRule, AppsView, AppTime, NamedCategory, NewApp } from './api.ts'
import { ALL_DAYS, clockOf, DAY_NAMES, dayLabel, formatDuration, formatUntil } from './format.ts'
import { ActionButton, useApp, useScreen } from './ui.tsx'

// @tag:app-usage @tag:app-rule @tag:new-app

const MINUTE = 60000
const OWN_LIMITS = [30, 45, 60, 120]
const WEEKEND = 0b1100000
const NO_RULE: AppRule = { days: ALL_DAYS, limitMinutes: -1 }

export const appHref = (packageName: string): string => `#/app/${encodeURIComponent(packageName)}`

const letter = (title: string): string => (title.replace(/^(com|org|ru|io)\./, '')[0] ?? '?').toUpperCase()

export function AppIcon ({ title }: { title: string }) {
  return <span class='app-icon' aria-hidden='true'>{letter(title)}</span>
}

/** A line of the app list: the time bar is relative to the longest app, the row leads to the card. */
export function AppRow ({ app, max, note }: { app: AppTime, max: number, note?: string }) {
  return (
    <a class='app-row' href={appHref(app.packageName)}>
      <AppIcon title={app.title} />
      <div class='grow'>
        <div class='name'>{app.title}{app.category ? <span class='muted small'> · {app.category.title}</span> : null}</div>
        {note ? <div class='muted small'>{note}</div> : <div class='bar'><i style={{ width: `${max > 0 ? Math.round(app.ms / max * 100) : 0}%` }} /></div>}
      </div>
      <span class='value'>{formatDuration(app.ms)}</span>
    </a>
  )
}

/** The first line while the parent has not decided: the likely category in one tap, the others next to it. */
export function NewAppRow ({ app, categories }: { app: NewApp, categories: NamedCategory[] }) {
  const { child } = useApp()
  const guess = categories.find((category) => category.id === app.guess)
  const others = categories.filter((category) => category.id !== app.guess)
  const move = (category: NamedCategory) => () => ({
    key: `new-${app.packageName}-${category.id}`,
    intent: 'app-move',
    body: { package: app.packageName, category: category.id },
    done: `${app.title} — в «${category.title}», считается в её лимит`,
    undo: () => ({ intent: 'app-move', body: { package: app.packageName } })
  })
  return (
    <div class='app-row new'>
      <AppIcon title={app.title} />
      <div class='grow'>
        <div class='name'><a href={appHref(app.packageName)}>{app.title}</a> <span class='tag'>новое</span></div>
        <div class='muted small'>поставлено {clockOf(app.installedAt)}{app.device ? ` на «${app.device}»` : ''} · пока закрыто у {child.name}</div>
        <div class='chips'>
          {guess ? <ActionButton class='primary' work={move(guess)}>В {guess.title}</ActionButton> : null}
          {others.map((category) => <ActionButton key={category.id} work={move(category)}>{category.title}</ActionButton>)}
        </div>
      </div>
    </div>
  )
}

export function Apps () {
  const view = useScreen<AppsView>()
  const plain = (categories: AppsView['categories']): NamedCategory[] => categories.map(({ id, title }) => ({ id, title }))
  return (
    <>
      <h2 class='section'>Приложения {view.child.name} за неделю</h2>
      {view.appUsageProblem ? <p class='muted small'>Время по приложениям недоступно: {view.appUsageProblem}</p> : null}
      {view.newApps.map((app) => <NewAppRow key={app.packageName} app={app} categories={plain(view.categories)} />)}
      {view.categories.map((category) => (
        <section class='card' key={category.id}>
          <h2>{category.title}</h2>
          {category.apps.length === 0 ? <p class='muted small'>Приложений нет.</p> : null}
          {category.apps.map((app) => <WeekRow key={`${app.packageName}@${app.device ?? ''}`} app={app} />)}
        </section>
      ))}
      {view.other.length > 0
        ? <section class='card'><h2>Вне категорий</h2>{view.other.map((app) => <WeekRow key={app.packageName} app={app} />)}</section>
        : null}
    </>
  )
}

function WeekRow ({ app }: { app: AppsView['other'][number] & { device?: string | null } }) {
  return (
    <a class='app-row' href={appHref(app.packageName)}>
      <AppIcon title={app.title} />
      <div class='grow'>
        <div class='name'>{app.title}</div>
        {app.device ? <div class='muted small'>только на «{app.device}»</div> : null}
        {app.rule ? <div class='muted small'>{ruleText(app.rule)}</div> : null}
      </div>
      <span class='value'>{app.weekMs > 0 ? formatDuration(app.weekMs) : '—'}</span>
    </a>
  )
}

export function ruleText (rule: AppRule): string {
  if (rule.days === 0) return 'закрыто всегда'
  const days = rule.days === ALL_DAYS ? '' : rule.days === WEEKEND ? 'только сб и вс' : `только ${DAY_NAMES.filter((_, i) => (rule.days & (1 << i)) !== 0).join(', ')}`
  const limit = rule.limitMinutes >= 0 ? `свой лимит ${formatDuration(rule.limitMinutes * MINUTE)}` : ''
  return [days, limit].filter(Boolean).join(' · ')
}

export function AppCard () {
  const { now, child } = useApp()
  const view = useScreen<AppCardView>()
  const tz = child.timeZone
  const rule = view.rule ?? NO_RULE
  const max = Math.max(1, ...(view.days ?? []).map((item) => item.ms))

  const setRule = (next: AppRule, done: string) => () => ({
    key: `rule-${next.days}-${next.limitMinutes}`,
    intent: 'app-rule',
    body: { package: view.packageName, ...next },
    done,
    undo: () => ({ intent: 'app-rule', body: { package: view.packageName, ...rule } })
  })
  const allow = (minutes: number) => () => {
    const until = Math.max(now, view.allowanceUntil ?? 0) + minutes * MINUTE
    return {
      key: `allow-${minutes}`,
      intent: 'app-allow',
      body: { package: view.packageName, until },
      done: `${view.title}: разрешено ${formatUntil(until, now, tz)}`,
      undo: () => ({ intent: 'app-allow', body: { package: view.packageName, until: view.allowanceUntil ?? 0 } })
    }
  }
  const move = (category: NamedCategory | null) => () => ({
    key: `move-${category?.id ?? 'none'}`,
    intent: 'app-move',
    body: { package: view.packageName, category: category?.id },
    done: category ? `${view.title} — в «${category.title}»` : `${view.title} — вне категорий`,
    undo: () => ({ intent: 'app-move', body: { package: view.packageName, category: view.category?.id } })
  })

  return (
    <>
      <p class='muted small'><a href='#/apps'>Приложения</a> ›</p>
      <section class='card'>
        <div class='row'>
          <h2><AppIcon title={view.title} /> {view.title} {view.isNew ? <span class='tag'>новое</span> : null}</h2>
        </div>
        <div class='muted small'>
          {view.todayMs !== null ? `сегодня ${formatDuration(view.todayMs)} · в среднем ${formatDuration(view.averageMs ?? 0)} в день` : `время недоступно: ${view.appUsageProblem ?? 'нет данных'}`}
        </div>
        {view.days
          ? (
            <div class='week'>
              {view.days.map((item) => (
                <div class='day-bar' key={item.day}>
                  <span class='muted small'>{Math.round(item.ms / MINUTE)}</span>
                  <i style={{ height: `${Math.round(item.ms / max * 100)}%` }} />
                  <span class='muted small'>{dayLabel(item.day).split(' ')[0]}</span>
                </div>
              ))}
            </div>
            )
          : null}
      </section>

      <section class='card'>
        <h3>Категория{view.devices.length > 1 ? ' на всех планшетах' : ''}</h3>
        <div class='chips'>
          {view.categories.map((category) => (
            <ActionButton key={category.id} class={view.category?.id === category.id ? 'primary' : ''} disabled={view.category?.id === category.id}
              work={move(category)}>{category.title}</ActionButton>
          ))}
        </div>
        {view.devices.length > 1 ? view.devices.map((device) => <DeviceCategory key={device.deviceId} view={view} device={device} />) : null}
      </section>

      <section class='card'>
        <h3>Свой лимит{view.category ? ` внутри лимита «${view.category.title}»` : ''}</h3>
        <div class='chips'>
          <ActionButton class={rule.limitMinutes < 0 ? 'primary' : ''} work={setRule({ ...rule, limitMinutes: -1 }, `${view.title}: своего лимита нет`)}>нет</ActionButton>
          {OWN_LIMITS.map((minutes) => (
            <ActionButton key={minutes} class={rule.limitMinutes === minutes ? 'primary' : ''}
              work={setRule({ ...rule, limitMinutes: minutes }, `${view.title} — ${formatDuration(minutes * MINUTE)} в день`)}>{formatDuration(minutes * MINUTE)}</ActionButton>
          ))}
        </div>
        <h3>Дни</h3>
        <div class='chips'>
          <ActionButton class={rule.days === ALL_DAYS ? 'primary' : ''} work={setRule({ ...rule, days: ALL_DAYS }, `${view.title}: все дни`)}>все дни</ActionButton>
          <ActionButton class={rule.days === WEEKEND ? 'primary' : ''} work={setRule({ ...rule, days: WEEKEND }, `${view.title}: только сб и вс`)}>только сб и вс</ActionButton>
          <ActionButton class={rule.days === 0 ? 'primary closer' : 'closer'} work={setRule({ ...rule, days: rule.days === 0 ? ALL_DAYS : 0 }, rule.days === 0 ? `${view.title} снова открывается` : `${view.title} закрыто всегда`)}>
            {rule.days === 0 ? 'Открыть снова' : 'Закрыть всегда'}
          </ActionButton>
        </div>
        {rule.days === 0 ? <p class='muted small'>{view.title} не откроется ни в лимит, ни по просьбе без ответа родителя.</p> : null}
      </section>

      <section class='card'>
        <h3>Сегодня сверх всего</h3>
        {view.allowanceUntil ? <p>Разрешено {formatUntil(view.allowanceUntil, now, tz)}</p> : null}
        <div class='chips grants'>
          {[15, 30, 60].map((minutes) => <ActionButton key={minutes} work={allow(minutes)}>+{minutes}</ActionButton>)}
          {view.allowanceUntil
            ? <ActionButton class='link' work={() => ({ key: 'allow-off', intent: 'app-allow', body: { package: view.packageName, until: 0 }, done: `${view.title}: разрешение снято`, undo: () => ({ intent: 'app-allow', body: { package: view.packageName, until: view.allowanceUntil } }) })}>снять</ActionButton>
            : null}
        </div>
      </section>

      {view.devices.length > 0
        ? (
          <section class='card'>
            <h3>По планшетам, неделя</h3>
            <ul class='plain'>
              {view.devices.map((device) => <li key={device.deviceId} class='row'><span>{device.name}</span><b>{device.weekMs === null ? '—' : formatDuration(device.weekMs)}</b></li>)}
            </ul>
          </section>
          )
        : null}
    </>
  )
}

/** A tablet's own category for the app: on that tablet it wins over the shared one, «как везде» removes it. */
function DeviceCategory ({ view, device }: { view: AppCardView, device: AppCardView['devices'][number] }) {
  const move = (category: NamedCategory | null) => () => ({
    key: `move-${device.deviceId}-${category?.id ?? 'none'}`,
    intent: 'app-move',
    body: { package: view.packageName, device: device.deviceId, category: category?.id },
    done: category ? `${view.title} на «${device.name}» — в «${category.title}»` : `${view.title} на «${device.name}» — как на всех`,
    undo: () => ({ intent: 'app-move', body: { package: view.packageName, device: device.deviceId, category: device.category?.id } })
  })
  return (
    <>
      <h3>На «{device.name}»</h3>
      <div class='chips'>
        <ActionButton class={device.category === null ? 'primary' : ''} disabled={device.category === null} work={move(null)}>как везде</ActionButton>
        {view.categories.map((category) => (
          <ActionButton key={category.id} class={device.category?.id === category.id ? 'primary' : ''} disabled={device.category?.id === category.id}
            work={move(category)}>{category.title}</ActionButton>
        ))}
      </div>
    </>
  )
}
