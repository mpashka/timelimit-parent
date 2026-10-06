import { ApiError, ParentConsoleError } from './errors.ts'
import type { ParentPassword } from './password.ts'
import type { AdultRole } from '../shared/adult-role.ts'
import type {
  AddDeviceToken, ClientDataStatus, MailStatus, PushActionItem, ServerDataStatus, SessionSignInResult, SignInResult
} from './protocol.ts'

// @tag:parent-console

export const DEFAULT_SERVER_URL = 'https://child-time.pasha-home.ru'

/*
 * The server's answers are not written out here: they are generated from its schemas into
 * protocol.generated.ts and renamed in protocol.ts. An answer the server has not named yet stays
 * hand-written below — today that is ParentInvitation and the `{ items }` envelopes.
 */
export type { AddDeviceToken, MailStatus, OwnFamily, ReceivedInvitation, SessionSignInResult, SignInResult } from './protocol.ts'

// @tag:parent-invitation
export interface ParentInvitation { mail: string, createdAt: number, role?: AdultRole }

/** Server worker `delete-old-tokens` removes add-device tokens and mail auth tokens older than this. */
export const TOKEN_LIFETIME_MS = 3 * 60 * 60 * 1000

type StatusHints = Record<number, string>

// @tag:adult-role
const ADULT_ROLE_HINTS: StatusHints = {
  404: 'this server has no adult roles (needs the new-ui server branch from tim-136)',
  403: 'your adult role does not allow this — an admin of the family can',
  409: 'a family always keeps one admin: make another adult an admin first, or delete the family'
}

// @tag:family-join-google
const JOIN_HINTS: StatusHints = {
  404: 'the Google account is not linked to any child on this server (or the server is older than tim-29)',
  501: 'Google sign-in is switched off on the server: GOOGLE_CLIENT_ID is not set',
  401: 'Google ID token was rejected — sign in with Google again'
}

const unauthorizedHint = 'the device token is unknown to the server: the parent device was removed or the token is wrong — run `login` again'

/** One app's total on one day on one device — `POST /parent/get-app-usage`, docs/specification/protocol-new-ui.md §4. */
export interface AppUsageItem { deviceId: string, day: number, packageName: string, ms: number }

/** A tablet's name and launcher icon of one app, PNG in base64 — `POST /parent/get-app-icons`, docs/specification/protocol-new-ui.md §9. */
export interface AppIconItem { packageName: string, title: string, icon: string }

/** This tablet has the app on its home screen. */
export interface LaunchableAppItem { deviceId: string, packageName: string }

export const APP_ICONS_PER_REQUEST = 500

export class TimelimitApi {
  readonly serverUrl: string
  private readonly fetchImpl: typeof fetch

  // Browsers throw "Illegal invocation" when window.fetch is called detached from window.
  constructor ({ serverUrl = DEFAULT_SERVER_URL, fetchImpl = (input, init) => globalThis.fetch(input, init) }: { serverUrl?: string, fetchImpl?: typeof fetch } = {}) {
    this.serverUrl = serverUrl.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
  }

  async sendMailLoginCode ({ mail, locale }: { mail: string, locale: string }): Promise<string> {
    const result = await this.post<{ mailLoginToken?: string, mailAddressNotWhitelisted?: boolean, mailServerBlacklisted?: boolean }>(
      '/auth/send-mail-login-code-v2', { mail, locale }, { 429: 'too many login codes requested — wait and retry later' }
    )
    if (result.mailAddressNotWhitelisted) throw new ParentConsoleError(`server refused ${mail}: address is not in the server whitelist`, 'use the mail address the family was created with, or add it to MAIL_WHITELIST on the server')
    if (result.mailServerBlacklisted) throw new ParentConsoleError(`server refused ${mail}: mail provider is blacklisted on the server`)
    if (!result.mailLoginToken) throw new ParentConsoleError('server answered without mailLoginToken')
    return result.mailLoginToken
  }

  async signInByMailCode ({ mailLoginToken, receivedCode }: { mailLoginToken: string, receivedCode: string }): Promise<string> {
    const { mailAuthToken } = await this.post<{ mailAuthToken: string }>(
      '/auth/sign-in-by-mail-code', { mailLoginToken, receivedCode },
      { 403: 'the code is wrong — check the mail and try again', 410: 'the login attempt expired or had too many wrong codes — request a new code' }
    )
    return mailAuthToken
  }

  async signInByGoogle ({ idToken, locale }: { idToken: string, locale: string }): Promise<string> {
    const result = await this.post<{ mailAuthToken?: string, mailAddressNotWhitelisted?: boolean, mailServerBlacklisted?: boolean }>(
      '/auth/sign-in-by-google', { idToken, locale },
      {
        404: 'this server has no Google sign-in (needs the parent-console server branch)',
        501: 'Google sign-in is switched off on the server: GOOGLE_CLIENT_ID is not set',
        401: 'Google ID token was rejected — sign in with Google again'
      }
    )
    if (result.mailAddressNotWhitelisted) throw new ParentConsoleError('server refused the Google account: its mail is not in the server whitelist')
    if (result.mailServerBlacklisted) throw new ParentConsoleError('server refused the Google account: its mail provider is blacklisted on the server')
    if (!result.mailAuthToken) throw new ParentConsoleError('server answered without mailAuthToken')
    return result.mailAuthToken
  }

  async signInIntoFamily ({ mailAuthToken, deviceName, model = 'timelimit-parent' }: { mailAuthToken: string, deviceName: string, model?: string }): Promise<SignInResult> {
    return this.post<SignInResult>(
      '/parent/sign-in-into-family',
      { mailAuthToken, parentDevice: { model }, deviceName, clientLevel: CLIENT_LEVEL },
      { 409: 'no family uses this mail address — create the family first', 401: 'mail authentication expired — log in again' }
    )
  }

  async getStatusByMailAuthToken ({ mailAuthToken }: { mailAuthToken: string }): Promise<MailStatus> {
    return this.post<MailStatus>('/parent/get-status-by-mail-address', { mailAuthToken }, { 401: 'mail authentication expired — log in again' })
  }

  async createFamily ({ mailAuthToken, password, parentName, deviceName, timeZone, model = 'timelimit-parent' }: {
    mailAuthToken: string, password: ParentPassword, parentName: string, deviceName: string, timeZone: string, model?: string
  }): Promise<SignInResult> {
    return this.post<SignInResult>(
      '/parent/create-family',
      { mailAuthToken, parentPassword: password, parentDevice: { model }, deviceName, timeZone, parentName, clientLevel: CLIENT_LEVEL },
      {
        409: 'this mail address already has a family — sign in instead',
        403: 'the server does not allow new families (DISABLE_SIGNUP)',
        401: 'mail authentication expired or was already used — log in again'
      }
    )
  }

  /** Creates a family and its first parent without a device and signs that parent in; needs apiLevel >= PARENT_SESSION_API_LEVEL. */
  async createFamilyWithSession ({ mailAuthToken, password, parentName, timeZone }: {
    mailAuthToken: string, password: ParentPassword, parentName: string, timeZone: string
  }): Promise<SessionSignInResult> {
    return this.post<SessionSignInResult>(
      '/session/create-family',
      { mailAuthToken, parentPassword: password, parentName, timeZone },
      {
        404: 'this server has no parent sessions (needs the parent-console server branch)',
        409: 'this mail address already has a family — sign in instead',
        403: 'the server does not allow new families (DISABLE_SIGNUP)',
        401: 'mail authentication expired or was already used — log in again'
      }
    )
  }

  /** Signs a person in without registering a device; needs apiLevel >= PARENT_SESSION_API_LEVEL. */
  async signInSession ({ mailAuthToken }: { mailAuthToken: string }): Promise<SessionSignInResult> {
    return this.post<SessionSignInResult>(
      '/session/sign-in', { mailAuthToken },
      {
        404: 'this server has no parent sessions (needs the parent-console server branch)',
        409: 'no family uses this mail address — create the family first',
        401: 'mail authentication expired or was already used — log in again'
      }
    )
  }

  // @tag:parent-invitation
  /** Joins the family that invited this mail; without a password the parent mode on the tablets stays closed to this parent. */
  async acceptInvitation ({ mailAuthToken, parentName, timeZone, password }: {
    mailAuthToken: string, parentName: string, timeZone: string, password: ParentPassword | null
  }): Promise<SessionSignInResult> {
    return this.post<SessionSignInResult>(
      '/session/accept-invitation',
      { mailAuthToken, parentName, timeZone, ...(password ? { parentPassword: password } : {}) },
      {
        404: 'this server has no parent invitations (needs the new-ui server branch from tim-136)',
        409: 'the invitation is gone (revoked or already used), or your own family is not empty — delete it or leave it first in your own web console',
        401: 'mail authentication expired or was already used — log in again'
      }
    )
  }

  // @tag:parent-invitation
  async declineInvitation ({ mailAuthToken }: { mailAuthToken: string }): Promise<void> {
    await this.post('/session/decline-invitation', { mailAuthToken }, { 401: 'mail authentication expired or was already used — log in again' })
  }

  // @tag:parent-invitation
  async inviteParent ({ deviceAuthToken, parentId, mail, role }: { deviceAuthToken: string, parentId: string, mail: string, role: AdultRole }): Promise<ParentInvitation> {
    return this.post<ParentInvitation>(
      '/parent/invite-parent', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', mail, role },
      {
        404: 'this server has no parent invitations (needs the new-ui server branch from tim-136)',
        409: 'this address is already an adult of this family or is invited into another one'
      }
    )
  }

  // @tag:adult-role
  async setAdultRole ({ deviceAuthToken, parentId, userId, role }: { deviceAuthToken: string, parentId: string, userId: string, role: AdultRole }): Promise<void> {
    await this.post('/parent/set-adult-role', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', userId, role }, ADULT_ROLE_HINTS)
  }

  // @tag:family-join-google
  async setChildMail ({ deviceAuthToken, parentId, childUserId, mail }: { deviceAuthToken: string, parentId: string, childUserId: string, mail: string | null }): Promise<void> {
    await this.post('/parent/set-child-mail', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', childUserId, mail }, {
      ...ADULT_ROLE_HINTS,
      404: 'this server cannot link a child\'s Google account (needs the server from tim-29)',
      409: 'the address is linked to another child or belongs to an adult — one Google account joins one child on this server'
    })
  }

  /** Who the child's verified Google account joins, asked before the child agrees. */
  // @tag:family-join-google
  async joinPreview ({ idToken }: { idToken: string }): Promise<{ familyName: string, childName: string }> {
    return this.post('/auth/join-preview', { idToken }, JOIN_HINTS)
  }

  /** Lets the device that made up `registerToken` join as the child, through the usual `/child/add-device`. */
  // @tag:family-join-google
  async join ({ idToken, registerToken }: { idToken: string, registerToken: string }): Promise<void> {
    await this.post('/auth/join', { idToken, registerToken }, { ...JOIN_HINTS, 409: 'this sign-in was already used — press «Sign in with Google» in TimeLimit again' })
  }

  // @tag:adult-role
  async removeAdult ({ deviceAuthToken, parentId, userId }: { deviceAuthToken: string, parentId: string, userId: string }): Promise<void> {
    await this.post('/parent/remove-adult', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', userId }, ADULT_ROLE_HINTS)
  }

  // @tag:adult-role
  async leaveFamily ({ deviceAuthToken, parentId }: { deviceAuthToken: string, parentId: string }): Promise<void> {
    await this.post('/parent/leave-family', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device' }, ADULT_ROLE_HINTS)
  }

  /** `mailAuthToken` must confirm the caller's own address and is spent; every adult with a mail gets a letter. */
  // @tag:adult-role
  async deleteFamily ({ deviceAuthToken, parentId, mailAuthToken }: { deviceAuthToken: string, parentId: string, mailAuthToken: string }): Promise<void> {
    await this.post('/parent/delete-family', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', mailAuthToken }, {
      ...ADULT_ROLE_HINTS,
      401: 'the mail confirmation expired or was already used — confirm your mail again'
    })
  }

  // @tag:parent-invitation
  async listParentInvitations ({ deviceAuthToken, parentId }: { deviceAuthToken: string, parentId: string }): Promise<ParentInvitation[]> {
    const { invitations } = await this.post<{ invitations: ParentInvitation[] }>(
      '/parent/list-parent-invitations', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device' },
      { 404: 'this server has no parent invitations (needs the new-ui server branch from tim-136)' }
    )
    return invitations
  }

  // @tag:parent-invitation
  async revokeParentInvitation ({ deviceAuthToken, parentId, mail }: { deviceAuthToken: string, parentId: string, mail: string }): Promise<void> {
    await this.post('/parent/revoke-parent-invitation', { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', mail }, { 409: 'there is no such invitation: it was answered or revoked already' })
  }

  async revokeSession ({ sessionToken }: { sessionToken: string }): Promise<void> {
    await this.post('/session/revoke', { sessionToken }, { 401: 'the session is already gone' })
  }

  async createAddDeviceToken ({ deviceAuthToken, parentId }: { deviceAuthToken: string, parentId: string }): Promise<AddDeviceToken> {
    return this.post<AddDeviceToken>(
      '/parent/create-add-device-token',
      { deviceAuthToken, parentId, parentPasswordSecondHash: 'device' },
      { 401: unauthorizedHint }
    )
  }

  async removeDevice ({ deviceAuthToken, parentId, deviceId }: { deviceAuthToken: string, parentId: string, deviceId: string }): Promise<void> {
    await this.post(
      '/parent/remove-device',
      { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', deviceId },
      { 401: unauthorizedHint, 409: `device ${deviceId} is not in the family (already removed?) — see \`device list\`` }
    )
  }

  // @tag:app-service
  async getLaunchableApps ({ deviceAuthToken, parentId }: { deviceAuthToken: string, parentId: string }): Promise<LaunchableAppItem[]> {
    const outdated = 'the sync server predates home-screen apps per tablet (apiLevel 16, branch new-ui) — update it'
    const answer = await this.post<{ items: LaunchableAppItem[] }>(
      '/parent/get-launchable-apps',
      { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device' },
      { 401: unauthorizedHint, 404: outdated }
    )
    if (!Array.isArray(answer.items)) throw new ParentConsoleError('/parent/get-launchable-apps answered without items', outdated)
    return answer.items
  }

  // @tag:app-usage
  async getAppUsage ({ deviceAuthToken, parentId, userId, fromDay, toDay }: {
    deviceAuthToken: string, parentId: string, userId: string, fromDay: number, toDay: number
  }): Promise<AppUsageItem[]> {
    const answer = await this.post<{ items: AppUsageItem[] }>(
      '/parent/get-app-usage',
      { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', userId, fromDay, toDay },
      { 401: unauthorizedHint, 404: 'the sync server predates time per app (apiLevel 12, branch new-ui) — update it' }
    )
    if (!Array.isArray(answer.items)) {
      throw new ParentConsoleError('/parent/get-app-usage answered without items', 'the sync server predates time per app (apiLevel 12, branch new-ui) — update it')
    }
    return answer.items
  }

  // @tag:app-icon
  async getAppIcons ({ deviceAuthToken, parentId, packageNames }: {
    deviceAuthToken: string, parentId: string, packageNames: string[]
  }): Promise<AppIconItem[]> {
    const answer = await this.post<{ items: AppIconItem[] }>(
      '/parent/get-app-icons',
      { deviceAuthToken, parentUserId: parentId, parentPasswordSecondHash: 'device', packageNames },
      { 401: unauthorizedHint, 404: 'the sync server predates app icons (apiLevel 14, branch new-ui) — update it' }
    )
    if (!Array.isArray(answer.items)) {
      throw new ParentConsoleError('/parent/get-app-icons answered without items', 'the sync server predates app icons (apiLevel 14, branch new-ui) — update it')
    }
    return answer.items
  }

  async pullStatus ({ deviceAuthToken, status }: { deviceAuthToken: string, status: ClientDataStatus }): Promise<ServerDataStatus> {
    return this.post<ServerDataStatus>('/sync/pull-status', { deviceAuthToken, status }, { 401: unauthorizedHint })
  }

  async pushActions ({ deviceAuthToken, actions }: { deviceAuthToken: string, actions: PushActionItem[] }): Promise<{ shouldDoFullSync: boolean }> {
    if (actions.length > 50) throw new ParentConsoleError(`push-actions accepts at most 50 actions, got ${actions.length}`)
    return this.post('/sync/push-actions', { deviceAuthToken, actions }, { 401: unauthorizedHint })
  }

  private async post<T> (endpoint: string, body: unknown, hints: StatusHints): Promise<T> {
    const url = this.serverUrl + endpoint
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch (ex) {
      throw new ParentConsoleError(`${endpoint}: cannot reach ${this.serverUrl} (${ex instanceof Error ? ex.message : String(ex)})`, 'check the network and the server URL (--server or TIMELIMIT_SERVER)')
    }
    if (!response.ok) {
      throw new ApiError({ endpoint, status: response.status, body: await response.text(), hint: hints[response.status] ?? (response.status === 400 ? 'the server rejected the request format — the server may be older or newer than this client' : undefined) })
    }
    return await response.json() as T
  }
}

// Level 3 gets per-slot used times and tasks; higher levels make the server generate crypto keys for this device.
export const CLIENT_LEVEL = 3
