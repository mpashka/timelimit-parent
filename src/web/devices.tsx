import { Fragment } from 'preact'
import type { DevicesView, DeviceWithStatus } from './api.ts'
import { clockOf, formatDuration } from './format.ts'
import { DEVICE_FLAGS, isFlagIneffective, NOT_DEVICE_OWNER, type DeviceFlag } from '../shared/device-flags.ts'
import { ActionButton, useApp, useScreen, type Work } from './ui.tsx'

// @tag:device-state

/** «сейчас: Minecraft» while online, «не в сети с 16:10» after; a server restart knows nothing until the next sync. */
export function statusText (device: DeviceWithStatus): string {
  const { status } = device
  if (status.online) return status.app ? `в сети · сейчас: ${status.app}` : 'в сети'
  return status.seen ? `не в сети с ${clockOf(status.seen)}` : 'не выходил на связь с перезапуска сервера'
}

export function DeviceLine ({ device }: { device: DeviceWithStatus }) {
  return (
    <li class='device-line'>
      <i class={device.status.online ? 'dot on' : 'dot'} aria-hidden='true' />
      <div class='grow'>{device.name}<div class='muted small'>{statusText(device)}</div></div>
      {device.status.todayMs !== null ? <b>{formatDuration(device.status.todayMs)}</b> : null}
    </li>
  )
}

// @tag:device-flags
/** Settings that used to need the parent's password on the child's tablet itself. */
function DeviceFlags ({ device }: { device: DeviceWithStatus }) {
  const toggle = (flag: DeviceFlag, on: boolean) => (): Work => ({
    key: `flag-${device.deviceId}-${flag.name}`,
    intent: 'device-flag',
    body: { device: device.deviceId, flag: flag.name, on },
    done: `${device.name}: ${flag.title} — ${on ? 'включено' : 'выключено'}`,
    undo: () => ({ intent: 'device-flag', body: { device: device.deviceId, flag: flag.name, on: !on } })
  })
  const enabled = DEVICE_FLAGS.filter((flag) => (device.exFlags & flag.bit) !== 0).length
  return (
    <li><details class='others'>
      <summary>Настройки планшета{enabled > 0 ? ` · включено: ${enabled}` : ''}</summary>
      <ul class='plain'>
        {DEVICE_FLAGS.map((flag) => {
          const on = (device.exFlags & flag.bit) !== 0
          return (
            <li key={flag.name} class='device-line'>
              <div class='grow'>{flag.title}<div class='muted small'>{on ? 'включено' : 'выключено'}{isFlagIneffective(flag, device.cProtectionLevel) ? ` · ${NOT_DEVICE_OWNER}` : ''}</div></div>
              <ActionButton work={toggle(flag, !on)}>{on ? 'Выключить' : 'Включить'}</ActionButton>
            </li>
          )
        })}
      </ul>
    </details></li>
  )
}

export function Devices () {
  const { child } = useApp()
  const view = useScreen<DevicesView>()
  return (
    <>
      <section class='card'>
        <h2>Планшеты {child.name}</h2>
        {view.devices.length === 0 ? <p><b>Детский планшет ещё не подключён</b> — пока ограничивать нечего.</p> : <ul class='plain'>{view.devices.map((device) => <Fragment key={device.deviceId}><DeviceLine device={device} /><DeviceFlags device={device} /></Fragment>)}</ul>}
        {view.appUsageProblem ? <p class='muted small'>Время за сегодня недоступно: {view.appUsageProblem}</p> : null}
      </section>
      {view.unassigned.length > 0
        ? (
          <section class='card'>
            <h2>Подключены, ребёнок не выбран</h2>
            <ul class='plain'>{view.unassigned.map((device) => <DeviceLine key={device.deviceId} device={device} />)}</ul>
            <p class='muted small'>Выберите «{child.name}» на самом планшете.</p>
          </section>
          )
        : null}
      <button type='button' class={view.devices.length === 0 ? 'primary wide' : 'wide'} onClick={() => { location.hash = '#/device' }}>Подключить планшет</button>
    </>
  )
}
