import { useEffect, useRef, useState } from 'preact/hooks'
import type { TimelimitApi } from '../core/api.ts'
import type { SignInResult } from '../core/api.ts'
import { hashParentPassword } from '../core/password.ts'
import { createEmptyState, mergeServerStatus } from '../core/state.ts'
import { errorText, type ErrorText } from './format.ts'
import { browserTimeZone, ErrorBox, PasswordField } from './setup.tsx'
import { type Auth, clearLocal, localStore, writeLocal } from './store.ts'
import { SubmitButton, useBusy } from './ui.tsx'

// @tag:parent-console

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize (options: { client_id: string, callback: (response: { credential: string }) => void }): void
          renderButton (element: HTMLElement, options: Record<string, string>): void
        }
      }
    }
  }
}

type Step =
  | { name: 'mail' }
  | { name: 'code', mail: string, mailLoginToken: string }
  | { name: 'device', mailAuthToken: string }
  | { name: 'create', mailAuthToken: string, mail: string }
  | { name: 'closed', mail: string }

const defaultDeviceName = (): string => {
  const agent = navigator.userAgent
  const model = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : 'браузер'
  return `Пульт — ${model}`
}

export function SignIn ({ api, googleClientId, onSignedIn }: { api: TimelimitApi, googleClientId?: string, onSignedIn: (auth: Auth) => void }) {
  const [step, setStep] = useState<Step>({ name: 'mail' })
  const [error, setError] = useState<ErrorText | null>(null)
  const [phase, wrap] = useBusy()
  const [mail, setMail] = useState('')
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState(defaultDeviceName())
  const [parentName, setParentName] = useState('')
  const [password, setPassword] = useState('')

  /** A mail without a family goes to family creation, so a new parent never meets "no family uses this mail". */
  const afterMailAuth = async (mailAuthToken: string) => {
    const status = await api.getStatusByMailAuthToken({ mailAuthToken })
    if (status.status === 'with family') setStep({ name: 'device', mailAuthToken })
    else if (status.canCreateFamily) setStep({ name: 'create', mailAuthToken, mail: status.mail })
    else setStep({ name: 'closed', mail: status.mail })
  }

  const finish = async (result: SignInResult) => {
    clearLocal()
    writeLocal('auth', JSON.stringify({ deviceAuthToken: result.deviceAuthToken, ownDeviceId: result.ownDeviceId }))
    await localStore.set('state', JSON.stringify(mergeServerStatus(createEmptyState(), result.data)))
    onSignedIn({ deviceAuthToken: result.deviceAuthToken, ownDeviceId: result.ownDeviceId })
  }

  const restart = () => { setError(null); setCode(''); setStep({ name: 'mail' }) }

  const attempt = (work: () => Promise<void>) => (event: Event) => {
    event.preventDefault()
    setError(null)
    void wrap(async () => {
      try {
        await work()
      } catch (ex) {
        setError(errorText(ex))
      }
    })
  }

  const onGoogle = (idToken: string) => {
    setError(null)
    void wrap(async () => {
      try {
        await afterMailAuth(await api.signInByGoogle({ idToken, locale: 'ru' }))
      } catch (ex) {
        setError(errorText(ex))
      }
    })
  }

  return (
    <main class='page signin'>
      <h1>Пульт TimeLimit</h1>
      {step.name === 'mail'
        ? (
          <>
            <form onSubmit={attempt(async () => {
              const mailLoginToken = await api.sendMailLoginCode({ mail: mail.trim(), locale: 'ru' })
              setStep({ name: 'code', mail: mail.trim(), mailLoginToken })
            })}>
              <label>Почта родителя
                <input type='email' autocomplete='email' required value={mail} onInput={(e) => setMail(e.currentTarget.value)} />
              </label>
              <SubmitButton phase={phase}>Прислать код</SubmitButton>
            </form>
            {googleClientId ? <GoogleButton clientId={googleClientId} onCredential={onGoogle} /> : null}
          </>
          )
        : null}
      {step.name === 'code'
        ? (
          <form onSubmit={attempt(async () => {
            await afterMailAuth(await api.signInByMailCode({ mailLoginToken: step.mailLoginToken, receivedCode: code.trim() }))
          })}>
            <label>Код из письма на {step.mail} — три слова
              <input autocapitalize='off' autocomplete='one-time-code' autocorrect='off' spellcheck={false} required value={code} onInput={(e) => setCode(e.currentTarget.value)} />
            </label>
            <SubmitButton phase={phase}>Дальше</SubmitButton>
            <button type='button' class='link' onClick={restart}>Другая почта</button>
          </form>
          )
        : null}
      {step.name === 'device'
        ? (
          <form onSubmit={attempt(async () => {
            await finish(await api.signInIntoFamily({ mailAuthToken: step.mailAuthToken, deviceName: deviceName.trim() || defaultDeviceName() }))
          })}>
            <label>Как назвать пульт в списке устройств семьи
              <input required maxLength={50} value={deviceName} onInput={(e) => setDeviceName(e.currentTarget.value)} />
            </label>
            <SubmitButton phase={phase}>Войти</SubmitButton>
            <button type='button' class='link' onClick={restart}>Начать заново</button>
          </form>
          )
        : null}
      {step.name === 'create'
        ? (
          <form onSubmit={attempt(async () => {
            await finish(await api.createFamily({
              mailAuthToken: step.mailAuthToken,
              password: await hashParentPassword(password),
              parentName: parentName.trim(),
              deviceName: deviceName.trim() || defaultDeviceName(),
              timeZone: browserTimeZone()
            }))
          })}>
            <p>На {step.mail} семьи ещё нет — создадим.</p>
            <label>Ваше имя
              <input required maxLength={50} autocomplete='given-name' value={parentName} onInput={(e) => setParentName(e.currentTarget.value)} />
            </label>
            <PasswordField value={password} onInput={setPassword} />
            <label>Как назвать пульт в списке устройств семьи
              <input required maxLength={50} value={deviceName} onInput={(e) => setDeviceName(e.currentTarget.value)} />
            </label>
            <SubmitButton phase={phase}>Создать семью</SubmitButton>
            <button type='button' class='link' onClick={restart}>Другая почта</button>
          </form>
          )
        : null}
      {step.name === 'closed'
        ? (
          <>
            <p>На {step.mail} семьи нет, а создавать новые семьи этот сервер не разрешает.</p>
            <button type='button' class='link' onClick={restart}>Другая почта</button>
          </>
          )
        : null}
      <ErrorBox error={error} />
      <p class='muted small'>Нет семьи — пульт создаст её. Есть — войдёт в неё ещё одним устройством родителя, без пароля. Выход — кнопка «Выйти» наверху.</p>
      <p class='muted small'>timelimit-parent, AGPL-3.0.</p>
    </main>
  )
}

function GoogleButton ({ clientId, onCredential }: { clientId: string, onCredential: (idToken: string) => void }) {
  const target = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const show = () => {
      window.google!.accounts.id.initialize({ client_id: clientId, callback: (response) => onCredential(response.credential) })
      window.google!.accounts.id.renderButton(target.current!, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ru' })
    }
    if (window.google) return show()
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = show
    script.onerror = () => setFailed(true)
    document.head.appendChild(script)
  }, [clientId])
  return (
    <div class='google'>
      <div ref={target} />
      {failed ? <div class='muted small'>Кнопка Google не загрузилась — проверьте сеть или войдите по коду из письма.</div> : null}
    </div>
  )
}
