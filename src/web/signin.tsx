import { useEffect, useRef, useState } from 'preact/hooks'
import type { TimelimitApi } from '../core/api.ts'
import { createEmptyState, mergeServerStatus } from '../core/state.ts'
import { errorText, type ErrorText } from './format.ts'
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

type Step = { name: 'mail' } | { name: 'code', mail: string, mailLoginToken: string } | { name: 'device', mailAuthToken: string }

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
        setStep({ name: 'device', mailAuthToken: await api.signInByGoogle({ idToken, locale: 'ru' }) })
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
              <label>Почта, на которую создана семья
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
            setStep({ name: 'device', mailAuthToken: await api.signInByMailCode({ mailLoginToken: step.mailLoginToken, receivedCode: code.trim() }) })
          })}>
            <label>Код из письма на {step.mail}
              <input inputMode='numeric' autocomplete='one-time-code' required value={code} onInput={(e) => setCode(e.currentTarget.value)} />
            </label>
            <SubmitButton phase={phase}>Дальше</SubmitButton>
            <button type='button' class='link' onClick={() => { setError(null); setCode(''); setStep({ name: 'mail' }) }}>Другая почта</button>
          </form>
          )
        : null}
      {step.name === 'device'
        ? (
          <form onSubmit={attempt(async () => {
            const result = await api.signInIntoFamily({ mailAuthToken: step.mailAuthToken, deviceName: deviceName.trim() || defaultDeviceName() })
            clearLocal()
            writeLocal('auth', JSON.stringify({ deviceAuthToken: result.deviceAuthToken, ownDeviceId: result.ownDeviceId }))
            await localStore.set('state', JSON.stringify(mergeServerStatus(createEmptyState(), result.data)))
            onSignedIn({ deviceAuthToken: result.deviceAuthToken, ownDeviceId: result.ownDeviceId })
          })}>
            <label>Как назвать пульт в списке устройств семьи
              <input required maxLength={50} value={deviceName} onInput={(e) => setDeviceName(e.currentTarget.value)} />
            </label>
            <SubmitButton phase={phase}>Войти</SubmitButton>
            <button type='button' class='link' onClick={() => { setError(null); setStep({ name: 'mail' }) }}>Начать заново</button>
          </form>
          )
        : null}
      {error
        ? <div class='error' role='alert'><div>{error.title}</div>{error.hint ? <div class='muted'>{error.hint}</div> : null}</div>
        : null}
      <p class='muted small'>Пульт входит в семью как ещё одно устройство родителя; пароль родителя не нужен. Выход — кнопка «Выйти» наверху.</p>
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
