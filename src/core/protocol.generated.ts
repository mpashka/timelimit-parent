/*
 * Generated from the sync server's own schemas by scripts/protocol-types.mjs — do not edit.
 * Source: timelimit-server/docs/schema/{ServerDataStatus,ClientPullChangesRequest,ClientPushChangesRequest,SerializedParentAction}.schema.json, which the server
 * generates from src/api/schema.ts and uses to validate requests (additionalProperties: false).
 * Regenerate with `npm run protocol:types`; `npm test` and `npm run build` fail when this
 * file no longer matches the schemas.
 *
 * Copyright (C) 2019 - 2026 Jonas Lochmann, GNU AGPL-3.0 — the shapes are the server's.
 */

// @tag:parent-console

export type AppRecommendation = 'blacklist' | 'none' | 'whitelist'

export interface CategoryDataStatus {
  base: string
  apps: string
  rules: string
  usedTime: string
  tasks?: string
}

export interface ChildRequestAnswer {
  kind: ChildRequestAnswerKind
  until: number
  word: string
  parentUserId: string
  at: number
  repeatAfter: number
}

export type ChildRequestAnswerKind = 'app' | 'category' | 'deny'

export interface ClientDataStatus {
  devices: string
  apps: Record<string, string>
  categories: Record<string, CategoryDataStatus>
  users: string
  clientLevel?: number
  devicesDetail?: Record<string, DeviceDataStatus>
  kri?: number
  kr?: number
  dh?: string
  u2f?: string
}

export interface ClientPushChangesRequestAction {
  encodedAction: string
  sequenceNumber: number
  integrity: string
  type: 'appLogic' | 'child' | 'parent'
  userId: string
}

export interface DeviceDataStatus {
  appsB?: string
  appsD?: string
}

export interface EncryptableParentPassword {
  hash: string
  secondHash: string
  secondSalt: string
  encrypted?: boolean
}

export type NewPermissionStatus = 'granted' | 'not granted' | 'not supported'

export type ProtectionLevel = 'device owner' | 'none' | 'password device admin' | 'simple device admin'

export type RuntimePermissionStatus = 'granted' | 'not granted' | 'not required'

export interface SerialiizedUpdateNetworkTimeVerificationAction {
  type: 'UPDATE_NETWORK_TIME_VERIFICATION'
  deviceId: string
  mode: 'disabled' | 'enabled' | 'if possible'
}

export interface SerializeResetCategoryNetworkIdsAction {
  type: 'RESET_CATEGORY_NETWORK_IDS'
  categoryId: string
}

export interface SerializedAddCategoryAppsAction {
  type: 'ADD_CATEGORY_APPS'
  categoryId: string
  packageNames: Array<string>
}

export interface SerializedAddCategoryNetworkIdAction {
  type: 'ADD_CATEGORY_NETWORK_ID'
  categoryId: string
  itemId: string
  hashedNetworkId: string
}

export interface SerializedAddParentU2fKeyAction {
  type: 'ADD_PARENT_U2F'
  keyHandle: string
  publicKey: string
}

export interface SerializedAddUserAction {
  type: 'ADD_USER'
  name: string
  userType: 'child' | 'parent'
  userId: string
  password?: EncryptableParentPassword
  timeZone: string
}

export interface SerializedAnswerChildRequestAction {
  type: 'ANSWER_CHILD_REQUEST'
  requestId: string
  answer: ChildRequestAnswerKind
  until: number
  word: string
}

export interface SerializedAppActivityItem {
  p: string
  c: string
  t: string
}

export interface SerializedChangeParentPasswordAction {
  type: 'CHANGE_PARENT_PASSWORD'
  userId: string
  hash: string
  secondSalt: string
  secondHashEncrypted: string
  integrity: string
}

export interface SerializedCreateCategoryAction {
  type: 'CREATE_CATEGORY'
  childId: string
  categoryId: string
  title: string
}

export interface SerializedCreateTimelimtRuleAction {
  type: 'CREATE_TIMELIMIT_RULE'
  rule: SerializedTimeLimitRule
}

export interface SerializedDeleteCategoryAction {
  type: 'DELETE_CATEGORY'
  categoryId: string
}

export interface SerializedDeleteChildTaskAction {
  type: 'DELETE_CHILD_TASK'
  taskId: string
}

export interface SerializedDeleteTimeLimitRuleAction {
  type: 'DELETE_TIMELIMIT_RULE'
  ruleId: string
}

export interface SerializedIgnoreManipulationAction {
  type: 'IGNORE_MANIPULATION'
  deviceId: string
  admin: boolean
  adminA: boolean
  downgrade: boolean
  notification: boolean
  usageStats: boolean
  hadManipulation: boolean
  reboot?: boolean
  overlay?: boolean
  accessibilityService?: boolean
  ignoreHadManipulationFlags?: number
  ignoreManipulationFlags?: number
}

export interface SerializedIncrementCategoryExtraTimeAction {
  type: 'INCREMENT_CATEGORY_EXTRATIME'
  categoryId: string
  addedExtraTime: number
  day?: number
}

export interface SerializedInstalledApp {
  packageName: string
  title: string
  isLaunchable: boolean
  recommendation: AppRecommendation
}

export interface SerializedRemoveCategoryAppsAction {
  type: 'REMOVE_CATEGORY_APPS'
  categoryId: string
  packageNames: Array<string>
}

export interface SerializedRemoveParentU2fKeyAction {
  type: 'REMOVE_PARENT_U2F'
  keyHandle: string
  publicKey: string
}

export interface SerializedRemoveUserAction {
  type: 'REMOVE_USER'
  userId: string
  authentication?: string
}

export interface SerializedRenameChildAction {
  type: 'RENAME_CHILD'
  childId: string
  newName: string
}

export interface SerializedReportU2fLoginAction {
  type: 'REPORT_U2F_LOGIN'
}

export interface SerializedReviewChildTaskAction {
  type: 'REVIEW_CHILD_TASK'
  taskId: string
  ok: boolean
  time: number
  day?: number
}

export interface SerializedSetAppAllowanceAction {
  type: 'SET_APP_ALLOWANCE'
  userId: string
  packageName: string
  until: number
}

export interface SerializedSetAppRuleAction {
  type: 'SET_APP_RULE'
  userId: string
  packageName: string
  days: number
  limitMinutes: number
}

export interface SerializedSetCategoryExtraTimeAction {
  type: 'SET_CATEGORY_EXTRA_TIME'
  categoryId: string
  newExtraTime: number
  day?: number
}

export interface SerializedSetCategoryForUnassignedAppsAction {
  type: 'SET_CATEGORY_FOR_UNASSIGNED_APPS'
  childId: string
  categoryId: string
}

export interface SerializedSetChildPasswordAction {
  type: 'SET_CHILD_PASSWORD'
  childId: string
  newPassword: EncryptableParentPassword
}

export interface SerializedSetConsiderRebootManipulationAction {
  type: 'SET_CONSIDER_REBOOT_MANIPULATION'
  deviceId: string
  enable: boolean
}

export interface SerializedSetDeviceDefaultUserAction {
  type: 'SET_DEVICE_DEFAULT_USER'
  deviceId: string
  defaultUserId: string
}

export interface SerializedSetDeviceDefaultUserTimeoutAction {
  type: 'SET_DEVICE_DEFAULT_USER_TIMEOUT'
  deviceId: string
  timeout: number
}

export interface SerializedSetDeviceUserAction {
  type: 'SET_DEVICE_USER'
  deviceId: string
  userId: string
}

export interface SerializedSetKeepSignedInAction {
  type: 'SET_KEEP_SIGNED_IN'
  deviceId: string
  keepSignedIn: boolean
}

export interface SerializedSetParentCategoryAction {
  type: 'SET_PARENT_CATEGORY'
  categoryId: string
  parentCategory: string
}

export interface SerializedSetRelaxPrimaryDeviceAction {
  type: 'SET_RELAX_PRIMARY_DEVICE'
  userId: string
  relax: boolean
}

export interface SerializedSetSendDeviceConnected {
  type: 'SET_SEND_DEVICE_CONNECTED'
  deviceId: string
  enable: boolean
}

export interface SerializedSetUserDisableLimitsUntilAction {
  type: 'SET_USER_DISABLE_LIMITS_UNTIL'
  childId: string
  time: number
}

export interface SerializedSetUserTimezoneAction {
  type: 'SET_USER_TIMEZONE'
  userId: string
  timezone: string
}

export interface SerializedTimeLimitRule {
  ruleId: string
  categoryId: string
  time: number
  days: number
  extraTime: boolean
  start?: number
  end?: number
  dur?: number
  pause?: number
  perDay?: boolean
  e?: number
}

export interface SerializedUpdatCategoryDisableLimitsAction {
  type: 'UPDATE_CATEGORY_DISABLE_LIMITS'
  categoryId: string
  endTime: number
}

export interface SerializedUpdateCategoryBatteryLimitAction {
  type: 'UPDATE_CATEGORY_BATTERY_LIMIT'
  categoryId: string
  chargeLimit?: number
  mobileLimit?: number
}

export interface SerializedUpdateCategoryBlockAllNotificationsAction {
  type: 'UPDATE_CATEGORY_BLOCK_ALL_NOTIFICATIONS'
  categoryId: string
  blocked: boolean
  blockDelay?: number
}

export interface SerializedUpdateCategoryBlockedTimesAction {
  type: 'UPDATE_CATEGORY_BLOCKED_TIMES'
  categoryId: string
  times: string
}

export interface SerializedUpdateCategoryFlagsAction {
  type: 'UPDATE_CATEGORY_FLAGS'
  categoryId: string
  modified: number
  values: number
}

export interface SerializedUpdateCategorySortingAction {
  type: 'UPDATE_CATEGORY_SORTING'
  categoryIds: Array<string>
}

export interface SerializedUpdateCategoryTemporarilyBlockedAction {
  type: 'UPDATE_CATEGORY_TEMPORARILY_BLOCKED'
  categoryId: string
  blocked: boolean
  endTime?: number
}

export interface SerializedUpdateCategoryTimeWarningsAction {
  type: 'UPDATE_CATEGORY_TIME_WARNINGS'
  categoryId: string
  enable: boolean
  flags: number
  minutes?: number
}

export interface SerializedUpdateCategoryTitleAction {
  type: 'UPDATE_CATEGORY_TITLE'
  categoryId: string
  newTitle: string
}

export interface SerializedUpdateChildTaskAction {
  type: 'UPDATE_CHILD_TASK'
  isNew: boolean
  taskId: string
  categoryId: string
  taskTitle: string
  extraTimeDuration: number
}

export interface SerializedUpdateDeviceNameAction {
  type: 'UPDATE_DEVICE_NAME'
  deviceId: string
  name: string
}

export interface SerializedUpdateEnableActivityLevelBlockingAction {
  type: 'UPDATE_ENABLE_ACTIVITY_LEVEL_BLOCKING'
  deviceId: string
  enable: boolean
}

export interface SerializedUpdateParentNotificationFlagsAction {
  type: 'UPDATE_PARENT_NOTIFICATION_FLAGS'
  parentId: string
  flags: number
  set: boolean
}

export interface SerializedUpdateTimelimitRuleAction {
  type: 'UPDATE_TIMELIMIT_RULE'
  ruleId: string
  time: number
  days: number
  extraTime: boolean
  start?: number
  end?: number
  dur?: number
  pause?: number
  perDay?: boolean
  e?: number
}

export interface SerializedUpdateUserFlagsAction {
  type: 'UPDATE_USER_FLAGS'
  userId: string
  modified: number
  values: number
}

export interface SerializedUpdateUserLimitLoginCategory {
  type: 'UPDATE_USER_LIMIT_LOGIN_CATEGORY'
  userId: string
  categoryId?: string
}

export interface SerializedUpdateUserLimitLoginPreBlockDuration {
  type: 'UPDATE_USER_LIMIT_LOGIN_PRE_BLOCK_DURATION'
  userId: string
  preBlockDuration: number
}

export interface SerializedUpdateUserUrlFilterAction {
  type: 'UPDATE_USER_URL_FILTER'
  userId: string
  enabled: boolean
  allow: Array<string>
  block: Array<string>
}

export interface ServerAppAllowance {
  packageName: string
  until: number
}

export interface ServerAppRule {
  packageName: string
  days: number
  limitMinutes: number
  usedDay: number
  usedMs: number
}

export interface ServerCategoryNetworkId {
  itemId: string
  hashedNetworkId: string
}

export interface ServerChildRequest {
  id: string
  packageName: string
  categoryId: string
  deviceId: string
  word: string
  createdAt: number
  expiresAt: number
  answer?: ChildRequestAnswer
}

export interface ServerCryptContainer {
  version: string
  data: string
}

export interface ServerDeviceData {
  deviceId: string
  name: string
  model: string
  addedAt: number
  currentUserId: string
  networkTime: 'disabled' | 'enabled' | 'if possible'
  cProtectionLevel: ProtectionLevel
  hProtectionLevel: ProtectionLevel
  cUsageStats: RuntimePermissionStatus
  hUsageStats: RuntimePermissionStatus
  cNotificationAccess: NewPermissionStatus
  hNotificationAccess: NewPermissionStatus
  cAppVersion: number
  hAppVersion: number
  tDisablingAdmin: boolean
  reboot: boolean
  hadManipulation: boolean
  hadManipulationFlags: number
  reportUninstall: boolean
  isUserKeptSignedIn: boolean
  showDeviceConnected: boolean
  defUser: string
  defUserTimeout: number
  rebootIsManipulation: boolean
  cOverlay: RuntimePermissionStatus
  hOverlay: RuntimePermissionStatus
  asEnabled: boolean
  wasAsEnabled: boolean
  activityLevelBlocking: boolean
  qOrLater: boolean
  mFlags: number
  pk?: string
  pType?: string
  pLevel: number
}

export interface ServerDeviceList {
  version: string
  data: Array<ServerDeviceData>
}

export interface ServerDeviceState {
  deviceId: string
  seen: number
  app: string
  appSince: number
}

export interface ServerDhKey {
  v: string
  k: string
}

export interface ServerExtendedDeviceData {
  deviceId: string
  appsBase?: ServerCryptContainer
  appsDiff?: ServerCryptContainer
}

export interface ServerInstalledAppsData {
  deviceId: string
  version: string
  apps: Array<SerializedInstalledApp>
  activities: Array<SerializedAppActivityItem>
}

export interface ServerKeyRequest {
  srvSeq: number
  senId: string
  senSeq: number
  deviceId?: string
  categoryId?: string
  type: number
  tempKey: string
  signature: string
}

export interface ServerKeyResponse {
  srvSeq: number
  sender: string
  rqSeq: number
  tempKey: string
  cryptKey: string
  signature: string
}

export interface ServerNewApp {
  packageName: string
  title: string
  section: string
  installedAt: number
  deviceId: string
}

export interface ServerPing {
  deviceId: string
  token: string
  type: 'ping' | 'pong'
}

export interface ServerSessionDurationItem {
  /** the maximum duration of a session (maxSessionDuration) */
  md: number
  /** the pause duration after a session (sessionPauseDuration) */
  spd: number
  /** the start minute of the day of the session/ the rule which created this session (startMinuteOfDay) */
  sm: number
  /** the end minute of the day of the session/ the rule which created this session (endMinuteOfDay) */
  em: number
  /** the timestamp of the last usage of this session (lastUsage) */
  l: number
  /** the duration of the last/ current session (lastSessionDuration) */
  d: number
}

export interface ServerTimeLimitRule {
  id: string
  extraTime: boolean
  dayMask: number
  maxTime: number
  start: number
  end: number
  session: number
  pause: number
  perDay: boolean
}

export interface ServerUpdatedCategoryAssignedApps {
  categoryId: string
  apps: Array<string>
  version: string
}

export interface ServerUpdatedCategoryBaseData {
  categoryId: string
  childId: string
  title: string
  blockedTimes: string
  extraTime: number
  extraTimeDay: number
  tempBlocked: boolean
  tempBlockTime: number
  version: string
  parentCategoryId: string
  blockAllNotifications: boolean
  timeWarnings: number
  mblCharging: number
  mblMobile: number
  sort: number
  networks: Array<ServerCategoryNetworkId>
  dlu: number
  flags: number
  blockNotificationDelay: number
  atw: Array<number>
}

export interface ServerUpdatedCategoryTask {
  i: string
  t: string
  d: number
  p: boolean
  l: number
}

export interface ServerUpdatedCategoryTasks {
  categoryId: string
  version: string
  tasks: Array<ServerUpdatedCategoryTask>
}

export interface ServerUpdatedCategoryUsedTimes {
  categoryId: string
  times: Array<ServerUsedTimeItem>
  sessionDurations: Array<ServerSessionDurationItem>
  version: string
}

export interface ServerUpdatedTimeLimitRules {
  categoryId: string
  version: string
  rules: Array<ServerTimeLimitRule>
}

export interface ServerUsedTimeItem {
  day: number
  time: number
  start: number
  end: number
}

export interface ServerUserEntry {
  id: string
  name: string
  password: string
  secondPasswordSalt: string
  type: 'child' | 'parent'
  timeZone: string
  disableLimitsUntil: number
  mail: string
  currentDevice: string
  categoryForNotAssignedApps: string
  relaxPrimaryDevice: boolean
  mailNotificationFlags: number
  blockedTimes: string
  flags: number
  llc?: string
  pbd?: number
  urlFilter?: UrlFilter
  requests?: Array<ServerChildRequest>
  appAllowances?: Array<ServerAppAllowance>
  appRules?: Array<ServerAppRule>
  newApps?: Array<ServerNewApp>
}

export interface ServerUserList {
  version: string
  data: Array<ServerUserEntry>
  parentCodeSecret?: string
}

export interface U2fData {
  v: string
  d: Array<U2fItem>
}

export interface U2fItem {
  u: string
  a: number
  h: string
  p: string
}

export interface UrlFilter {
  enabled: boolean
  allow: Array<string>
  block: Array<string>
}

export interface ServerDataStatus {
  devices?: ServerDeviceList
  devices2?: Array<ServerExtendedDeviceData>
  apps?: Array<ServerInstalledAppsData>
  rmCategories?: Array<string>
  categoryBase?: Array<ServerUpdatedCategoryBaseData>
  categoryApp?: Array<ServerUpdatedCategoryAssignedApps>
  usedTimes?: Array<ServerUpdatedCategoryUsedTimes>
  rules?: Array<ServerUpdatedTimeLimitRules>
  tasks?: Array<ServerUpdatedCategoryTasks>
  users?: ServerUserList
  krq?: Array<ServerKeyRequest>
  kr?: Array<ServerKeyResponse>
  pings?: Array<ServerPing>
  deviceStates?: Array<ServerDeviceState>
  dh?: ServerDhKey
  u2f?: U2fData
  fullVersion: number
  message?: string
  apiLevel: number
}

export interface ClientPullChangesRequest {
  deviceAuthToken: string
  status: ClientDataStatus
}

export interface ClientPushChangesRequest {
  deviceAuthToken: string
  actions: Array<ClientPushChangesRequestAction>
}

export type SerializedParentAction =
  | SerializedAddCategoryAppsAction
  | SerializedAddCategoryNetworkIdAction
  | SerializedAddParentU2fKeyAction
  | SerializedAddUserAction
  | SerializedChangeParentPasswordAction
  | SerializedCreateCategoryAction
  | SerializedCreateTimelimtRuleAction
  | SerializedDeleteCategoryAction
  | SerializedDeleteChildTaskAction
  | SerializedDeleteTimeLimitRuleAction
  | SerializedIgnoreManipulationAction
  | SerializedIncrementCategoryExtraTimeAction
  | SerializedReportU2fLoginAction
  | SerializedRemoveCategoryAppsAction
  | SerializedRemoveParentU2fKeyAction
  | SerializedRemoveUserAction
  | SerializedRenameChildAction
  | SerializeResetCategoryNetworkIdsAction
  | SerializedReviewChildTaskAction
  | SerializedSetCategoryExtraTimeAction
  | SerializedSetCategoryForUnassignedAppsAction
  | SerializedSetChildPasswordAction
  | SerializedSetConsiderRebootManipulationAction
  | SerializedSetDeviceDefaultUserAction
  | SerializedSetDeviceDefaultUserTimeoutAction
  | SerializedSetDeviceUserAction
  | SerializedSetKeepSignedInAction
  | SerializedSetParentCategoryAction
  | SerializedSetRelaxPrimaryDeviceAction
  | SerializedSetSendDeviceConnected
  | SerializedSetUserDisableLimitsUntilAction
  | SerializedSetUserTimezoneAction
  | SerializedUpdateCategoryBatteryLimitAction
  | SerializedUpdateCategoryBlockAllNotificationsAction
  | SerializedUpdateCategoryBlockedTimesAction
  | SerializedUpdatCategoryDisableLimitsAction
  | SerializedUpdateCategoryFlagsAction
  | SerializedUpdateCategorySortingAction
  | SerializedUpdateCategoryTemporarilyBlockedAction
  | SerializedUpdateCategoryTimeWarningsAction
  | SerializedUpdateCategoryTitleAction
  | SerializedUpdateChildTaskAction
  | SerializedUpdateDeviceNameAction
  | SerializedUpdateEnableActivityLevelBlockingAction
  | SerialiizedUpdateNetworkTimeVerificationAction
  | SerializedUpdateParentNotificationFlagsAction
  | SerializedUpdateTimelimitRuleAction
  | SerializedUpdateUserFlagsAction
  | SerializedUpdateUserUrlFilterAction
  | SerializedAnswerChildRequestAction
  | SerializedSetAppAllowanceAction
  | SerializedSetAppRuleAction
  | SerializedUpdateUserLimitLoginCategory
  | SerializedUpdateUserLimitLoginPreBlockDuration

