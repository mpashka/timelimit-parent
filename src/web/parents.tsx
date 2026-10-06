import { useState } from 'preact/hooks'
import { ADULT_ROLES, type AdultRole, ROLE_DESCRIPTIONS, ROLE_TITLES } from '../shared/adult-role.ts'
import { LABEL_MAX, labelProblem } from '../shared/label.ts'
import { googleClientIdOf, mailLoginOf, type ParentsView, signIn } from './api.ts'
import { errorText, type ErrorText } from './format.ts'
import { ErrorBox } from './setup.tsx'
import { GoogleButton } from './signin.tsx'
import { ActionButton, ConfirmByCodeOption, ConfirmCodeForm, RowMenu, SubmitButton, useBusy, useFamily, useScreen, type Work } from './ui.tsx'

// @tag:parent-invitation @tag:adult-role

type Adult = ParentsView['parents'][number]

const invite = (mail: string, role: AdultRole, confirmByCode: boolean): Work => ({
  key: 'invite',
  intent: 'invite-parent',
  body: { mail, role, confirmByCode },
  done: `${mail} приглашён — войдёт в семью, когда сам согласится при входе`,
  undo: () => ({ intent: 'revoke-invitation', body: { mail } })
})

const revoke = (mail: string, role: AdultRole) => (): Work => ({
  key: `revoke-${mail}`,
  intent: 'revoke-invitation',
  body: { mail },
  done: `Приглашение ${mail} отозвано`,
  undo: () => ({ intent: 'invite-parent', body: { mail, role } })
})

// @tag:family-join-link
const invitationLink = (mail: string): string => `${location.origin}${location.pathname}#/invite/${encodeURIComponent(mail)}`

// @tag:family-join-link
const sendLetter = (mail: string) => (): Work => ({ key: `letter-${mail}`, intent: 'invitation-mail', body: { mail }, done: `Письмо со ссылкой ушло на ${mail}` })

// @tag:family-join-link
const confirmInvitation = (mail: string) => (code: string): Work => ({
  key: `confirm-${mail}`, intent: 'invitation-confirm', body: { mail, code }, done: `Код верный — ${mail} входит в семью`
})

const changeRole = (adult: Adult, role: AdultRole) => (): Work => ({
  key: `role-${adult.id}`,
  intent: 'adult-role',
  body: { user: adult.id, role },
  done: `${adult.name} теперь — ${ROLE_TITLES[role].toLowerCase()}`,
  undo: () => ({ intent: 'adult-role', body: { user: adult.id, role: adult.role } })
})

export function Parents () {
  const { role, family } = useFamily()
  const view = useScreen<ParentsView>()
  const [mail, setMail] = useState('')
  const [inviteRole, setInviteRole] = useState<AdultRole>('manager')
  const [confirmByCode, setConfirmByCode] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ adult: Adult, draft: string } | null>(null)
  const [confirming, setConfirming] = useState<{ adult: Adult, leaving: boolean } | null>(null)
  const { run, pending } = useFamily()
  const admin = role === 'admin'
  const me = view.signedInUserId
  return (
    <>
      <section class='card'>
        <h2>Взрослые</h2>
        <ul class='plain'>
          {view.parents.map((adult) => (
            <li key={adult.id} class='row'>
              <div class='grow'>
                {adult.name}{adult.id === me ? ' (вы)' : ''}
                <div class='muted small'>{ROLE_TITLES[adult.role]} · {adult.mail || 'почта не привязана'}</div>
              </div>
              {admin || adult.id === me
                ? (
                  <RowMenu title={adult.name} subtitle={ROLE_TITLES[adult.role]}>
                    <button type='button' class='item own' onClick={() => setRenaming({ adult, draft: adult.name })}>Переименовать</button>
                    {admin
                      ? ADULT_ROLES.filter((each) => each !== adult.role).map((each) => (
                        <ActionButton key={each} class='item' work={changeRole(adult, each)}>Сделать: {ROLE_TITLES[each].toLowerCase()}</ActionButton>
                      ))
                      : null}
                    {adult.id === me
                      ? <button type='button' class='item own' onClick={() => setConfirming({ adult, leaving: true })}>Выйти из семьи…</button>
                      : admin ? <button type='button' class='item' onClick={() => setConfirming({ adult, leaving: false })}>Убрать из семьи…</button> : null}
                  </RowMenu>
                  )
                : null}
            </li>
          ))}
          {view.invitations.map((invitation) => (
            <li key={invitation.mail}>
              <div class='row'>
                <div class='grow'>{invitation.mail}<div class='muted small'>
                  приглашён{invitation.role ? ` — ${ROLE_TITLES[invitation.role].toLowerCase()}` : ''}
                  {invitation.awaitingCode ? ', согласился и ждёт, когда вы введёте его код' : ', ещё не входил'}
                  {invitation.confirmByCode && !invitation.awaitingCode ? ' · вход по коду' : ''}
                </div></div>
                {admin ? <ActionButton class='link' work={revoke(invitation.mail, invitation.role ?? 'manager')}>Отозвать</ActionButton> : null}
              </div>
              {admin
                ? (
                  <div class='chips'>
                    <button type='button' class='own' onClick={() => {
                      void navigator.clipboard.writeText(invitationLink(invitation.mail)).then(() => setCopied(invitation.mail), () => setCopied(null))
                    }}>{copied === invitation.mail ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
                    {mailLoginOf() ? <ActionButton work={sendLetter(invitation.mail)}>Отправить письмом</ActionButton> : null}
                  </div>
                  )
                : null}
              {admin && invitation.awaitingCode ? <ConfirmCodeForm label='Код с экрана приглашённого' work={confirmInvitation(invitation.mail)} /> : null}
            </li>
          ))}
        </ul>
        {view.invitationsProblem ? <p class='muted small'>Приглашения не загрузились: {view.invitationsProblem}</p> : null}
      </section>
      {renaming ? <AdultNameForm adult={renaming.adult} draft={renaming.draft} setDraft={(draft) => setRenaming(draft === null ? null : { ...renaming, draft })} /> : null}
      {confirming
        ? (
          <section class='card'>
            {confirming.leaving
              ? <p>Выйти из семьи «{family.children.map((kid) => kid.name).join(', ')}»? Вы перестанете видеть детей и планшеты, веб-админка закроется. Вернуться можно только по новому приглашению админа.</p>
              : <p>Убрать {confirming.adult.name} из семьи? Все входы {confirming.adult.mail || 'этого взрослого'} закроются; вернуться можно только по новому приглашению.</p>}
            <div class='chips'>
              <button type='button' class='primary danger own' disabled={pending !== null} onClick={() => {
                const work: Work = confirming.leaving
                  ? { key: 'leave', intent: 'family-leave', done: 'Вы вышли из семьи' }
                  : { key: `remove-${confirming.adult.id}`, intent: 'adult-remove', body: { user: confirming.adult.id }, done: `${confirming.adult.name} больше не в семье` }
                void run(work).then((ok) => { if (ok) setConfirming(null) })
              }}>{confirming.leaving ? 'Выйти из семьи' : `Убрать ${confirming.adult.name}`}</button>
              <button type='button' class='own' onClick={() => setConfirming(null)}>Отмена</button>
            </div>
          </section>
          )
        : null}
      {admin
        ? (
          <form class='card' onSubmit={(event) => { event.preventDefault(); void run(invite(mail.trim(), inviteRole, confirmByCode)).then((ok) => { if (ok) { setMail(''); setConfirmByCode(false) } }) }}>
            <label>Пригласить взрослого — почта его аккаунта Google
              <input type='email' autocomplete='off' required value={mail} onInput={(event) => setMail(event.currentTarget.value)} />
            </label>
            <fieldset class='roles'>
              {ADULT_ROLES.map((each) => (
                <label key={each} class='check'>
                  <input type='radio' name='role' checked={inviteRole === each} onChange={() => setInviteRole(each)} />
                  <span><b>{ROLE_TITLES[each]}</b> <span class='muted small'>— {ROLE_DESCRIPTIONS[each]}</span></span>
                </label>
              ))}
            </fieldset>
            <ConfirmByCodeOption checked={confirmByCode} onChange={setConfirmByCode} />
            <button type='submit' class='primary' disabled={mail.trim() === ''}>Пригласить</button>
            <p class='muted small'>Потом пошлите ему ссылку из строки приглашения: он войдёт в веб-админку этим адресом и согласится — до этого в семье его нет.</p>
          </form>
          )
        : null}
      {admin ? <p class='muted small'><a href='#/family-delete'>Удалить семью…</a></p> : null}
    </>
  )
}

/** The same check as a tablet name: the server keeps an adult's name in the same column. */
function AdultNameForm ({ adult, draft, setDraft }: { adult: Adult, draft: string, setDraft: (draft: string | null) => void }) {
  const { run } = useFamily()
  const [phase, wrap] = useBusy()
  const problem = labelProblem(draft)
  const unchanged = draft.trim() === adult.name
  return (
    <form class='card form own' onSubmit={(event) => {
      event.preventDefault()
      if (problem !== null || unchanged) return
      const name = draft.trim()
      void wrap(async () => {
        const ok = await run({
          key: `rename-${adult.id}`,
          intent: 'adult-rename',
          body: { user: adult.id, name },
          done: `Теперь — «${name}»`,
          undo: () => ({ intent: 'adult-rename', body: { user: adult.id, name: adult.name } })
        })
        if (ok) setDraft(null)
      })
    }}>
      <label>Имя взрослого
        <input type='text' autoFocus value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
      </label>
      <div class={problem ? 'error small' : 'muted small'}>{problem ?? `До ${LABEL_MAX} знаков. Под этим именем взрослого видят в веб-админке и на планшетах.`}</div>
      <div class='chips'>
        <SubmitButton phase={phase} disabled={problem !== null || unchanged}>Переименовать</SubmitButton>
        <button type='button' onClick={() => setDraft(null)}>Отмена</button>
      </div>
    </form>
  )
}

const DELETE_WORD = 'удалить'

/**
 * Deleting is made deliberate, not convenient: the page names what is lost, wants the word typed
 * and the admin's own mail confirmed again — rule UX core 26.
 */
export function DeleteFamily () {
  const { role, family, run } = useFamily()
  const me = family.parents.find((adult) => adult.id === family.signedInUserId)
  const [word, setWord] = useState('')
  const [code, setCode] = useState<{ mailLoginToken: string, value: string } | null>(null)
  const [error, setError] = useState<ErrorText | null>(null)
  const [phase, wrap] = useBusy()
  const ready = word.trim().toLowerCase() === DELETE_WORD
  const clientId = googleClientIdOf()

  if (role !== 'admin') return <section class='card'><p>Удалить семью может только админ.</p><a href='#/parents'>← Семья</a></section>
  if (!me?.mail) return <section class='card'><p>К вашему входу не привязана почта — удаление подтверждается ею. Удалите семью на планшете в режиме родителя.</p><a href='#/parents'>← Семья</a></section>

  const deleteWith = async (mailAuthToken: string) => {
    await run({ key: 'family-delete', intent: 'family-delete', body: { word: word.trim(), mailAuthToken }, done: 'Семья удалена' })
  }
  const attempt = (work: () => Promise<void>) => {
    setError(null)
    void wrap(async () => {
      try {
        await work()
      } catch (ex) {
        setError(errorText(ex))
      }
    })
  }
  const others = family.parents.filter((adult) => adult.id !== me.id)

  return (
    <section class='card'>
      <h2>Удалить семью</h2>
      <p>Пропадёт насовсем, отменить нельзя:</p>
      <ul>
        <li>дети и все их настройки — лимиты, режимы, сайты, история времени: {family.children.map((kid) => kid.name).join(', ') || 'детей нет'};</li>
        <li>планшеты отключатся от семьи: {family.devices.map((device) => device.name).join(', ') || 'планшетов нет'};</li>
        <li>взрослые потеряют доступ{others.length > 0 ? `: ${others.map((adult) => adult.name).join(', ')} — им придёт письмо` : ''}.</li>
      </ul>
      <label>Впишите «{DELETE_WORD}»
        <input autocapitalize='off' autocomplete='off' value={word} onInput={(event) => setWord(event.currentTarget.value)} />
      </label>
      {ready
        ? (
          <>
            <p>Подтвердите, что это вы — {me.mail}:</p>
            {clientId
              ? <GoogleButton clientId={clientId} text='continue_with' onCredential={(idToken) => attempt(async () => deleteWith((await signIn.byGoogle(idToken)).mailAuthToken))} />
              : null}
            {code === null
              ? <SubmitButton phase={phase} onClick={() => attempt(async () => setCode({ mailLoginToken: (await signIn.mailCode(me.mail)).mailLoginToken, value: '' }))}>Прислать код на почту</SubmitButton>
              : (
                <>
                  <label>Код из письма — три слова
                    <input autocapitalize='off' autocomplete='one-time-code' spellcheck={false} value={code.value} onInput={(event) => setCode({ ...code, value: event.currentTarget.value })} />
                  </label>
                  <SubmitButton phase={phase} disabled={code.value.trim() === ''} onClick={() => attempt(async () => deleteWith((await signIn.byMailCode(code.mailLoginToken, code.value.trim())).mailAuthToken))}>Удалить семью</SubmitButton>
                </>
                )}
          </>
          )
        : null}
      <ErrorBox error={error} />
      <p><a href='#/parents'>← Не удалять</a></p>
    </section>
  )
}
