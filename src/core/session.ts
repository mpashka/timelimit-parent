import type { AddDeviceToken, TimelimitApi } from './api.ts'
import { ParentConsoleError } from './errors.ts'
import type { ParentAction, PushActionItem } from './protocol.ts'
import { createEmptyState, type FamilyState, findParentOfDevice, mergeServerStatus, toClientStatus } from './state.ts'

// @tag:parent-console

/** Non-secret persistence injected by the host: files for the CLI, localStorage or IndexedDB for the web page. */
export interface KeyValueStorage {
  get (key: string): Promise<string | undefined>
  set (key: string, value: string): Promise<void>
}

export class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>()
  async get (key: string) { return this.data.get(key) }
  async set (key: string, value: string) { this.data.set(key, value) }
}

export interface PushResult {
  pushed: number
  state: FamilyState
}

/**
 * Who the caller is to the sync server. The protocol names the field `deviceAuthToken` and the
 * identifier `deviceId`, but since the parent-session extension both may also stand for a
 * signed-in person — see docs/implementation/web-admin.md, "Вход пользователем".
 */
export type Subject =
  | { kind: 'device', authToken: string, deviceId?: string }
  | { kind: 'session', authToken: string, sessionId: string, userId: string }

const MAX_ACTIONS_PER_REQUEST = 50

export class SyncClient {
  private readonly api: TimelimitApi
  private readonly subject: Subject
  private readonly storage: KeyValueStorage
  private readonly now: () => number
  private cached: FamilyState | undefined

  constructor ({ api, subject, storage, now = Date.now }: {
    api: TimelimitApi, subject: Subject, storage: KeyValueStorage, now?: () => number
  }) {
    this.api = api
    this.subject = subject
    this.storage = storage
    this.now = now
  }

  async loadCachedState (): Promise<FamilyState> {
    if (this.cached) return this.cached
    const raw = await this.storage.get('state')
    this.cached = raw ? JSON.parse(raw) as FamilyState : createEmptyState()
    return this.cached
  }

  async sync ({ full = false }: { full?: boolean } = {}): Promise<FamilyState> {
    const previous = full ? createEmptyState() : await this.loadCachedState()
    const status = await this.api.pullStatus({ deviceAuthToken: this.subject.authToken, status: toClientStatus(previous) })
    const state = mergeServerStatus(previous, status)
    this.cached = state
    await this.storage.set('state', JSON.stringify(state))
    return state
  }

  parentUserId (state: FamilyState): string {
    if (this.subject.kind === 'session') {
      const { userId, sessionId } = this.subject
      if (state.users.data.some((user) => user.id === userId && user.type === 'parent')) return userId
      throw new ParentConsoleError(
        `the parent of session ${sessionId} (${userId}) is no longer in the family`,
        'the parent was removed from the family — sign in again'
      )
    }

    const ownDeviceId = this.subject.deviceId
    const parent = findParentOfDevice(state, ownDeviceId)
    if (parent) return parent.id

    const device = ownDeviceId ? state.devices.data.find((d) => d.deviceId === ownDeviceId) : undefined
    if (ownDeviceId && !device) {
      throw new ParentConsoleError(`device ${ownDeviceId} is not in the family device list`, 'the parent device was removed — run `login` again')
    }
    if (device) {
      throw new ParentConsoleError(`device ${device.deviceId} (${device.name}) has no parent signed in`, 'run `login` again to get a parent device')
    }
    throw new ParentConsoleError('cannot tell which parent this device belongs to', 'set ownDeviceId in the config (printed by `login`) or TIMELIMIT_DEVICE_ID')
  }

  /** Sends actions in order; stops at the first chunk the server flags, re-pulls the full state and throws. */
  async push (actions: ParentAction[]): Promise<PushResult> {
    if (actions.length === 0) return { pushed: 0, state: await this.sync() }
    const state = await this.sync()
    const userId = this.parentUserId(state)
    let pushed = 0
    for (let offset = 0; offset < actions.length; offset += MAX_ACTIONS_PER_REQUEST) {
      const chunk = actions.slice(offset, offset + MAX_ACTIONS_PER_REQUEST)
      const items: PushActionItem[] = []
      for (const action of chunk) {
        items.push({ encodedAction: JSON.stringify(action), sequenceNumber: await this.nextSequenceNumber(), integrity: 'device', type: 'parent', userId })
      }
      const { shouldDoFullSync } = await this.api.pushActions({ deviceAuthToken: this.subject.authToken, actions: items })
      if (shouldDoFullSync) {
        await this.sync({ full: true })
        throw new ParentConsoleError(
          `the server rejected at least one of actions ${offset + 1}..${offset + chunk.length} (of ${actions.length}); ${pushed} earlier actions were applied, later ones were not sent`,
          'the protocol does not say which action failed: compare `--dry-run` output with the fresh `status`; typical causes are a category or rule that no longer exists, an action the server does not know (old server) or a parent device that is no longer signed in'
        )
      }
      pushed += chunk.length
    }
    return { pushed, state: await this.sync() }
  }

  /** Five words the child's device enters to join the family; the server keeps only the newest token per family. */
  async createAddDeviceToken (): Promise<AddDeviceToken> {
    const parentId = this.parentUserId(await this.sync())
    return this.api.createAddDeviceToken({ deviceAuthToken: this.subject.authToken, parentId })
  }

  /** Removes the device from the family: its token stops working, the child it was assigned to keeps its settings. */
  async removeDevice (deviceId: string): Promise<FamilyState> {
    const parentId = this.parentUserId(await this.sync())
    await this.api.removeDevice({ deviceAuthToken: this.subject.authToken, parentId, deviceId })
    return this.sync()
  }

  private async nextSequenceNumber (): Promise<number> {
    const stored = Number(await this.storage.get('sequenceNumber') ?? '0')
    // ponytail: the server keeps the counter in a 32-bit column; seeding from unix seconds survives a lost
    // state directory but overflows in 2038 — switch to a server-provided counter if it ever matters
    const next = Math.max(stored + 1, Math.floor(this.now() / 1000))
    await this.storage.set('sequenceNumber', String(next))
    return next
  }
}
