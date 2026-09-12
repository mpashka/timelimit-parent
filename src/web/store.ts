import { TimelimitApi } from '../core/api.ts'
import type { ParentAction } from '../core/protocol.ts'
import { type KeyValueStorage, ParentSession } from '../core/session.ts'
import type { FamilyState } from '../core/state.ts'

// @tag:parent-console

const PREFIX = 'tlp.'

export const localStore: KeyValueStorage = {
  get: async (key) => localStorage.getItem(PREFIX + key) ?? undefined,
  set: async (key, value) => localStorage.setItem(PREFIX + key, value)
}

export const readLocal = (key: string): string | null => localStorage.getItem(PREFIX + key)
export const writeLocal = (key: string, value: string): void => localStorage.setItem(PREFIX + key, value)

export interface Auth { deviceAuthToken: string, ownDeviceId: string }

export function readAuth (): Auth | null {
  const raw = readLocal('auth')
  return raw ? JSON.parse(raw) as Auth : null
}

export function clearLocal (): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  }
}

export function countAdvancedOpened (): void {
  localStorage.setItem('advancedOpened', String(Number(localStorage.getItem('advancedOpened') ?? '0') + 1))
}

export interface WebConfig { googleClientId?: string, serverUrl?: string }

export async function loadWebConfig (): Promise<WebConfig> {
  try {
    const response = await fetch('./config.json', { cache: 'no-cache' })
    return response.ok ? await response.json() as WebConfig : {}
  } catch {
    return {}
  }
}

export const createApi = (config: WebConfig): TimelimitApi => new TimelimitApi({ serverUrl: config.serverUrl ?? location.origin })

/** One session per signed-in browser; requests run one after another so a poll never merges over a push. */
export class Connection {
  private readonly session: ParentSession
  private queue: Promise<unknown> = Promise.resolve()

  constructor (api: TimelimitApi, auth: Auth) {
    this.session = new ParentSession({ api, deviceAuthToken: auth.deviceAuthToken, storage: localStore, ownDeviceId: auth.ownDeviceId })
  }

  cached (): Promise<FamilyState> {
    return this.session.loadCachedState()
  }

  refresh (): Promise<FamilyState> {
    return this.serial(() => this.session.sync())
  }

  async push (actions: ParentAction[]): Promise<FamilyState> {
    return (await this.serial(() => this.session.push(actions))).state
  }

  private serial<T> (work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }
}
