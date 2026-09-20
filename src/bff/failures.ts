import { ApiError, ParentConsoleError } from '../core/errors.ts'
import { BadRequestError } from './intents.ts'

// @tag:parent-console

/**
 * Why the request failed, split by what the person has to do about it — not by HTTP status.
 * Today the browser tells "mail confirmation expired" from "unknown device" by looking at the
 * endpoint URL; here it is a field. See docs/implementation/web-admin.md, "Отказы".
 */
export type FailureKind =
  | 'mail-auth-expired'
  | 'session-gone'
  | 'sync-unreachable'
  | 'sync-rejected'
  | 'not-supported'
  | 'bad-request'
  | 'internal'

export interface Failure {
  kind: FailureKind
  title: string
  hint?: string
  signInAgain: boolean
}

const status: Record<FailureKind, number> = {
  'mail-auth-expired': 401,
  'session-gone': 401,
  'sync-unreachable': 502,
  'sync-rejected': 409,
  'not-supported': 501,
  'bad-request': 400,
  internal: 500
}

/** Endpoints that authenticate a mail confirmation rather than a session. */
const MAIL_AUTH_ENDPOINTS = ['/auth/', '/parent/sign-in-into-family', '/parent/get-status-by-mail-address', '/parent/create-family', '/session/sign-in']

/** The browser has no usable parent session: no cookie, or the row behind it is gone. */
export class SessionGoneError extends ParentConsoleError {
  constructor (message: string, hint: string) {
    super(message, hint)
    this.name = 'SessionGoneError'
  }
}

function kindOf (error: unknown): FailureKind {
  if (error instanceof BadRequestError) return 'bad-request'
  if (error instanceof SessionGoneError) return 'session-gone'
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return MAIL_AUTH_ENDPOINTS.some((prefix) => error.endpoint.startsWith(prefix)) ? 'mail-auth-expired' : 'session-gone'
    }
    if (error.status === 404 || error.status === 501) return 'not-supported'
    return 'internal'
  }
  if (error instanceof ParentConsoleError) {
    if (/cannot reach/.test(error.message)) return 'sync-unreachable'
    if (/rejected at least one of actions/.test(error.message)) return 'sync-rejected'
    if (/apiLevel/.test(error.message)) return 'not-supported'
    return 'internal'
  }
  return 'internal'
}

export function describeFailure (error: unknown): { status: number, failure: Failure } {
  const kind = kindOf(error)
  const title = error instanceof Error ? error.message : String(error)
  const hint = error instanceof ParentConsoleError ? error.hint : undefined
  return {
    status: status[kind],
    failure: { kind, title, hint, signInAgain: kind === 'mail-auth-expired' || kind === 'session-gone' }
  }
}
