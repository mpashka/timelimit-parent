import { useEffect, useState } from 'preact/hooks'
import { type AddDeviceToken, createAddDeviceToken } from './api.ts'
import { errorText, type ErrorText, formatCountdown } from './format.ts'
import { SubmitButton, useApp, useBusy, type Work } from './ui.tsx'

// @tag:parent-console

/** `PasswordValidator.MINIMAL_CHAR_AMOUNT` of the child's device; the BFF checks it again. */
export const PARENT_PASSWORD_MIN_LENGTH = 2

/** The server drops an unused add-device token after three hours. */
const TOKEN_LIFETIME_MS = 3 * 60 * 60 * 1000

export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function ErrorBox ({ error }: { error: ErrorText | null }) {
  return error
    ? <div class='error' role='alert'><div>{error.title}</div>{error.hint ? <div class='muted'>{error.hint}</div> : null}</div>
    : null
}

export function PasswordField ({ value, onInput }: { value: string, onInput: (value: string) => void }) {
  const [shown, setShown] = useState(false)
  const ok = value.length >= PARENT_PASSWORD_MIN_LENGTH
  return (
    <>
      <label>Пароль родителя
        <input type={shown ? 'text' : 'password'} autocomplete='new-password' required minLength={PARENT_PASSWORD_MIN_LENGTH}
          value={value} onInput={(e) => onInput(e.currentTarget.value)} />
      </label>
      <div class='row small'>
        <span class={ok ? '' : 'muted'}>{ok ? '✓ ' : ''}не короче {PARENT_PASSWORD_MIN_LENGTH} символов; длиннее — надёжнее, ребёнок может подсмотреть</span>
        <button type='button' class='link small' aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'скрыть' : 'показать'}</button>
      </div>
      <p class='muted small'>Пароль открывает режим родителя на самом детском устройстве — чтобы поменять настройки, взяв его в руки. Для входа в веб-админку он не нужен.</p>
    </>
  )
}

/** Shown instead of the console while the family has no child: the child's device needs one to be assigned to. */
export function AddChildForm ({ run }: { run: (work: Work) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [phase, wrap] = useBusy()
  return (
    <form onSubmit={(event) => {
      event.preventDefault()
      void wrap(async () => {
        await run({ key: 'add-child', intent: 'child-add', body: { name, timeZone: browserTimeZone() }, done: `Ребёнок «${name.trim()}» добавлен` })
      })
    }}>
      <h1>Кого ограничиваем?</h1>
      <label>Имя ребёнка
        <input required maxLength={50} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <p class='muted small'>Появятся категории «Разрешено» и «Игры»; часовой пояс — {browserTimeZone()}. Потом на детском устройстве выберете этого ребёнка.</p>
      <SubmitButton phase={phase}>Добавить ребёнка</SubmitButton>
    </form>
  )
}

type TokenState = { name: 'loading' } | { name: 'failed', error: ErrorText } | { name: 'shown', token: AddDeviceToken, expiresAt: number }

export function AddDevice ({ serverUrl }: { serverUrl: string }) {
  const { family, child } = useApp()
  const [token, setToken] = useState<TokenState>({ name: 'loading' })
  const [now, setNow] = useState(Date.now())
  const [phase, wrap] = useBusy()

  const request = () => wrap(async () => {
    try {
      const created = await createAddDeviceToken()
      setToken({ name: 'shown', token: created, expiresAt: Date.now() + TOKEN_LIFETIME_MS })
    } catch (ex) {
      setToken({ name: 'failed', error: errorText(ex) })
    }
  })

  useEffect(() => { void request() }, [])
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [])

  const joined = token.name === 'shown' ? family.devices.find((d) => d.deviceId === token.token.deviceId) : undefined
  const expired = token.name === 'shown' && now >= token.expiresAt

  return (
    <section class='card add-device'>
      <div class='row'>
        <h2>Новое устройство: {child.name}</h2>
        <a href='#/'>Назад</a>
      </div>
      {token.name === 'loading'
        ? <p class='muted'>{phase === 'waiting' ? 'Получаем код…' : ' '}</p>
        : null}
      {token.name === 'failed'
        ? (
          <>
            <ErrorBox error={token.error} />
            <SubmitButton phase={phase} onClick={() => void request()}>Попробовать ещё раз</SubmitButton>
          </>
          )
        : null}
      {joined
        ? (
          <>
            <p><b>Устройство «{joined.name}» подключено.</b></p>
            <p>На нём TimeLimit спросит, кто им пользуется, — выберите «{child.name}».</p>
            <button type='button' class='primary wide' onClick={() => { location.hash = '#/' }}>Готово</button>
          </>
          )
        : null}
      {token.name === 'shown' && !joined && !expired
        ? (
          <>
            <p class='device-code' aria-label='Код для детского устройства'>{token.token.token}</p>
            <p class='muted small'>Код действует ещё {formatCountdown(token.expiresAt - now)} и только один раз. Новый код отменяет этот.</p>
            <ol class='steps'>
              <li>Установите TimeLimit на детское устройство и откройте.</li>
              <li>На первом экране — «select custom server», адрес <code>{serverUrl}</code>.</li>
              <li>«connected mode» → «Code from another TimeLimit installation».</li>
              <li>Введите слова кода — регистр не важен.</li>
            </ol>
            <p class='muted small'>Эта страница сама покажет, когда устройство подключится.</p>
          </>
          )
        : null}
      {expired && !joined
        ? (
          <>
            <p>Код истёк.</p>
            <SubmitButton phase={phase} onClick={() => void request()}>Новый код</SubmitButton>
          </>
          )
        : null}
    </section>
  )
}
