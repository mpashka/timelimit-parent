import { addBanActions, type BanSpec, removeBanActions, replaceBanActions } from '../core/bans.ts'
import { ParentConsoleError } from '../core/errors.ts'
import {
  addChild, allowCategoryUntil, allowChildUntil, blockCategory, grantExtraTime, lockChild,
  moveApp, revokeExtraTime, setDailyLimit, setUrlFilter, unlockChild
} from '../core/operations.ts'
import { childOverview, findCategory, findChild } from '../core/overview.ts'
import { answerRequest, setAppAllowance } from '../core/requests.ts'
import { ALL_DAYS, type ParentAction, type UrlFilter } from '../core/protocol.ts'
import { type ScheduleBan, setScheduleActions } from '../core/schedules.ts'
import { childCategories, type FamilyState } from '../core/state.ts'
import { SCHEDULE_KINDS, type ScheduleKind } from '../shared/schedules.ts'

// @tag:parent-console

/**
 * What the parent meant by pressing one button, turned into protocol actions here so the browser
 * never learns the protocol — docs/implementation/web-admin.md, "Контракт BFF ⇄ браузер".
 */
export interface IntentContext {
  state: FamilyState
  now: number
}

type Body = Record<string, unknown>

/** The request body crosses a trust boundary, so every field is checked before it reaches `core`. */
function str (body: Body, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value === '') throw badRequest(`${field} must be a non-empty string`)
  return value
}

function optionalStr (body: Body, field: string): string | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`)
  return value
}

function num (body: Body, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${field} must be a number`)
  return value
}

function optionalNum (body: Body, field: string): number | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${field} must be a number`)
  return value
}

function bool (body: Body, field: string): boolean {
  const value = body[field]
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`)
  return value
}

function strings (body: Body, field: string): string[] {
  const value = body[field]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw badRequest(`${field} must be an array of strings`)
  }
  return value as string[]
}

export class BadRequestError extends ParentConsoleError {
  constructor (message: string, hint = 'the browser and the BFF disagree about the request — reload the page') {
    super(message, hint)
    this.name = 'BadRequestError'
  }
}

const badRequest = (message: string): BadRequestError => new BadRequestError(message)

const child = (context: IntentContext, body: Body) => findChild(context.state, optionalStr(body, 'child'))

const category = (context: IntentContext, body: Body, childId: string) =>
  findCategory(childCategories(context.state, childId), str(body, 'category'))

function banSpec (body: Body): BanSpec {
  const spec = { days: num(body, 'days'), start: num(body, 'start'), end: num(body, 'end'), hard: bool(body, 'hard') }
  if (spec.days < 0 || spec.days > ALL_DAYS) throw badRequest('days must be a weekday mask')
  if (spec.start < 0 || spec.start > 1439 || spec.end < 0 || spec.end > 1439) throw badRequest('start and end are minutes of the day')
  return spec
}

const intents: Record<string, (context: IntentContext, body: Body) => ParentAction[]> = {
  grant: (context, body) => {
    const childId = child(context, body).id
    const minutes = num(body, 'minutes')
    const target = category(context, body, childId)
    const args = { state: context.state, category: target, minutes: Math.abs(minutes), now: context.now }
    return minutes >= 0 ? grantExtraTime(args) : revokeExtraTime(args)
  },

  allow: (context, body) => {
    const target = child(context, body)
    const until = num(body, 'until')
    const categoryQuery = optionalStr(body, 'category')
    if (!categoryQuery) return allowChildUntil(target, until)
    return allowCategoryUntil(category(context, body, target.id), until)
  },

  lock: (context, body) => {
    const target = child(context, body)
    if (optionalStr(body, 'category')) {
      return blockCategory({ category: category(context, body, target.id), blocked: body.off !== true, until: optionalNum(body, 'until') })
    }
    return body.off === true
      ? unlockChild({ state: context.state, child: target })
      : lockChild({ state: context.state, child: target, until: optionalNum(body, 'until') })
  },

  'ban-add': (context, body) => {
    const childId = child(context, body).id
    const categories = childCategories(context.state, childId)
    const wanted = strings(body, 'categories')
    const chosen = wanted.length === 0 ? categories : wanted.map((query) => findCategory(categories, query))
    return addBanActions(chosen, banSpec(body))
  },

  'ban-remove': (context, body) => {
    const childId = child(context, body).id
    const overview = childOverview(context.state, childId, context.now)
    const index = num(body, 'index')
    const ban = overview.bans[index]
    if (!ban) throw badRequest(`the child has ${overview.bans.length} bans, no ban number ${index}`)
    return removeBanActions(ban)
  },

  'ban-replace': (context, body) => {
    const childId = child(context, body).id
    const categories = childCategories(context.state, childId)
    const overview = childOverview(context.state, childId, context.now)
    const index = num(body, 'index')
    const previous = overview.bans[index]
    if (!previous) throw badRequest(`the child has ${overview.bans.length} bans, no ban number ${index}`)
    const wanted = strings(body, 'categories')
    const chosen = wanted.length === 0 ? categories.map((c) => c.id) : wanted.map((query) => findCategory(categories, query).id)
    return replaceBanActions({
      categories,
      removeRuleIds: previous.ruleRefs.map((ref) => ref.ruleId),
      ban: banSpec(body),
      categoryIds: chosen
    })
  },

  'schedule-set': (context, body) => {
    const childId = child(context, body).id
    const kind = str(body, 'kind') as ScheduleKind
    if (!SCHEDULE_KINDS.includes(kind)) throw badRequest(`kind must be one of ${SCHEDULE_KINDS.join(', ')}`)
    const list = body.bans
    if (!Array.isArray(list)) throw badRequest('bans must be an array')
    const categories = childCategories(context.state, childId)
    const wanted = list.map((item): ScheduleBan => {
      if (typeof item !== 'object' || item === null) throw badRequest('every ban must be an object')
      return { ...banSpec(item as Body), categoryIds: strings(item as Body, 'categories').map((query) => findCategory(categories, query).id) }
    })
    return setScheduleActions({ categories, bans: childOverview(context.state, childId, context.now).bans, kind, wanted })
  },

  'limit-set': (context, body) => {
    const childId = child(context, body).id
    const minutes = body.minutes === null ? null : num(body, 'minutes')
    return setDailyLimit({ category: category(context, body, childId), minutes, days: optionalNum(body, 'days') ?? ALL_DAYS })
  },

  'app-move': (context, body) => {
    const childId = child(context, body).id
    const target = optionalStr(body, 'category')
    return moveApp({
      state: context.state,
      childId,
      packageName: str(body, 'package'),
      target: target ? category(context, body, childId) : null
    })
  },

  'filter-set': (context, body) => {
    const filter = body.filter
    if (typeof filter !== 'object' || filter === null) throw badRequest('filter must be an object')
    const value = filter as Body
    const parsed: UrlFilter = { enabled: bool(value, 'enabled'), allow: strings(value, 'allow'), block: strings(value, 'block') }
    return setUrlFilter({ state: context.state, childId: child(context, body).id, filter: parsed })
  },

  // @tag:child-request
  'request-answer': (context, body) => {
    const answer = str(body, 'answer')
    if (answer !== 'app' && answer !== 'category' && answer !== 'deny') throw badRequest('answer must be app, category or deny')
    return answerRequest({
      state: context.state,
      requestId: str(body, 'request'),
      answer,
      until: answer === 'deny' ? 0 : num(body, 'until'),
      word: optionalStr(body, 'word') ?? ''
    })
  },

  // @tag:app-allowance
  'app-allow': (context, body) => setAppAllowance({ childId: child(context, body).id, packageName: str(body, 'package'), until: num(body, 'until') }),

  // @tag:app-rule
  'app-rule': (context, body) => {
    const days = num(body, 'days')
    const limitMinutes = num(body, 'limitMinutes')
    if (!Number.isInteger(days) || days < 0 || days > ALL_DAYS) throw badRequest('days must be a weekday mask')
    if (!Number.isInteger(limitMinutes) || limitMinutes < -1 || limitMinutes > 1440) throw badRequest('limitMinutes must be -1..1440')
    return [{ type: 'SET_APP_RULE', userId: child(context, body).id, packageName: str(body, 'package'), days, limitMinutes }]
  },

  'child-add': (context, body) => addChild({ name: str(body, 'name'), timeZone: str(body, 'timeZone') }).actions
}

/**
 * Building an intent is pure: it reads the body and the state and returns actions. So anything it
 * throws means the browser asked for something this state cannot serve — a missing category, a
 * ban index from a screen that has moved on — and the cure is always the same, reload the screen.
 * Classifying that as an internal failure would send the person to the logs for their own stale tab.
 */
export function buildIntent (name: string, context: IntentContext, body: Body): ParentAction[] {
  const build = intents[name]
  if (!build) {
    throw new BadRequestError(`no such intent: ${name}`, `known intents: ${Object.keys(intents).join(', ')}`)
  }
  try {
    return build(context, body)
  } catch (error) {
    if (error instanceof BadRequestError) throw error
    if (error instanceof ParentConsoleError) throw new BadRequestError(error.message, error.hint)
    throw error
  }
}

export const intentNames = (): string[] => Object.keys(intents)
