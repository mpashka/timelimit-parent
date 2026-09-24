import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { type CodeView, type FamilyView, type RequestsView, intent, view, listenChanged, loadWebConfig, signOut, type WebConfig } from './api.ts'
import { Bans } from './bans.tsx'
import { clockOf, errorText } from './format.ts'
import { AppCard, Apps } from './apps.tsx'
import { Devices } from './devices.tsx'
import { Requests } from './requests.tsx'
import { Home } from './home.tsx'
import { CategoryDetails } from './category.tsx'
import { AddChildForm, AddDevice } from './setup.tsx'
import { SignIn } from './signin.tsx'
import { Sites } from './sites.tsx'
import { clearLocal, forgetLegacySecrets, readLocal, writeLocal } from './store.ts'
import { Account, App, type AppContext, type IntentCall, Toast, type ToastMessage, useView, WAIT_INDICATOR_DELAY_MS, type Work } from './ui.tsx'

// @tag:parent-console

/** The page is told about changes, so this is only a safety net for an event stream that died quietly. */
const SAFETY_RELOAD_MS = 5 * 60 * 1000
const CLOCK_MS = 30000
const CODE_SHOWN_MS = 60000

const tabs = [
  { path: '', title: 'Сегодня', also: ['category'] },
  { path: 'apps', title: 'Приложения', also: ['app'] },
  { path: 'bans', title: 'Режимы', also: [] },
  { path: 'sites', title: 'Сайты', also: [] },
  { path: 'tablets', title: 'Планшеты', also: ['device'] }
]

const screenViews: Record<string, string | null> = { '': 'now', bans: 'bans', sites: 'sites', apps: 'apps', tablets: 'devices', device: null }

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
  // The panel is an entry of the browser history, so the phone's «back» closes it instead of leaving the page.
  const [bellOpen, setBellOpen] = useState(() => history.state?.panel === 'requests')
  const [panelRevision, setPanelRevision] = useState(0)
  const openBell = () => {
    history.pushState({ panel: 'requests' }, '', location.href)
    setBellOpen(true)
  }
  const closeBell = () => {
    if (history.state?.panel === 'requests') history.back()
    else setBellOpen(false)
  }
  useEffect(() => {
    const onPop = () => setBellOpen(history.state?.panel === 'requests')
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (route !== 'requests') return
    history.replaceState(null, '', '#/')
    dispatchEvent(new HashChangeEvent('hashchange'))
    openBell()
  }, [route])
  const toastId = useRef(0)

  const [requested, argument] = route.split('/')
  const screen = ['bans', 'sites', 'category', 'device', 'apps', 'app', 'tablets'].includes(requested) ? requested : ''
  const kids = family.children
  const child = kids.find((kid) => kid.id === childId) ?? kids[0]
  const viewName = child === undefined ? null : screen === 'category' ? `category/${argument ?? ''}` : screen === 'app' ? `app/${argument ?? ''}` : screenViews[screen] ?? null
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
      setPanelRevision((value) => value + 1)
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
        <button type='button' class={`bell ${bellOpen ? 'open' : ''}`} aria-expanded={bellOpen} onClick={() => (bellOpen ? closeBell() : openBell())}
          aria-label={waiting > 0 ? `Просьбы: ${waiting} ждёт ответа` : 'Просьбы'}>
          <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0' /></svg>
          {waiting > 0 ? <span class='count'>{waiting}</span> : null}
        </button>
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
              {screen === 'sites' ? <Sites /> : null}
              {screen === 'apps' ? <Apps /> : null}
              {screen === 'app' ? <AppCard /> : null}
              {screen === 'tablets' ? <Devices /> : null}
              {screen === 'category' ? <CategoryDetails /> : null}
              {screen === 'device' ? <AddDevice serverUrl={family.serverUrl} /> : null}
            </>
            )}
      </main>
      {bellOpen ? <RequestsPanel childId={child.id} revision={revision + panelRevision} close={closeBell} /> : null}
      <Toast toast={toast} close={() => setToast(null)} />
      <nav class='tabs'>
        {tabs.map((tab) => (
          <a key={tab.path} href={`#/${tab.path}`} onClick={(event) => {
            if (!bellOpen) return
            event.preventDefault()
            history.replaceState(null, '', `#/${tab.path}`)
            setBellOpen(false)
            dispatchEvent(new HashChangeEvent('hashchange'))
          }}
            aria-current={screen === tab.path || tab.also.includes(screen) ? 'page' : undefined}>{tab.title}</a>
        ))}
      </nav>
    </App.Provider>
  )
}

/**
 * The bell opens over whatever screen is open: a panel at the side in a browser, the whole page
 * under the header on a phone — one component, the layout is the stylesheet's business.
 */
// @tag:child-request
function RequestsPanel ({ childId, revision, close }: { childId: string, revision: number, close: () => void }) {
  const requests = useView<RequestsView>('requests', childId, revision)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <div class='scrim' onClick={close} />
      <aside class='panel' aria-label='Просьбы'>
        <div class='row'>
          <h2>Просьбы</h2>
          <button type='button' class='link' onClick={close}>Закрыть</button>
        </div>
        {requests.data
          ? <Requests view={requests.data} />
          : <p class='muted'>{requests.problem ? `Не загрузилось: ${requests.problem}` : 'Загружаем…'}</p>}
      </aside>
    </>
  )
}

/**
 * A key in the header; the six digits show only on a tap and hide after a minute, on a tap elsewhere
 * or when the page goes to the background — a child looking over the shoulder sees no code at rest.
 */
// @tag:parent-code
function ParentCode () {
  const [open, setOpen] = useState(false)
  return (
    <div class='code-menu'>
      <button type='button' class={`bell ${open ? 'open' : ''}`} aria-expanded={open} aria-label='Код родителя'
        onClick={() => setOpen((value) => !value)}>
        <svg viewBox='0 0 24 24' aria-hidden='true'><circle cx='8' cy='15' r='4' /><path d='M11 12l8-8M16 7l3 3M14 9l2 2' /></svg>
      </button>
      {open ? <CodePopup close={() => setOpen(false)} /> : null}
    </div>
  )
}

function CodePopup ({ close }: { close: () => void }) {
  const [now, setNow] = useState(Date.now())
  const [revision, setRevision] = useState(0)
  const [code, setCode] = useState<{ data?: CodeView, problem?: string }>({})
  const validUntil = code.data?.validUntil ?? null
  useEffect(() => {
    void view<CodeView>('code').then((answer) => setCode({ data: answer.data }), (ex: unknown) => setCode({ problem: errorText(ex).title }))
  }, [revision])
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const shown = setTimeout(close, CODE_SHOWN_MS)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const onHidden = () => { if (document.visibilityState === 'hidden') close() }
    addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHidden)
    return () => { clearInterval(tick); clearTimeout(shown); removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHidden) }
  }, [])
  useEffect(() => {
    if (validUntil === null) return
    const timer = setTimeout(() => setRevision((value) => value + 1), Math.max(validUntil - Date.now(), 0) + 200)
    return () => clearTimeout(timer)
  }, [validUntil])
  const left = code.data ? Math.max(0, Math.min(30, Math.round((code.data.validUntil - now) / 1000))) : 0
  return (
    <>
      <div class='scrim clear' onClick={close} />
      <div class='card code-popup' role='dialog' aria-label='Код родителя'>
        {code.data
          ? (
            <>
              <div class='code'>
                <svg class='ring' viewBox='0 0 24 24' aria-hidden='true'>
                  <circle class='track' cx='12' cy='12' r='9.5' />
                  <circle class='arc' cx='12' cy='12' r='9.5' pathLength='30' stroke-dasharray={`${left} 30`} transform='rotate(-90 12 12)' />
                </svg>
                <span class='digits'>{code.data.code.slice(0, 3)} {code.data.code.slice(3)}</span>
              </div>
              <p class='muted small'>Код родителя, ещё {left} с. Введите его на детском планшете в «Родитель рядом».</p>
            </>
            )
          : <p class='muted small'>{code.problem ? `Код не получен: ${code.problem}` : code.data === null ? 'Сервер синхронизации не выдаёт код родителя: он старше обновления с просьбами ребёнка.' : 'Загружаем код…'}</p>}
      </div>
    </>
  )
}

forgetLegacySecrets()
void loadWebConfig().then((config) => {
  const container = document.getElementById('app')!
  container.textContent = ''
  render(<Root config={config} />, container)
})
