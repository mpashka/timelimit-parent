import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import type { ParentAction } from '../core/protocol.ts'
import type { FamilyState, User } from '../core/state.ts'

// @tag:parent-console

export const WAIT_INDICATOR_DELAY_MS = 300

export interface Work {
  key: string
  actions: ParentAction[]
  done: string
  undo?: (fresh: FamilyState) => ParentAction[]
}

export interface AppContext {
  state: FamilyState
  child: User
  now: number
  pending: { key: string, waiting: boolean } | null
  run: (work: Work) => Promise<boolean>
  showError: (ex: unknown) => void
}

export const App = createContext<AppContext>(null as unknown as AppContext)
export const useApp = (): AppContext => useContext(App)

/** The host is what tells two servers apart; the scheme and path are the same everywhere. */
export function serverLabel (serverUrl: string): string {
  try {
    return new URL(serverUrl).host
  } catch {
    return serverUrl
  }
}

/** Under whom and where the console acts — the two things a parent cannot check anywhere else. */
export function Account ({ parent, serverUrl }: { parent: User | undefined, serverUrl: string }) {
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
