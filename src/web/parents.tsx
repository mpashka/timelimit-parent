import { useState } from 'preact/hooks'
import type { ParentsView } from './api.ts'
import { ActionButton, useApp, useScreen, type Work } from './ui.tsx'

// @tag:parent-invitation

const invite = (mail: string): Work => ({
  key: 'invite',
  intent: 'invite-parent',
  body: { mail },
  done: `${mail} приглашён — войдёт в семью, когда сам согласится при входе`,
  undo: () => ({ intent: 'revoke-invitation', body: { mail } })
})

const revoke = (mail: string) => (): Work => ({
  key: `revoke-${mail}`,
  intent: 'revoke-invitation',
  body: { mail },
  done: `Приглашение ${mail} отозвано`,
  undo: () => ({ intent: 'invite-parent', body: { mail } })
})

export function Parents () {
  const { run } = useApp()
  const view = useScreen<ParentsView>()
  const [mail, setMail] = useState('')
  return (
    <>
      <section class='card'>
        <h2>Родители</h2>
        <ul class='plain'>
          {view.parents.map((parent) => (
            <li key={parent.id}>{parent.name}{parent.id === view.signedInUserId ? ' (вы)' : ''}<div class='muted small'>{parent.mail || 'почта не привязана'}</div></li>
          ))}
          {view.invitations.map((invitation) => (
            <li key={invitation.mail} class='row'>
              <div class='grow'>{invitation.mail}<div class='muted small'>приглашён, ещё не входил</div></div>
              <ActionButton class='link' work={revoke(invitation.mail)}>Отозвать</ActionButton>
            </li>
          ))}
        </ul>
        {view.invitationsProblem ? <p class='muted small'>Приглашения не загрузились: {view.invitationsProblem}</p> : null}
      </section>
      <form class='card' onSubmit={(event) => { event.preventDefault(); void run(invite(mail.trim())).then((ok) => { if (ok) setMail('') }) }}>
        <label>Пригласить родителя — почта его аккаунта Google
          <input type='email' autocomplete='off' required value={mail} onInput={(event) => setMail(event.currentTarget.value)} />
        </label>
        <button type='submit' class='primary' disabled={mail.trim() === ''}>Пригласить</button>
        <p class='muted small'>Он войдёт в веб-админку этим адресом, согласится — и будет управлять семьёй наравне с вами.</p>
      </form>
    </>
  )
}
