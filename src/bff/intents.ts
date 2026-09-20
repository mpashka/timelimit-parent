import { addBanActions, type BanSpec, removeBanActions, replaceBanActions } from '../core/bans.ts'
import { ParentConsoleError } from '../core/errors.ts'
import {
  addChild, allowCategoryUntil, allowChildUntil, grantExtraTime, limitApp, lockChild, moveApp,
  revokeExtraTime, setDailyLimit, setUrlFilter, unlockChild
} from '../core/operations.ts'
import { childOverview, findCategory, findChild } from '../core/overview.ts'
import { ALL_DAYS, type ParentAction, type UrlFilter } from '../core/protocol.ts'
import { childCategories, type FamilyState } from '../core/state.ts'

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

  'limit-set': (context, body) => {
    const childId = child(context, body).id
    const minutes = body.minutes === null ? null : num(body, 'minutes')
    return setDailyLimit({ category: category(context, body, childId), minutes, days: optionalNum(body, 'days') ?? ALL_DAYS })
  },

  'limit-app': (context, body) => limitApp({
    state: context.state,
    childId: child(context, body).id,
    packageName: str(body, 'package'),
    minutes: num(body, 'minutes'),
    title: optionalStr(body, 'title') ?? str(body, 'package'),
    days: optionalNum(body, 'days') ?? ALL_DAYS
  }),

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
