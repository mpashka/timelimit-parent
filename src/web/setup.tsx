import { useEffect, useMemo, useState } from 'preact/hooks'
import { renderSVG } from 'uqr'
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

export function PasswordField ({ value, onInput, optional = false }: { value: string, onInput: (value: string) => void, optional?: boolean }) {
  const [shown, setShown] = useState(false)
  const ok = value.length >= PARENT_PASSWORD_MIN_LENGTH
  return (
    <>
      <label>Пароль родителя{optional ? ' — можно не задавать' : ''}
        <input type={shown ? 'text' : 'password'} autocomplete='new-password' required={!optional} minLength={PARENT_PASSWORD_MIN_LENGTH}
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

// @tag:family-join-qr
function DeviceCodeQr ({ code }: { code: string }) {
  const svg = useMemo(() => renderSVG(code, { border: 4 }), [code])
  return <div class='device-qr' role='img' aria-label='QR с кодом для детского устройства' dangerouslySetInnerHTML={{ __html: svg }} />
}

type TokenState = { name: 'loading' } | { name: 'failed', error: ErrorText } | { name: 'shown', token: AddDeviceToken, expiresAt: number }

export function AddDevice () {
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
            <DeviceCodeQr code={token.token.token} />
            <p class='device-code' aria-label='Код для детского устройства'>{token.token.token}</p>
            <p class='muted small'>Код действует ещё {formatCountdown(token.expiresAt - now)} и только один раз. Новый код отменяет этот.</p>
            <ol class='steps'>
              <li>Установите TimeLimit на детское устройство и откройте.</li>
              <li>«connected mode» → «Code from another TimeLimit installation».</li>
              <li>«Scan code» и наведите камеру на QR — или введите слова кода, регистр не важен.</li>
            </ol>
            <p class='muted small'>Эта страница сама покажет, когда устройство подключится.</p>
          </>
          )
        : null}
      {joined ? null : <ChildGoogleAccount />}
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

/**
 * The linked address is what lets the child's own Google account bring a tablet into this family
 * without any code; the server keeps one address to one child, so a stranger's family cannot take it.
 */
// @tag:family-join-google
function ChildGoogleAccount () {
  const { child, role, run } = useApp()
  const linked = child.childMail ?? ''
  const [mail, setMail] = useState(linked)
  const [phase, wrap] = useBusy()
  useEffect(() => setMail(linked), [linked])
  const save = (next: string | null, done: string) => wrap(async () => {
    await run({ key: 'child-mail', intent: 'child-mail', body: { mail: next }, done, undo: () => ({ intent: 'child-mail', body: { mail: linked || null } }) })
  })
  return (
    <div class='child-google'>
      <h3>Или вход Google-аккаунтом ребёнка</h3>
      {linked
        ? <p>На детском устройстве: «connected mode» → «Code from another TimeLimit installation» → «Sign in with Google», войти аккаунтом <b>{linked}</b> и нажать «Согласен». Выбирать ребёнка на устройстве не придётся: оно подключится сразу как «{child.name}».</p>
        : <p class='muted small'>Без кода: родитель один раз пишет здесь Google-адрес ребёнка, а на планшете ребёнок входит этим аккаунтом. Один адрес — один ребёнок на этом сервере.</p>}
      {role === 'admin'
        ? (
          <form onSubmit={(event) => {
            event.preventDefault()
            void save(mail.trim(), `Аккаунт ${mail.trim()} привязан к ${child.name}`)
          }}>
            <label>Google-адрес ребёнка
              <input type='email' autocomplete='off' required value={mail} onInput={(e) => setMail(e.currentTarget.value)} />
            </label>
            <div class='row'>
              <SubmitButton phase={phase}>{linked ? 'Сменить адрес' : 'Привязать'}</SubmitButton>
              {linked ? <button type='button' class='link' onClick={() => void save(null, `Аккаунт ${linked} отвязан от ${child.name}`)}>Отвязать</button> : null}
            </div>
          </form>
          )
        : <p class='muted small'>Привязать или сменить адрес может администратор семьи.</p>}
    </div>
  )
}
