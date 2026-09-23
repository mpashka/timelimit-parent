import { ParentConsoleError } from './errors.ts'
import type { ChildRequest, ChildRequestAnswerKind, ParentAction } from './protocol.ts'
import type { FamilyState } from './state.ts'

// @tag:child-request @tag:app-allowance

export type RequestStatus = 'waiting' | 'expired' | 'allowed' | 'denied'

export function requestStatus (request: ChildRequest, now: number): RequestStatus {
  if (request.answer === undefined) return now < request.expiresAt ? 'waiting' : 'expired'
  return request.answer.kind === 'deny' ? 'denied' : 'allowed'
}

export function findRequest (state: FamilyState, requestId: string): { request: ChildRequest, childId: string } {
  for (const user of state.users.data) {
    const request = user.requests?.find((item) => item.id === requestId)
    if (request) return { request, childId: user.id }
  }
  throw new ParentConsoleError(`no request ${requestId}`, 'it is older than a day or the screen is stale — reload it')
}

export function answerRequest ({ state, requestId, answer, until, word }: {
  state: FamilyState, requestId: string, answer: ChildRequestAnswerKind, until: number, word: string
}): ParentAction[] {
  const { request, childId } = findRequest(state, requestId)
  if (request.answer) throw new ParentConsoleError('the request is already answered', 'another parent or channel was faster — reload the screen')
  if (answer === 'category' && answerCategoryId(state, request, childId) === null) {
    throw new ParentConsoleError('the app has no category and the child has no category for apps without one', 'allow the app itself')
  }
  return [{ type: 'ANSWER_CHILD_REQUEST', requestId, answer, until: answer === 'deny' ? 0 : until, word }]
}

/** What «вся категория» opens: the app's category, or for an app without one, where such apps go. */
export function answerCategoryId (state: FamilyState, request: ChildRequest, childId: string): string | null {
  if (request.categoryId !== '') return request.categoryId
  const fallback = state.users.data.find((user) => user.id === childId)?.categoryForNotAssignedApps ?? ''
  return fallback === '' ? null : fallback
}

export const setAppAllowance = ({ childId, packageName, until }: { childId: string, packageName: string, until: number }): ParentAction[] =>
  [{ type: 'SET_APP_ALLOWANCE', userId: childId, packageName, until }]
