import type { ServerDataStatus, ServerDevice } from '../../src/core/protocol.ts'

const device = (own: Pick<ServerDevice, 'deviceId' | 'name' | 'model' | 'currentUserId' | 'cAppVersion' | 'isUserKeptSignedIn'> & Partial<ServerDevice>): ServerDevice => ({
  addedAt: 1757800000000,
  networkTime: 'if possible',
  exFlags: 0,
  cProtectionLevel: 'device owner',
  hProtectionLevel: 'device owner',
  cUsageStats: 'granted',
  hUsageStats: 'granted',
  cNotificationAccess: 'granted',
  hNotificationAccess: 'granted',
  hAppVersion: own.cAppVersion,
  tDisablingAdmin: false,
  reboot: false,
  hadManipulation: false,
  hadManipulationFlags: 0,
  reportUninstall: true,
  showDeviceConnected: false,
  defUser: '',
  defUserTimeout: 0,
  rebootIsManipulation: false,
  cOverlay: 'granted',
  hOverlay: 'granted',
  asEnabled: false,
  wasAsEnabled: false,
  activityLevelBlocking: false,
  qOrLater: true,
  mFlags: 0,
  pLevel: 0,
  ...own
})

const status: ServerDataStatus = {
  apiLevel: 9,
  fullVersion: 1,
  devices: {
    version: 'dv01',
    data: [
      device({
        deviceId: 'devP01',
        name: 'console',
        model: 'timelimit-parent',
        currentUserId: 'parnt1',
        cAppVersion: 0,
        isUserKeptSignedIn: true,
        cProtectionLevel: 'none',
        hProtectionLevel: 'none'
      }),
      device({
        deviceId: 'devC01',
        name: 'Tablet',
        model: 'generic-tablet',
        currentUserId: 'child1',
        cAppVersion: 250,
        isUserKeptSignedIn: false
      }),
      device({
        deviceId: 'devC02',
        name: 'School tablet',
        model: 'generic-tablet',
        currentUserId: 'child1',
        cAppVersion: 250,
        isUserKeptSignedIn: false,
        cProtectionLevel: 'simple device admin',
        hProtectionLevel: 'simple device admin'
      })
    ]
  },
  users: {
    version: 'us01',
    data: [
      {
        id: 'parnt1',
        name: 'Родитель',
        password: '$2a$secret',
        secondPasswordSalt: '$2a$salt',
        type: 'parent',
        timeZone: 'Europe/Moscow',
        disableLimitsUntil: 0,
        mail: 'p@example.org',
        currentDevice: '',
        categoryForNotAssignedApps: '',
        blockedTimes: '',
        flags: 0,
        relaxPrimaryDevice: false,
        mailNotificationFlags: 0
      },
      {
        id: 'child1',
        name: 'Алиса',
        password: '',
        secondPasswordSalt: '',
        type: 'child',
        timeZone: 'Europe/Moscow',
        disableLimitsUntil: 0,
        mail: '',
        currentDevice: 'devC01',
        categoryForNotAssignedApps: '',
        blockedTimes: '',
        flags: 0,
        relaxPrimaryDevice: false,
        mailNotificationFlags: 0
      }
    ]
  },
  categoryBase: [
    {
      categoryId: 'allow1',
      childId: 'child1',
      title: 'Разрешено',
      blockedTimes: '',
      extraTime: 0,
      extraTimeDay: -1,
      tempBlocked: false,
      tempBlockTime: 0,
      version: 'b001',
      parentCategoryId: '',
      blockAllNotifications: false,
      timeWarnings: 0,
      mblCharging: 0,
      mblMobile: 0,
      sort: 0,
      dlu: 0,
      flags: 0,
      blockNotificationDelay: 0,
      networks: [],
      atw: []
    },
    {
      categoryId: 'games1',
      childId: 'child1',
      title: 'Игры',
      blockedTimes: '',
      extraTime: 600000,
      extraTimeDay: 20710,
      tempBlocked: false,
      tempBlockTime: 0,
      version: 'b002',
      parentCategoryId: '',
      blockAllNotifications: false,
      timeWarnings: 0,
      mblCharging: 0,
      mblMobile: 0,
      sort: 1,
      dlu: 0,
      flags: 0,
      blockNotificationDelay: 0,
      networks: [],
      atw: []
    },
    {
      categoryId: 'study1',
      childId: 'child1',
      title: 'Учёба',
      blockedTimes: '',
      extraTime: 0,
      extraTimeDay: -1,
      tempBlocked: false,
      tempBlockTime: 0,
      version: 'b003',
      parentCategoryId: '',
      blockAllNotifications: false,
      timeWarnings: 0,
      mblCharging: 0,
      mblMobile: 0,
      sort: 2,
      dlu: 0,
      flags: 0,
      blockNotificationDelay: 0,
      networks: [],
      atw: []
    },
    {
      categoryId: 'yt0001',
      childId: 'child1',
      title: 'YouTube',
      blockedTimes: '',
      extraTime: 0,
      extraTimeDay: -1,
      tempBlocked: false,
      tempBlockTime: 0,
      version: 'b004',
      parentCategoryId: 'games1',
      blockAllNotifications: false,
      timeWarnings: 0,
      mblCharging: 0,
      mblMobile: 0,
      sort: 3,
      dlu: 0,
      flags: 0,
      blockNotificationDelay: 0,
      networks: [],
      atw: []
    }
  ],
  categoryApp: [
    { categoryId: 'allow1', apps: [ 'com.android.dialer' ], version: 'a001' },
    { categoryId: 'games1', apps: [ 'com.game' ], version: 'a002' },
    { categoryId: 'study1', apps: [ 'org.school' ], version: 'a003' },
    { categoryId: 'yt0001', apps: [ 'com.google.android.youtube' ], version: 'a004' }
  ],
  rules: [
    { categoryId: 'allow1', version: 'r001', rules: [] },
    {
      categoryId: 'games1',
      version: 'r002',
      rules: [
        {
          id: 'rulG01',
          extraTime: false,
          dayMask: 127,
          maxTime: 3600000,
          start: 0,
          end: 1439,
          session: 0,
          pause: 0,
          perDay: true
        },
        {
          id: 'banE01',
          extraTime: true,
          dayMask: 31,
          maxTime: 0,
          start: 1260,
          end: 1439,
          session: 0,
          pause: 0,
          perDay: false
        },
        {
          id: 'banM01',
          extraTime: true,
          dayMask: 62,
          maxTime: 0,
          start: 0,
          end: 419,
          session: 0,
          pause: 0,
          perDay: false
        }
      ]
    },
    {
      categoryId: 'study1',
      version: 'r003',
      rules: [
        {
          id: 'banE02',
          extraTime: true,
          dayMask: 31,
          maxTime: 0,
          start: 1260,
          end: 1439,
          session: 0,
          pause: 0,
          perDay: false
        },
        {
          id: 'banM02',
          extraTime: true,
          dayMask: 62,
          maxTime: 0,
          start: 0,
          end: 419,
          session: 0,
          pause: 0,
          perDay: false
        }
      ]
    },
    { categoryId: 'yt0001', version: 'r004', rules: [] }
  ],
  usedTimes: [
    { categoryId: 'allow1', version: 'u001', times: [], sessionDurations: [] },
    {
      categoryId: 'games1',
      version: 'u002',
      sessionDurations: [],
      times: [
        { day: 20710, time: 2700000, start: 0, end: 1439 },
        { day: 20709, time: 3600000, start: 0, end: 1439 }
      ]
    },
    { categoryId: 'study1', version: 'u003', times: [], sessionDurations: [] },
    { categoryId: 'yt0001', version: 'u004', times: [], sessionDurations: [] }
  ]
}

export const fullStatus = (): ServerDataStatus => structuredClone(status)
