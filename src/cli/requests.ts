import { type AppLabels, appTitle } from '../core/apps.ts'
import { ParentConsoleError } from '../core/errors.ts'
import { childOverview } from '../core/overview.ts'
import type { ChildRequestAnswerKind, ParentAction } from '../core/protocol.ts'
import { answerRequest, findRequest, requestStatus } from '../core/requests.ts'
import type { FamilyState } from '../core/state.ts'
import { dayEnd } from '../shared/schedules.ts'
import { localTime } from '../shared/time.ts'

// @tag:child-request

/** The same four durations the console offers: 15m, 30m, 1h, and `day` — until Sleep begins. */
export const DURATIONS: Record<string, number> = { '15m': 15, '30m': 30, '1h': 60 }

export function requestRows (state: FamilyState, childId: string, now: number, labels: AppLabels) {
  const child = state.users.data.find((user) => user.id === childId)
  if (!child) throw new ParentConsoleError(`no user with id ${childId}`)
  const today = localTime(now, child.timeZone).dayOfEpoch
  const devices = new Map(state.devices.data.map((device) => [device.deviceId, device.name]))
  const names = new Map(state.users.data.map((user) => [user.id, user.name]))
  return (child.requests ?? [])
    .map((request) => ({ request, status: requestStatus(request, now) }))
    .filter(({ request, status }) => status === 'waiting' || localTime(request.createdAt, child.timeZone).dayOfEpoch === today)
    .map(({ request, status }) => ({
      id: request.id,
      packageName: request.packageName,
      title: appTitle(state, request.packageName, labels),
      device: devices.get(request.deviceId) ?? request.deviceId,
      word: request.word,
      createdAt: request.createdAt,
      status,
      answer: request.answer ? { ...request.answer, parentName: names.get(request.answer.parentUserId) ?? request.answer.parentUserId } : null
    }))
}

/** `request answer <id> app|category <15m|30m|1h|day>` and `request deny <id>` → the action the console would send. */
export function requestAnswerActions ({ state, args, word, now }: { state: FamilyState, args: string[], word?: string, now: number }): ParentAction[] {
  const [verb, requestId, scope, duration] = args
  if (!requestId) throw new ParentConsoleError('missing request id', 'see `request list`')
  if (verb === 'deny') return answerRequest({ state, requestId, answer: 'deny', until: 0, word: word ?? '' })
  if (verb !== 'answer') throw new ParentConsoleError(`unknown request subcommand "${verb ?? ''}"`, 'use request list | request answer | request deny')
  if (scope !== 'app' && scope !== 'category') throw new ParentConsoleError(`scope must be app or category, got "${scope ?? ''}"`)
  const { childId } = findRequest(state, requestId)
  const child = state.users.data.find((user) => user.id === childId)!
  const until = duration === 'day'
    ? dayEnd(childOverview(state, childId, now).bans, now, child.timeZone).dayEndsAt
    : DURATIONS[duration ?? ''] !== undefined ? now + DURATIONS[duration] * 60_000 : undefined
  if (until === undefined) throw new ParentConsoleError(`duration must be one of ${[...Object.keys(DURATIONS), 'day'].join(', ')}, got "${duration ?? ''}"`)
  return answerRequest({ state, requestId, answer: scope as ChildRequestAnswerKind, until, word: word ?? '' })
}
