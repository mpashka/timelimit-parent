import { ApiError, ParentConsoleError } from './errors.ts'
import type { ClientDataStatus, ServerDataStatus } from './protocol.ts'

// @tag:parent-console

export const DEFAULT_SERVER_URL = 'https://child-time.pasha-home.ru'

export interface PushActionItem {
  encodedAction: string
  sequenceNumber: number
  integrity: 'device'
  type: 'parent'
  userId: string
}

export interface SignInResult {
  deviceAuthToken: string
  ownDeviceId: string
  data: ServerDataStatus
}

type StatusHints = Record<number, string>

const unauthorizedHint = 'the device token is unknown to the server: the parent device was removed or the token is wrong — run `login` again'

export class TimelimitApi {
  readonly serverUrl: string
  private readonly fetchImpl: typeof fetch

  constructor ({ serverUrl = DEFAULT_SERVER_URL, fetchImpl = globalThis.fetch }: { serverUrl?: string, fetchImpl?: typeof fetch } = {}) {
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
      { 409: 'no family uses this mail address — create the family in the TimeLimit app first', 401: 'mail authentication expired — log in again' }
    )
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
