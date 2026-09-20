import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { type FamilyView, type Person, view } from './api.ts'
import { errorText } from './format.ts'

// @tag:parent-console

export const WAIT_INDICATOR_DELAY_MS = 300

/** What one button means, in the words of the BFF: an intent, and the intent that takes it back. */
export interface IntentCall {
  intent: string
  body?: Record<string, unknown>
}

export interface Work extends IntentCall {
  key: string
  done: string
  /** Gets the freshest data of the open view, because an undo addresses what is there now. */
  undo?: (fresh: unknown) => IntentCall
}

export interface AppContext {
  family: FamilyView
  child: Person
  now: number
  view: unknown
  pending: { key: string, waiting: boolean } | null
  run: (work: Work) => Promise<boolean>
  showError: (ex: unknown) => void
}

export const App = createContext<AppContext>(null as unknown as AppContext)
export const useApp = (): AppContext => useContext(App)

/** The data of the screen's own view; every screen knows which one it asked for. */
export const useScreen = <V, >(): V => useApp().view as V

export interface ViewState<V> {
  data: V | null
  staleSince: number | null
  problem: string | null
  set: (data: V) => void
}

interface Loaded<V> { asked: string, data: V | null, staleSince: number | null, problem: string | null }

const EMPTY = { data: null, staleSince: null, problem: null }

/** Loads one view and reloads it whenever `revision` changes — a `changed` event, or the safety timer. */
export function useView<V> (name: string | null, childId: string | undefined, revision: number, onFailure?: (ex: unknown) => void): ViewState<V> {
  const asked = `${name ?? ''}?${childId ?? ''}`
  const [state, setState] = useState<Loaded<V>>({ asked, ...EMPTY })
  // What is on screen answers the question asked now: a reload keeps the data, a change of screen
  // or of child does not — the previous answer belongs to another question.
  const current = state.asked === asked ? state : { asked, ...EMPTY }
  useEffect(() => {
    if (name === null) return
    let alive = true
    void view<V>(name, childId).then(
      (answer) => { if (alive) setState({ asked, data: answer.data, staleSince: answer.staleSince ?? null, problem: null }) },
      (ex: unknown) => {
        if (!alive) return
        setState((previous) => ({ ...(previous.asked === asked ? previous : { asked, ...EMPTY }), problem: errorText(ex).title }))
        onFailure?.(ex)
      }
    )
    return () => { alive = false }
  }, [name, childId, revision])
  return { data: current.data, staleSince: current.staleSince, problem: current.problem, set: (data: V) => setState({ asked, data, staleSince: null, problem: null }) }
}

/** The host is what tells two servers apart; the scheme and path are the same everywhere. */
export function serverLabel (serverUrl: string): string {
  try {
    return new URL(serverUrl).host
  } catch {
    return serverUrl
  }
}

/** Under whom and where the console acts — the two things a parent cannot check anywhere else. */
export function Account ({ parent, serverUrl }: { parent: Person | undefined, serverUrl: string }) {
  return (
    <div class='muted small account'>
      {parent
        ? <span>{parent.name}{parent.mail ? ` · ${parent.mail}` : ''}</span>
        : <span>под кем вход — неизвестно, войдите заново</span>}
      {' · '}
      <span>{serverLabel(serverUrl)}</span>
    </div>
  )
}

/** Immediate pressed state; the wait indicator only if the work outlives WAIT_INDICATOR_DELAY_MS. */
export function useBusy (): [phase: 'idle' | 'pressed' | 'waiting', wrap: (work: () => Promise<void>) => Promise<void>] {
  const [phase, setPhase] = useState<'idle' | 'pressed' | 'waiting'>('idle')
  const wrap = async (work: () => Promise<void>) => {
    setPhase('pressed')
    const timer = setTimeout(() => setPhase('waiting'), WAIT_INDICATOR_DELAY_MS)
    try {
      await work()
    } finally {
      clearTimeout(timer)
      setPhase('idle')
    }
  }
  return [phase, wrap]
}

export function ActionButton ({ work, class: className = '', children, disabled }: {
  work: () => Work, class?: string, children: ComponentChildren, disabled?: boolean
}) {
  const { pending, run, showError } = useApp()
  const [key, setKey] = useState<string | null>(null)
  const mine = pending !== null && pending.key === key
  return (
    <button
      type='button'
      class={`${className} ${mine ? 'pressed' : ''}`}
      disabled={disabled || mine}
      aria-busy={mine && pending.waiting}
      onClick={() => {
        let item: Work
        try {
          item = work()
        } catch (ex) {
          showError(ex)
          return
        }
        setKey(item.key)
        void run(item)
      }}
    >
      {mine && pending.waiting ? <span class='spinner' aria-hidden='true' /> : null}
      {children}
    </button>
  )
}

/** Submits its form, or runs `onClick` when used outside of one. */
export function SubmitButton ({ phase, children, disabled, onClick }: { phase: 'idle' | 'pressed' | 'waiting', children: ComponentChildren, disabled?: boolean, onClick?: () => void }) {
  return (
    <button type={onClick ? 'button' : 'submit'} onClick={onClick} class={`primary ${phase !== 'idle' ? 'pressed' : ''}`} disabled={disabled || phase !== 'idle'}>
      {phase === 'waiting' ? <span class='spinner' aria-hidden='true' /> : null}
      {children}
    </button>
  )
}

export interface ToastMessage {
  id: number
  text: string
  hint?: string
  kind: 'done' | 'error'
  undo?: () => void
  signInAgain?: () => void
}

const TOAST_MS = 8000

export function Toast ({ toast, close }: { toast: ToastMessage | null, close: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(timer.current)
    if (toast?.kind === 'done') timer.current = setTimeout(close, TOAST_MS)
    return () => clearTimeout(timer.current)
  }, [toast?.id])
  if (!toast) return null
  return (
    <div class={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <div class='toast-text'>
        <div>{toast.text}</div>
        {toast.hint ? <div class='muted'>{toast.hint}</div> : null}
      </div>
      {toast.undo ? <button type='button' class='link' onClick={() => { close(); toast.undo!() }}>Отменить</button> : null}
      {toast.signInAgain ? <button type='button' class='link' onClick={toast.signInAgain}>Войти заново</button> : null}
      <button type='button' class='link close' aria-label='Закрыть' onClick={close}>✕</button>
    </div>
  )
}
