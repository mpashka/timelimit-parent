import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import type { AdultRole } from '../shared/adult-role.ts'
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

export interface FamilyContext {
  family: FamilyView
  now: number
  view: unknown
  pending: { key: string, waiting: boolean } | null
  run: (work: Work) => Promise<boolean>
  showError: (ex: unknown) => void
  /** A member only looks: the stylesheet hides `.act` and forms under `body.read-only`. @tag:adult-role */
  role: AdultRole
}

export interface AppContext extends FamilyContext {
  child: Person
}

/** «Семья» works in a family with no children yet; every other screen is about a child. */
export const App = createContext<FamilyContext & { child?: Person }>(null as unknown as AppContext)
export const useFamily = (): FamilyContext => useContext(App)
export const useApp = (): AppContext => {
  const context = useContext(App)
  if (context.child === undefined) throw new Error('this screen needs a child')
  return { ...context, child: context.child }
}

export const useScreen = <V, >(): V => useFamily().view as V

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

function useWork (): [mine: boolean, waiting: boolean, start: (work: () => Work) => void] {
  const { pending, run, showError } = useFamily()
  const [key, setKey] = useState<string | null>(null)
  const mine = pending !== null && pending.key === key
  const start = (work: () => Work) => {
    let item: Work
    try {
      item = work()
    } catch (ex) {
      showError(ex)
      return
    }
    setKey(item.key)
    void run(item)
  }
  return [mine, mine && pending.waiting, start]
}

export function ActionButton ({ work, class: className = '', children, disabled }: {
  work: () => Work, class?: string, children: ComponentChildren, disabled?: boolean
}) {
  const [mine, waiting, start] = useWork()
  return (
    <button
      type='button'
      class={`act ${className} ${mine ? 'pressed' : ''}`}
      disabled={disabled || mine}
      aria-busy={waiting}
      onClick={() => start(work)}
    >
      {waiting ? <span class='spinner' aria-hidden='true' /> : null}
      {children}
    </button>
  )
}

/** An on/off setting: the state shown is the one on the server until the work is done. */
export function Switch ({ on, work, children }: { on: boolean, work: () => Work, children: ComponentChildren }) {
  const [mine, waiting, start] = useWork()
  return (
    <label class={`switch ${mine ? 'pressed' : ''}`}>
      <span class='grow'>{children}</span>
      {waiting ? <span class='spinner' aria-hidden='true' /> : null}
      <input type='checkbox' role='switch' checked={on} disabled={mine} aria-busy={waiting} onChange={(event) => {
        event.currentTarget.checked = on
        start(work)
      }} />
    </label>
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

/**
 * The one menu of actions on a row — app, category or tablet alike: a visible ⋮, a popup at the
 * button in a browser and a sheet from the bottom on a phone. Any button or link inside closes it.
 */
export function RowMenu ({ title, subtitle, children, class: className = '' }: { title: string, subtitle?: string, children: ComponentChildren, class?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open])
  return (
    <span class={`row-menu ${className}`}>
      <button type='button' class={`more ${open ? 'on' : ''}`} aria-label={`Действия: ${title}`} aria-expanded={open} onClick={() => setOpen(!open)}>⋮</button>
      {open
        ? (
          <>
            <div class='scrim menu-scrim' onClick={() => setOpen(false)} />
            <div class='menu-sheet' role='menu' onClick={(event) => { if ((event.target as HTMLElement).closest('button, a')) setOpen(false) }}>
              <div class='menu-head'><b>{title}</b>{subtitle ? <div class='muted small'>{subtitle}</div> : null}</div>
              {children}
            </div>
          </>
          )
        : null}
    </span>
  )
}

/** Explains itself in one line; the «?» unfolds why it exists and when it is worth the extra step. */
// @tag:family-join-link
export function ConfirmByCodeOption ({ checked, onChange }: { checked: boolean, onChange: (checked: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div class='confirm-by-code'>
      <label class='check'>
        <input type='checkbox' checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
        <span>Дополнительно подтвердить вход кодом <span class='muted small'>— войдёт тот, кто назовёт вам четыре цифры</span></span>
        <button type='button' class='help' aria-expanded={open} aria-label='Подробнее' onClick={() => setOpen(!open)}>?</button>
      </label>
      {open
        ? (
          <p class='muted small'>
            Ссылку или адрес можно переслать, а аккаунтом Google может войти не тот, кого вы ждёте. С галочкой
            согласие не открывает вход сразу: на экране приглашённого — или на планшете ребёнка — появятся четыре
            цифры, и вход случится, только когда вы введёте их здесь. Нужна, когда приглашаете на расстоянии;
            если устройство у вас в руках и вы сканируете QR, она лишняя.
          </p>
          )
        : null}
    </div>
  )
}

/** Four digits the invited screen shows; entering them here lets that person or tablet in. */
// @tag:family-join-link
export function ConfirmCodeForm ({ label, work }: { label: string, work: (code: string) => Work }) {
  const { run } = useFamily()
  const [code, setCode] = useState('')
  const [phase, wrap] = useBusy()
  const ready = /^[0-9]{4}$/.test(code.trim())
  return (
    <form class='row confirm-code' onSubmit={(event) => {
      event.preventDefault()
      if (!ready) return
      void wrap(async () => { if (await run(work(code.trim()))) setCode('') })
    }}>
      <label class='grow'>{label}
        <input inputMode='numeric' autocomplete='one-time-code' maxLength={4} pattern='[0-9]{4}' value={code} onInput={(event) => setCode(event.currentTarget.value)} />
      </label>
      <SubmitButton phase={phase} disabled={!ready}>Подтвердить</SubmitButton>
    </form>
  )
}
