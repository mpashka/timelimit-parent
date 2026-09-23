import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { type CodeView, type FamilyView, intent, listenChanged, loadWebConfig, signOut, type WebConfig } from './api.ts'
import { Bans } from './bans.tsx'
import { clockOf, errorText } from './format.ts'
import { History } from './history.tsx'
import { Requests } from './requests.tsx'
import { Home } from './home.tsx'
import { CategoryDetails, Limits } from './limits.tsx'
import { AddChildForm, AddDevice } from './setup.tsx'
import { SignIn } from './signin.tsx'
import { Sites } from './sites.tsx'
import { clearLocal, forgetLegacySecrets, readLocal, writeLocal } from './store.ts'
import { Account, App, type AppContext, type IntentCall, Toast, type ToastMessage, useView, WAIT_INDICATOR_DELAY_MS, type Work } from './ui.tsx'

// @tag:parent-console

/** The page is told about changes, so this is only a safety net for an event stream that died quietly. */
const SAFETY_RELOAD_MS = 5 * 60 * 1000
const CLOCK_MS = 30000

const tabs = [
  { path: '', title: 'Сегодня' },
  { path: 'bans', title: 'Режимы' },
  { path: 'limits', title: 'Лимиты' },
  { path: 'history', title: 'История' },
  { path: 'sites', title: 'Сайты' }
]

const screenViews: Record<string, string | null> = { '': 'now', bans: 'bans', limits: 'limits', history: 'history', sites: 'sites', requests: 'requests', device: null }

const currentRoute = () => location.hash.replace(/^#\/?/, '')

function useRoute (): string {
  const [route, setRoute] = useState(currentRoute())
  useEffect(() => {
    const listener = () => setRoute(currentRoute())
    addEventListener('hashchange', listener)
    return () => removeEventListener('hashchange', listener)
  }, [])
  return route
}

function Root ({ config }: { config: WebConfig }) {
  const [signedOut, setSignedOut] = useState(false)
  const [revision, setRevision] = useState(0)
  const reload = () => setRevision((value) => value + 1)
  const family = useView<FamilyView>(signedOut ? null : 'family', undefined, revision, (ex) => {
    if (errorText(ex).signInAgain) setSignedOut(true)
  })

  useEffect(() => {
    if (signedOut) return
    const stop = listenChanged(reload)
    const safety = setInterval(reload, SAFETY_RELOAD_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { stop(); clearInterval(safety); document.removeEventListener('visibilitychange', onVisible) }
  }, [signedOut])

  const leave = async () => {
    try {
      await signOut()
    } finally {
      clearLocal()
      setSignedOut(true)
    }
  }

  if (signedOut) return <SignIn googleClientId={config.googleClientId} onSignedIn={() => { setSignedOut(false); reload() }} />
  if (!family.data) {
    return (
      <main class='page'>
        <p class='muted'>{family.problem ? `Не удалось загрузить семью: ${family.problem}` : 'Загружаем семью…'}</p>
        {family.problem ? <button type='button' onClick={reload}>Повторить</button> : null}
        <button type='button' class='link' onClick={() => void leave()}>Выйти</button>
      </main>
    )
  }
  return <Console family={family.data} familyStale={family.staleSince} revision={revision} reload={reload} leave={leave} />
}

function Console ({ family, familyStale, revision, reload, leave }: {
  family: FamilyView, familyStale: number | null, revision: number, reload: () => void, leave: () => Promise<void>
}) {
  const route = useRoute()
  const [childId, setChildId] = useState(readLocal('child') ?? '')
  const [now, setNow] = useState(Date.now())
  const [pending, setPending] = useState<AppContext['pending']>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const toastId = useRef(0)

  const [requested, argument] = route.split('/')
  const screen = ['bans', 'limits', 'history', 'sites', 'category', 'device', 'requests'].includes(requested) ? requested : ''
  const kids = family.children
  const child = kids.find((kid) => kid.id === childId) ?? kids[0]
  const viewName = child === undefined ? null : screen === 'category' ? `category/${argument ?? ''}` : screenViews[screen] ?? null
  const screenView = useView<unknown>(viewName, child?.id, revision)
  const latest = useRef<unknown>(null)
  latest.current = screenView.data

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(clock)
  }, [])
  useEffect(() => { setNow(Date.now()) }, [revision])
  useEffect(() => { setToast((current) => current?.kind === 'done' ? null : current) }, [route])

  const showError = (ex: unknown) => {
    const text = errorText(ex)
    setToast({ id: ++toastId.current, kind: 'error', text: text.title, hint: text.hint, signInAgain: text.signInAgain ? () => void leave() : undefined })
  }

  const runUndo = (undo: (fresh: unknown) => IntentCall) => {
    let call: IntentCall
    try {
      call = undo(latest.current)
    } catch (ex) {
      showError(ex)
      return
    }
    void run({ key: 'undo', ...call, done: 'Отменено' })
  }

  const run = async (work: Work): Promise<boolean> => {
    setPending({ key: work.key, waiting: false })
    const timer = setTimeout(() => setPending({ key: work.key, waiting: true }), WAIT_INDICATOR_DELAY_MS)
    try {
      const answer = await intent(work.intent, { child: child?.id, ...work.body, ...(viewName === null ? {} : { view: viewName }) })
      if (answer.data === undefined) reload()
      else screenView.set(answer.data)
      const undo = work.undo
      setToast({ id: ++toastId.current, kind: 'done', text: work.done, undo: undo && (() => runUndo(undo)) })
      return true
    } catch (ex) {
      showError(ex)
      return false
    } finally {
      clearTimeout(timer)
      setPending(null)
    }
  }

  if (!child) {
    return (
      <main class='page signin'>
        <AddChildForm run={run} />
        <button type='button' class='link' onClick={() => void leave()}>Выйти</button>
        <Toast toast={toast} close={() => setToast(null)} />
      </main>
    )
  }

  const context: AppContext = { family, child, now, view: screenView.data, pending, run, showError }
  const parent = family.parents.find((person) => person.id === family.signedInUserId)
  const stale = screenView.staleSince ?? familyStale
  const askToLeave = () => {
    if (confirm('Выйти из веб-админки? Для входа снова понадобится Google-аккаунт или код из письма.')) void leave()
  }
  const waiting = family.waitingRequests?.[child.id] ?? 0

  return (
    <App.Provider value={context}>
      <header class='top'>
        <div class='who'>
          {kids.length > 1
            ? (
              <div class='segmented' role='tablist'>
                {kids.map((kid) => (
                  <button type='button' role='tab' aria-selected={kid.id === child.id} key={kid.id}
                    onClick={() => { writeLocal('child', kid.id); setChildId(kid.id) }}>{kid.name}</button>
                ))}
              </div>
              )
            : <h1>{child.name}</h1>}
        </div>
        <ParentCode />
        <a class={`bell ${screen === 'requests' ? 'open' : ''}`} href={screen === 'requests' ? '#/' : '#/requests'}
          aria-label={waiting > 0 ? `Просьбы: ${waiting} ждёт ответа` : 'Просьбы'}>
          <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0' /></svg>
          {waiting > 0 ? <span class='count'>{waiting}</span> : null}
        </a>
        <details class='account-menu'>
          <summary aria-label='Аккаунт'>⋯</summary>
          <div class='card'>
            <Account parent={parent} serverUrl={family.serverUrl} />
            <button type='button' class='link' onClick={askToLeave}>Выйти</button>
          </div>
        </details>
      </header>
      {stale !== null
        ? <div class='banner'>Данные от {clockOf(stale)}: сервер синхронизации не отвечает, показано последнее известное.</div>
        : null}
      {screenView.problem
        ? <div class='banner'>Не обновилось: {screenView.problem}. <button type='button' class='link' onClick={reload}>Повторить</button></div>
        : null}
      {family.message ? <div class='banner'>Сообщение сервера: {family.message}</div> : null}
      <main class='page'>
        {viewName !== null && screenView.data === null
          ? <p class='muted'>{screenView.problem ? <a href='#/'>← На главную</a> : 'Загружаем…'}</p>
          : (
            <>
              {screen === '' ? <Home /> : null}
              {screen === 'bans' ? <Bans /> : null}
              {screen === 'limits' ? <Limits /> : null}
              {screen === 'history' ? <History /> : null}
              {screen === 'sites' ? <Sites /> : null}
              {screen === 'requests' ? <Requests /> : null}
              {screen === 'category' ? <CategoryDetails /> : null}
              {screen === 'device' ? <AddDevice serverUrl={family.serverUrl} /> : null}
            </>
            )}
      </main>
      <Toast toast={toast} close={() => setToast(null)} />
      <nav class='tabs'>
        {tabs.map((tab) => (
          <a key={tab.path} href={`#/${tab.path}`} aria-current={screen === tab.path || (tab.path === 'limits' && screen === 'category') ? 'page' : undefined}>{tab.title}</a>
        ))}
      </nav>
    </App.Provider>
  )
}

/** Six digits and a ring that runs out with them; a new code is asked for exactly when this one ends. */
// @tag:parent-code
function ParentCode () {
  const [revision, setRevision] = useState(0)
  const [now, setNow] = useState(Date.now())
  const code = useView<CodeView>('code', undefined, revision)
  const validUntil = code.data?.validUntil ?? null
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => {
    if (validUntil === null) return
    const timer = setTimeout(() => setRevision((value) => value + 1), Math.max(validUntil - Date.now(), 0) + 200)
    return () => clearTimeout(timer)
  }, [validUntil])
  if (!code.data) return null
  const left = Math.max(0, Math.min(30, Math.round((code.data.validUntil - now) / 1000)))
  return (
    <div class='code' title='Код родителя: введите его на детском планшете в «Родитель рядом»'>
      <svg class='ring' viewBox='0 0 24 24' aria-hidden='true'>
        <circle class='track' cx='12' cy='12' r='9.5' />
        <circle class='arc' cx='12' cy='12' r='9.5' pathLength='30' stroke-dasharray={`${left} 30`} transform='rotate(-90 12 12)' />
      </svg>
      <div><small>код родителя</small><span class='digits'>{code.data.code.slice(0, 3)} {code.data.code.slice(3)}</span></div>
    </div>
  )
}

forgetLegacySecrets()
void loadWebConfig().then((config) => {
  const container = document.getElementById('app')!
  container.textContent = ''
  render(<Root config={config} />, container)
})
