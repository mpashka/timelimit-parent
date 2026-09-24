// @tag:device-flags

export interface DeviceFlag {
  bit: number
  name: string
  title: string
  /** The app applies it only as device owner (`AndroidIntegration`); elsewhere the flag silently does nothing. */
  needsDeviceOwner?: true
}

/** Bits of `ExperimentalFlags` in the Android app; names and titles are ours (protocol-new-ui.md, section 8). */
export const DEVICE_FLAGS: DeviceFlag[] = [
  { bit: 0x2, name: 'system-level-blocking', title: 'Замораживать закрытые приложения (закрывает и видео в окошке)', needsDeviceOwner: true },
  { bit: 0x8, name: 'ignore-connection-status', title: 'Не верить системе, что сети нет' },
  { bit: 0x10, name: 'launcher', title: 'TimeLimit как рабочий стол' },
  { bit: 0x20, name: 'launcher-delay', title: 'Задержка перехода на рабочий стол' },
  { bit: 0x40, name: 'network-time-system', title: 'Время по сети на уровне системы', needsDeviceOwner: true },
  { bit: 0x80, name: 'slow-main-loop', title: 'Реже проверять, что открыто' },
  { bit: 0x200, name: 'keep-connected-screen-off', title: 'Держать связь при погасшем экране' },
  { bit: 0x400, name: 'multi-app-detection', title: 'Несколько приложений на экране' },
  { bit: 0x800, name: 'require-sync-for-parent-login', title: 'Вход родителя только после синхронизации' },
  { bit: 0x2000, name: 'hide-manipulation-warning', title: 'Не показывать предупреждение о вмешательстве' },
  { bit: 0x4000, name: 'soft-blocking', title: 'Блокировать без наложения и кнопки «Домой»' },
  { bit: 0x8000, name: 'sync-toasts', title: 'Сообщения о синхронизации' },
  { bit: 0x40000, name: 'strict-overlay-check', title: 'Строгая проверка разрешения на наложение' }
]

export const NOT_DEVICE_OWNER = 'не действует: TimeLimit на этом планшете не владелец устройства'

export function isFlagIneffective (flag: DeviceFlag, protectionLevel: string): boolean {
  return flag.needsDeviceOwner === true && protectionLevel !== 'device owner'
}

export function findDeviceFlag (name: string): DeviceFlag | undefined {
  return DEVICE_FLAGS.find((flag) => flag.name === name)
}
