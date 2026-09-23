import type { ServerTimeLimitRule } from './protocol.generated.ts'

// @tag:parent-console

/*
 * Wire types of the TimeLimit sync protocol. The shapes are not written here: they are generated
 * from the server's own schemas into protocol.generated.ts, and this file only gives them the
 * names this client has always used. Everything below the type block is ours.
 */
export type {
  ClientDataStatus,
  ClientPushChangesRequestAction as PushActionItem,
  SerializedInstalledApp as InstalledApp,
  SerializedParentAction as ParentAction,
  SerializedTimeLimitRule as SerializedRule,
  ServerAppAllowance as AppAllowance,
  ServerChildRequest as ChildRequest,
  ServerAppRule as AppRule,
  ServerNewApp as NewApp,
  ServerDeviceState as DeviceState,
  ChildRequestAnswerKind,
  ServerDataStatus,
  ServerDeviceData as ServerDevice,
  ServerUpdatedCategoryBaseData as ServerCategoryBase,
  ServerUsedTimeItem as UsedTimeItem,
  ServerUserEntry as ServerUser,
  UrlFilter
} from './protocol.generated.ts'

/**
 * `e` is the expiry timestamp of a rule. The server sends it
 * (`function/sync/get-server-data-status/category/rules.ts`) but leaves it out of the interface its
 * schema is generated from, so the generated type has to be widened by hand. Rules with an expiry
 * are temporary grants, which is why they are excluded from bans and daily limits.
 */
export type ServerRule = ServerTimeLimitRule & { e?: number }

export const MINUTE_MAX = 24 * 60 - 1
export const URL_FILTER_API_LEVEL = 10

/** The sync server announces parent sessions by raising apiLevel to this. */
export const PARENT_SESSION_API_LEVEL = 11

/** Child requests, app allowances and the parent code — docs/specification/protocol-new-ui.md. */
export const NEW_UI_API_LEVEL = 12
export { ALL_DAYS } from '../shared/time.ts'
export const USER_FLAGS_ALL = 1 | 2
