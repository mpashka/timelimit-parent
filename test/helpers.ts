import { readFileSync } from 'node:fs'
import type { ServerDataStatus } from '../src/core/protocol.ts'
import { createEmptyState, type FamilyState, mergeServerStatus } from '../src/core/state.ts'

export const fullStatus = (): ServerDataStatus =>
  JSON.parse(readFileSync('test/fixtures/full-status.json', 'utf8')) as ServerDataStatus

export const fixtureState = (): FamilyState => mergeServerStatus(createEmptyState(), fullStatus())

/** Europe/Moscow is UTC+3 all year. 2026-09-14 is a Monday, day of epoch 20710. */
export const moscow = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 8, day, hour - 3, minute)
