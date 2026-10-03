import { useEffect, useRef, useState } from 'preact/hooks'
import { ROLE_DESCRIPTIONS, ROLE_TITLES } from '../shared/adult-role.ts'
import { apiBase, type MailStatus, signIn } from './api.ts'
import { errorText, type ErrorText } from './format.ts'
import { browserTimeZone, ErrorBox, PasswordField } from './setup.tsx'
import { serverLabel, SubmitButton, useBusy } from './ui.tsx'

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
  | { name: 'create', mailAuthToken: string, mail: string }
  | { name: 'invited', mailAuthToken: string, mail: string, invitation: NonNullable<MailStatus['invitation']>, ownFamily: MailStatus['ownFamily'], canCreateFamily: boolean }
  | { name: 'closed', mail: string }

export function SignIn ({ googleClientId, onSignedIn }: { googleClientId?: string, onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>({ name: 'mail' })
  const [error, setError] = useState<ErrorText | null>(null)
  const [phase, wrap] = useBusy()
  const [mail, setMail] = useState('')
  const [code, setCode] = useState('')
  const [parentName, setParentName] = useState('')
  const [password, setPassword] = useState('')

  /**
   * Confirming the mail is the sign-in: the family is entered right away, without a second button
   * that repeats the word the person has already pressed. A mail without a family goes to family
   * creation, so a new parent never meets "no family uses this mail".
   */
  // @tag:parent-invitation @tag:adult-role
  const afterMailAuth = async (mailAuthToken: string, givenName = '') => {
    const status = await signIn.mailStatus(mailAuthToken)
    if (status.invitation) {
      setParentName(givenName)
      setStep({ name: 'invited', mailAuthToken, mail: status.mail, invitation: status.invitation, ownFamily: status.ownFamily, canCreateFamily: status.canCreateFamily })
    } else if (status.status === 'with family') {
      await signIn.session(mailAuthToken)
      onSignedIn()
    } else if (status.canCreateFamily) {
      setParentName(givenName)
      setStep({ name: 'create', mailAuthToken, mail: status.mail })
    }
    else setStep({ name: 'closed', mail: status.mail })
  }

  const restart = () => { setError(null); setCode(''); setStep({ name: 'mail' }) }

  /** A dead mail confirmation leaves nothing that can work on the current step, so the form returns to its start. */
  const failed = (ex: unknown) => {
    const text = errorText(ex)
    if (text.signInAgain) { setCode(''); setStep({ name: 'mail' }) }
    setError(text)
  }

  const attempt = (work: () => Promise<void>) => (event: Event) => {
    event.preventDefault()
    setError(null)
    void wrap(async () => {
      try {
        await work()
      } catch (ex) {
        failed(ex)
      }
    })
  }

  const onGoogle = (idToken: string) => {
    setError(null)
    void wrap(async () => {
      try {
        const { mailAuthToken, givenName } = await signIn.byGoogle(idToken)
        await afterMailAuth(mailAuthToken, givenName)
      } catch (ex) {
        failed(ex)
      }
    })
  }

  return (
    <main class='page signin'>
      <h1>TimeLimit Control</h1>
      <p class='muted small account'>Веб-админка {serverLabel(apiBase())}</p>
      {step.name === 'mail'
        ? (
          <>
            <form onSubmit={attempt(async () => {
              const { mailLoginToken } = await signIn.mailCode(mail.trim())
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
            const { mailAuthToken } = await signIn.byMailCode(step.mailLoginToken, code.trim())
            await afterMailAuth(mailAuthToken)
          })}>
            <label>Код из письма на {step.mail} — три слова
              <input autocapitalize='off' autocomplete='one-time-code' autocorrect='off' spellcheck={false} required value={code} onInput={(e) => setCode(e.currentTarget.value)} />
            </label>
            <SubmitButton phase={phase}>Открыть веб-админку</SubmitButton>
            <button type='button' class='link' onClick={restart}>Другая почта</button>
          </form>
          )
        : null}
      {step.name === 'create'
        ? (
          <form onSubmit={attempt(async () => {
            await signIn.createFamily({
              mailAuthToken: step.mailAuthToken,
              password,
              parentName: parentName.trim(),
              timeZone: browserTimeZone()
            })
            onSignedIn()
          })}>
            <p>На {step.mail} семьи ещё нет — создадим.</p>
            <label>Ваше имя
              <input required maxLength={50} autocomplete='given-name' value={parentName} onInput={(e) => setParentName(e.currentTarget.value)} />
            </label>
            <PasswordField value={password} onInput={setPassword} />
            <SubmitButton phase={phase}>Создать семью</SubmitButton>
            <button type='button' class='link' onClick={restart}>Другая почта</button>
          </form>
          )
        : null}
      {step.name === 'invited' ? <Invited step={step} parentName={parentName} setParentName={setParentName} password={password} setPassword={setPassword} phase={phase} attempt={attempt} onSignedIn={onSignedIn} setStep={setStep} /> : null}
      {step.name === 'closed'
        ? (
          <>
            <p>На {step.mail} семьи нет, а создавать новые семьи этот сервер не разрешает.</p>
            <button type='button' class='link' onClick={restart}>Другая почта</button>
          </>
          )
        : null}
      <ErrorBox error={error} />
      <p class='muted small'>Нет семьи — веб-админка создаст её. Есть — войдёт в неё под вами: устройством семьи веб-админка не становится, пароль родителя для входа не нужен. Выход — кнопка «Выйти» наверху.</p>
      <p class='muted small'>timelimit-parent, AGPL-3.0.</p>
    </main>
  )
}

/**
 * A person who already has a family of their own decides here: an empty one goes away by itself on
 * joining, a non-empty one has to be deleted or left in their own console first — nothing is deleted
 * from inside an invitation (rule UX core 26).
 */
// @tag:parent-invitation @tag:adult-role
function Invited ({ step, parentName, setParentName, password, setPassword, phase, attempt, onSignedIn, setStep }: {
  step: Extract<Step, { name: 'invited' }>
  parentName: string
  setParentName: (name: string) => void
  password: string
  setPassword: (password: string) => void
  phase: 'idle' | 'pressed' | 'waiting'
  attempt: (work: () => Promise<void>) => (event: Event) => void
  onSignedIn: () => void
  setStep: (step: Step) => void
}) {
  const { invitation, ownFamily } = step
  const role = invitation.role ?? 'manager'
  const ownIsEmpty = ownFamily ? ownFamily.children === 0 && ownFamily.devices === 0 && ownFamily.adults <= 1 : true
  const decline = attempt(async () => {
    await signIn.declineInvitation(step.mailAuthToken)
    if (ownFamily) {
      await signIn.session(step.mailAuthToken)
      onSignedIn()
    } else setStep(step.canCreateFamily ? { name: 'mail' } : { name: 'closed', mail: step.mail })
  })
  const intoOwn = attempt(async () => {
    await signIn.session(step.mailAuthToken)
    onSignedIn()
  })
  const inviter = <><b>{invitation.inviterName || invitation.inviterMail}</b>{invitation.inviterName && invitation.inviterMail ? ` (${invitation.inviterMail})` : ''}</>
  if (!ownIsEmpty) {
    return (
      <div>
        <p>{inviter} приглашает вас в свою семью. Но у вас уже есть своя: детей — {ownFamily!.children}, планшетов — {ownFamily!.devices}, взрослых — {ownFamily!.adults}.</p>
        <p>Чтобы перейти, сначала удалите свою семью или выйдите из неё: войдите в неё, «⋯» → «Семья». Приглашение подождёт.</p>
        <button type='button' class='primary' disabled={phase !== 'idle'} onClick={intoOwn}>Войти в свою семью</button>
        <button type='button' class='link' onClick={decline}>Отказаться от приглашения</button>
      </div>
    )
  }
  return (
    <form onSubmit={attempt(async () => {
      await signIn.acceptInvitation({ mailAuthToken: step.mailAuthToken, password, parentName: parentName.trim(), timeZone: browserTimeZone() })
      onSignedIn()
    })}>
      <p>{inviter} приглашает вас в свою семью — {ROLE_TITLES[role].toLowerCase()}: {ROLE_DESCRIPTIONS[role]}.</p>
      {ownFamily ? <p class='muted small'>Ваша прежняя семья пуста — ни детей, ни планшетов, — она удалится при входе в эту.</p> : null}
      <label>Ваше имя
        <input required maxLength={50} autocomplete='given-name' value={parentName} onInput={(e) => setParentName(e.currentTarget.value)} />
      </label>
      <PasswordField value={password} onInput={setPassword} optional />
      <SubmitButton phase={phase}>Войти в семью</SubmitButton>
      <button type='button' class='link' onClick={decline}>Отказаться</button>
      {ownFamily ? <button type='button' class='link' onClick={intoOwn}>Войти в свою семью</button> : null}
    </form>
  )
}

export function GoogleButton ({ clientId, onCredential, text = 'signin_with' }: { clientId: string, onCredential: (idToken: string) => void, text?: string }) {
  const target = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const show = () => {
      window.google!.accounts.id.initialize({ client_id: clientId, callback: (response) => onCredential(response.credential) })
      window.google!.accounts.id.renderButton(target.current!, { theme: 'outline', size: 'large', text, locale: 'ru' })
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
