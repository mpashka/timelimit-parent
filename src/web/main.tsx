import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TimelimitApi } from '../core/api.ts'
import { children, type FamilyState } from '../core/state.ts'
import { Bans } from './bans.tsx'
import { errorText } from './format.ts'
import { History } from './history.tsx'
import { Home } from './home.tsx'
import { CategoryDetails, Limits } from './limits.tsx'
import { SignIn } from './signin.tsx'
import { Sites } from './sites.tsx'
import { type Auth, clearLocal, Connection, createApi, loadWebConfig, readAuth, readLocal, type WebConfig, writeLocal } from './store.ts'
import { App, type AppContext, Toast, type ToastMessage, WAIT_INDICATOR_DELAY_MS, type Work } from './ui.tsx'

// @tag:parent-console

const POLL_MS = 30000

const tabs = [
  { path: '', title: 'Сейчас' },
  { path: 'bans', title: 'Запреты' },
  { path: 'limits', title: 'Лимиты' },
  { path: 'history', title: 'История' },
  { path: 'sites', title: 'Сайты' }
]

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

function Root ({ config, api }: { config: WebConfig, api: TimelimitApi }) {
  const [auth, setAuth] = useState<Auth | null>(readAuth())
  if (!auth) return <SignIn api={api} googleClientId={config.googleClientId} onSignedIn={setAuth} />
  return <Console api={api} auth={auth} onSignOut={() => { clearLocal(); setAuth(null) }} />
}

function Console ({ api, auth, onSignOut }: { api: TimelimitApi, auth: Auth, onSignOut: () => void }) {
  const connection = useMemo(() => new Connection(api, auth), [auth.deviceAuthToken])
  const [state, setState] = useState<FamilyState | null>(null)
  const [now, setNow] = useState(Date.now())
  const [syncProblem, setSyncProblem] = useState<string | null>(null)
  const [pending, setPending] = useState<AppContext['pending']>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [childId, setChildId] = useState(readLocal('child'))
  const route = useRoute()
  const toastId = useRef(0)

  const applyState = (fresh: FamilyState) => {
    setState(fresh)
    setNow(Date.now())
    setSyncProblem(null)
  }

  const showError = (ex: unknown) => {
    const text = errorText(ex)
    setToast({ id: ++toastId.current, kind: 'error', text: text.title, hint: text.hint, signInAgain: text.signInAgain ? onSignOut : undefined })
  }

  const refresh = async () => {
    try {
      applyState(await connection.refresh())
    } catch (ex) {
      const text = errorText(ex)
      if (text.signInAgain) showError(ex)
      setSyncProblem(text.title)
    }
  }

  useEffect(() => { setToast((current) => current?.kind === 'done' ? null : current) }, [route])

  useEffect(() => {
    void connection.cached().then((cached) => { if (cached.users.data.length > 0) setState(cached) })
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [connection])

  const run = async (work: Work): Promise<boolean> => {
    setPending({ key: work.key, waiting: false })
    const timer = setTimeout(() => setPending({ key: work.key, waiting: true }), WAIT_INDICATOR_DELAY_MS)
    try {
      applyState(await connection.push(work.actions))
      const undo = work.undo
      setToast({
        id: ++toastId.current,
        kind: 'done',
        text: work.done,
        undo: undo && (() => { void runUndo(undo) })
      })
      return true
    } catch (ex) {
      showError(ex)
      return false
    } finally {
      clearTimeout(timer)
      setPending(null)
    }
  }

  const runUndo = async (undo: NonNullable<Work['undo']>) => {
    try {
      const fresh = await connection.refresh()
      await run({ key: 'undo', actions: undo(fresh), done: 'Отменено' })
    } catch (ex) {
      showError(ex)
    }
  }

  if (!state) {
    return (
      <main class='page'>
        <p class='muted'>{syncProblem ? `Не удалось загрузить семью: ${syncProblem}` : 'Загружаем семью…'}</p>
        {syncProblem ? <button type='button' onClick={() => void refresh()}>Повторить</button> : null}
        <button type='button' class='link' onClick={onSignOut}>Выйти</button>
        <Toast toast={toast} close={() => setToast(null)} />
      </main>
    )
  }

  const kids = children(state)
  const child = kids.find((c) => c.id === childId) ?? kids[0]
  if (!child) {
    return (
      <main class='page'>
        <p>В семье нет детей. Добавьте ребёнка в приложении TimeLimit — пульт покажет его сам.</p>
        <button type='button' class='link' onClick={onSignOut}>Выйти</button>
      </main>
    )
  }

  const [requested, argument] = route.split('/')
  const screen = ['bans', 'limits', 'history', 'sites', 'category'].includes(requested) ? requested : ''
  const context: AppContext = { state, child, now, pending, run, showError }
  const signOut = () => {
    if (confirm('Выйти из пульта? Для входа снова понадобится код из письма.')) onSignOut()
  }

  return (
    <App.Provider value={context}>
      <header class='top'>
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
        <button type='button' class='link' onClick={signOut}>Выйти</button>
      </header>
      {syncProblem
        ? <div class='banner'>Не обновилось: {syncProblem}. <button type='button' class='link' onClick={() => void refresh()}>Повторить</button></div>
        : null}
      {state.message ? <div class='banner'>Сообщение сервера: {state.message}</div> : null}
      <main class='page'>
        {screen === '' ? <Home /> : null}
        {screen === 'bans' ? <Bans /> : null}
        {screen === 'limits' ? <Limits /> : null}
        {screen === 'history' ? <History /> : null}
        {screen === 'sites' ? <Sites /> : null}
        {screen === 'category' ? <CategoryDetails categoryId={argument ?? ''} /> : null}
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

void loadWebConfig().then((config) => {
  const container = document.getElementById('app')!
  container.textContent = ''
  render(<Root config={config} api={createApi(config)} />, container)
})
