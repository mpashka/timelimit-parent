import { useState } from 'preact/hooks'
import type { RequestItem, RequestsView } from './api.ts'
import { clockOf, formatDuration, formatUntil } from './format.ts'
import { ActionButton, useApp } from './ui.tsx'

// @tag:child-request

const MINUTE = 60000
const DURATIONS = [15, 30, 60]

export function Requests ({ view }: { view: RequestsView }) {
  const { child } = useApp()
  if (!view.supported) {
    return <p class='muted'>Сервер синхронизации ещё не умеет просьбы — его надо обновить.</p>
  }
  return (
    <>
      <h2 class='section'>Ждёт ответа</h2>
      {view.waiting.length === 0
        ? <p class='muted'>{child.name} сейчас ничего не просит.</p>
        : view.waiting.map((request) => <RequestCard key={request.id} request={request} view={view} />)}
      {view.earlier.length > 0
        ? (
          <>
            <h2 class='section'>Сегодня раньше</h2>
            <ul class='plain past'>
              {view.earlier.map((request) => <li key={request.id}><span>{request.title}</span> <span class='muted small'>{clockOf(request.createdAt)} · {outcome(request)}</span></li>)}
            </ul>
          </>
          )
        : null}
    </>
  )
}

function outcome (request: RequestItem): string {
  const answer = request.answer
  if (answer === null) return 'истекла — не ответили за 30 мин'
  const who = answer.parentName
  if (answer.kind === 'deny') return `отказано${answer.word ? ` — ${answer.word}` : ''} · ${who}`
  const what = answer.kind === 'category' && request.category ? `все «${request.category.title}»` : 'разрешено'
  return `${what} до ${clockOf(answer.until)} · ${who}`
}

function RequestCard ({ request, view }: { request: RequestItem, view: RequestsView }) {
  const { now, child } = useApp()
  const tz = view.child.timeZone
  const [scope, setScope] = useState<'app' | 'category'>('app')
  const category = request.category
  const target = scope === 'category' && category ? `все «${category.title}»` : request.title

  const allow = (until: number, label: string) => () => ({
    key: `answer-${request.id}-${label}`,
    intent: 'request-answer',
    body: { request: request.id, answer: scope, until },
    done: `${target}: разрешено ${formatUntil(until, now, tz)}`,
    undo: scope === 'app'
      ? () => ({ intent: 'app-allow', body: { package: request.packageName, until: 0 } })
      : () => ({ intent: 'allow', body: { category: category!.id, until: 0 } })
  })
  // ponytail: a denial has no undo — the first answer is final on the server; the child may ask
  // again in 30 minutes, so a mistaken tap costs half an hour, not the evening
  const deny = () => ({
    key: `deny-${request.id}`,
    intent: 'request-answer',
    body: { request: request.id, answer: 'deny' },
    done: `Отказано: ${request.title}. ${child.name} сможет попросить снова через 30 мин`
  })

  return (
    <article class='card request'>
      <h3>{child.name} просит {request.title}</h3>
      <div class='muted small'>{clockOf(request.createdAt)} · {request.device}{category ? ` · ${category.title}` : ''}</div>
      {request.word ? <p class='quote'>«{request.word}»</p> : null}
      <dl class='facts'>
        {category
          ? <><dt>{category.title} сегодня</dt><dd>{formatDuration(category.usedTodayMs)}{category.limitNowMs !== null ? ` из ${formatDuration(category.limitNowMs)}` : ''}</dd></>
          : null}
        {request.reason ? <><dt>Почему закрыто</dt><dd>{request.reason}</dd></> : null}
      </dl>
      <div class='segmented scope' role='tablist'>
        <button type='button' role='tab' aria-selected={scope === 'app'} onClick={() => setScope('app')}>{request.title}</button>
        <button type='button' role='tab' aria-selected={scope === 'category'} disabled={category === null}
          onClick={() => setScope('category')}>{category ? `Все «${category.title}»` : 'Вся категория'}</button>
      </div>
      {category === null
        ? <div class='muted small'>Всю категорию разрешить нельзя: приложение ни в одной категории, а категории для приложений без категории у {child.name} нет.</div>
        : request.categoryIsFallback ? <div class='muted small'>Приложение без категории — «{category.title}» принимает такие приложения.</div> : null}
      <div class='muted small'>Разрешить {target} на</div>
      <div class='durations'>
        {DURATIONS.map((minutes) => (
          <ActionButton key={minutes} work={allow(now + minutes * MINUTE, String(minutes))}>
            <b>{formatDuration(minutes * MINUTE)}</b><small>{formatUntil(now + minutes * MINUTE, now, tz)}</small>
          </ActionButton>
        ))}
        {view.dayEndsAt > now + 60 * MINUTE
          ? <ActionButton work={allow(view.dayEndsAt, 'day')}><b>до конца дня</b><small>{formatUntil(view.dayEndsAt, now, tz)}</small></ActionButton>
          : null}
      </div>
      <ActionButton class='deny wide' work={deny}>Отказать</ActionButton>
    </article>
  )
}
