import type { DevicesView, DeviceWithStatus } from './api.ts'
import { clockOf, formatDuration } from './format.ts'
import { useApp, useScreen } from './ui.tsx'

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

export function Devices () {
  const { child } = useApp()
  const view = useScreen<DevicesView>()
  return (
    <>
      <section class='card'>
        <h2>Планшеты {child.name}</h2>
        {view.devices.length === 0 ? <p><b>Детский планшет ещё не подключён</b> — пока ограничивать нечего.</p> : <ul class='plain'>{view.devices.map((device) => <DeviceLine key={device.deviceId} device={device} />)}</ul>}
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
