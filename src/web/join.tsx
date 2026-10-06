import { useState } from 'preact/hooks'
import { join } from './api.ts'
import { BffError, errorText, type ErrorText } from './format.ts'
import { ErrorBox } from './setup.tsx'
import { GoogleButton } from './signin.tsx'
import { SubmitButton, useBusy } from './ui.tsx'

// @tag:family-join-google

/** What the tablet makes up (`SetupRemoteChildViewModel`) and the sync server accepts in `/auth/join`. */
const REGISTER_TOKEN = /^[a-z0-9]{20,64}$/

type Step =
  | { name: 'signin' }
  | { name: 'ask', idToken: string, familyName: string, childName: string }
  | { name: 'done', familyName: string, childName: string, confirmCode?: string }

/** The failures a child meets here, in words of what to do — the console's wording speaks to a parent. */
function joinErrorText (ex: unknown): ErrorText {
  if (ex instanceof BffError) {
    const { kind, title } = ex.failure
    if (/not linked/.test(title)) return { title: 'Этот аккаунт Google не привязан ни к одному ребёнку', hint: 'Попросите родителя вписать его адрес в веб-админке: ребёнок → «Новое устройство» → «Google-адрес ребёнка». Или войдите другим аккаунтом.', signInAgain: false }
    if (/already used/.test(title)) return { title: 'Этот вход уже использован', hint: 'Вернитесь в TimeLimit и нажмите «Sign in with Google» ещё раз.', signInAgain: false }
    if (kind === 'mail-auth-expired') return { title: 'Google не подтвердил вход', hint: 'Нажмите кнопку Google ещё раз.', signInAgain: false }
  }
  return errorText(ex)
}

export function JoinPage ({ code, googleClientId }: { code: string, googleClientId?: string }) {
  const [step, setStep] = useState<Step>({ name: 'signin' })
  const [error, setError] = useState<ErrorText | null>(null)
  const [phase, wrap] = useBusy()

  const attempt = (work: () => Promise<void>) => {
    setError(null)
    void wrap(async () => {
      try {
        await work()
      } catch (ex) {
        setError(joinErrorText(ex))
        setStep({ name: 'signin' })
      }
    })
  }

  if (!REGISTER_TOKEN.test(code)) {
    return (
      <main class='page signin'>
        <h1>Подключение к семье</h1>
        <p>Эту страницу открывает TimeLimit на детском устройстве — по кнопке «Sign in with Google» в мастере подключения. Откройте её оттуда.</p>
      </main>
    )
  }

  return (
    <main class='page signin'>
      <h1>Подключение к семье</h1>
      {step.name === 'signin'
        ? (
          <>
            <p>Войдите Google-аккаунтом ребёнка — тем, который родитель вписал в веб-админке.</p>
            {googleClientId
              ? <GoogleButton clientId={googleClientId} onCredential={(idToken) => attempt(async () => {
                const { familyName, childName } = await join.preview(idToken)
                setStep({ name: 'ask', idToken, familyName, childName })
              })} />
              : <p class='error'>На этом сервере вход Google выключен — подключите устройство кодом или QR из веб-админки.</p>}
          </>
          )
        : null}
      {step.name === 'ask'
        ? (
          <>
            <p>Присоединить это устройство к семье <b>{step.familyName || 'без названия'}</b> как <b>{step.childName}</b>?</p>
            <p class='muted small'>Родители этой семьи будут видеть, чем занято устройство, и ограничивать время.</p>
            <SubmitButton phase={phase} onClick={() => attempt(async () => {
              const { confirmCode } = await join.confirm(step.idToken, code)
              setStep({ name: 'done', familyName: step.familyName, childName: step.childName, confirmCode })
            })}>Согласен</SubmitButton>
            <button type='button' class='link' onClick={() => setStep({ name: 'signin' })}>Не согласен</button>
          </>
          )
        : null}
      {step.name === 'done'
        ? step.confirmCode // @tag:family-join-link
          ? (
            <>
              <p>Назовите код администратору семьи:</p>
              <p class='big-code'>{step.confirmCode}</p>
              <p>Когда он введёт его в веб-админке, вернитесь в TimeLimit — он сам закончит подключение.</p>
            </>
            )
          : <p><b>Готово.</b> Вернитесь в TimeLimit — он сам продолжит подключение и будет считать время {step.childName}.</p>
        : null}
      <ErrorBox error={error} />
    </main>
  )
}
