import { Fragment } from 'preact'
import type { DevicesView, DeviceWithStatus } from './api.ts'
import { clockOf, formatDuration } from './format.ts'
import { DEVICE_FLAGS, isFlagIneffective, NOT_DEVICE_OWNER, type DeviceFlag } from '../shared/device-flags.ts'
import { LABEL_MAX, labelProblem } from '../shared/label.ts'
import { useState } from 'preact/hooks'
import { RowMenu, SubmitButton, Switch, useApp, useBusy, useScreen, type Work } from './ui.tsx'

// @tag:device-state

/** «сейчас: Minecraft» while online, «не в сети с 16:10» after; a server restart knows nothing until the next sync. */
export function statusText (device: DeviceWithStatus): string {
  const { status } = device
  if (status.online) return status.app ? `в сети · сейчас: ${status.app}` : 'в сети'
  return status.seen ? `не в сети с ${clockOf(status.seen)}` : 'не выходил на связь с перезапуска сервера'
}

export function DeviceLine ({ device }: { device: DeviceWithStatus }) {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft !== null) return <li><DeviceNameForm device={device} draft={draft} setDraft={setDraft} /></li>
  return (
    <li class='device-line'>
      <i class={device.status.online ? 'dot on' : 'dot'} aria-hidden='true' />
      <div class='grow'>{device.name}<div class='muted small'>{statusText(device)}</div></div>
      {device.status.todayMs !== null ? <b>{formatDuration(device.status.todayMs)}</b> : null}
      <RowMenu title={device.name} subtitle={statusText(device)}>
        <button type='button' class='item' onClick={() => setDraft(device.name)}>Переименовать</button>
      </RowMenu>
    </li>
  )
}

// @tag:parent-console
/** The name is the parent's own words, the same check as a category title: the server keeps both in one column. */
function DeviceNameForm ({ device, draft, setDraft }: { device: DeviceWithStatus, draft: string, setDraft: (draft: string | null) => void }) {
  const { run } = useApp()
  const [phase, wrap] = useBusy()
  const problem = labelProblem(draft)
  const unchanged = draft.trim() === device.name
  return (
    <form class='form' onSubmit={(event) => {
      event.preventDefault()
      if (problem !== null || unchanged) return
      const name = draft.trim()
      void wrap(async () => {
        const ok = await run({
          key: `rename-${device.deviceId}`,
          intent: 'device-rename',
          body: { device: device.deviceId, name },
          done: `Планшет теперь «${name}»`,
          undo: () => ({ intent: 'device-rename', body: { device: device.deviceId, name: device.name } })
        })
        if (ok) setDraft(null)
      })
    }}>
      <label>Название планшета
        <input type='text' autoFocus value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
      </label>
      <div class={problem ? 'error small' : 'muted small'}>
        {problem ?? `До ${LABEL_MAX} знаков, любой язык и эмодзи. Под этим именем планшет виден в админке и в приложении TimeLimit.`}
      </div>
      <div class='chips'>
        <SubmitButton phase={phase} disabled={problem !== null || unchanged}>Переименовать</SubmitButton>
        <button type='button' onClick={() => setDraft(null)}>Отмена</button>
      </div>
    </form>
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
            <li key={flag.name}>
              <Switch on={on} work={toggle(flag, !on)}>
                {flag.title}{isFlagIneffective(flag, device.cProtectionLevel) ? <span class='muted small'>{NOT_DEVICE_OWNER}</span> : null}
              </Switch>
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
