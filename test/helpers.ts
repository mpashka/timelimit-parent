import { createEmptyState, type FamilyState, mergeServerStatus } from '../src/core/state.ts'
import { fullStatus } from './fixtures/full-status.ts'

export { fullStatus }

export const fixtureState = (): FamilyState => mergeServerStatus(createEmptyState(), fullStatus())

/** Europe/Moscow is UTC+3 all year. 2026-09-14 is a Monday, day of epoch 20710. */
export const moscow = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 8, day, hour - 3, minute)
