import { assert } from '~/lib/assert'
import { addMinutes } from './time'

/**
 * Free start times, computed from the two time tables and nothing else:
 *
 *   free = availability windows − appointments
 *
 * Nothing is stored, so a window edited later is reflected immediately and a
 * booking the admin moved outside every window takes nothing from the plan.
 * Pure: unit tested.
 */

export interface Window {
  startsAt: Date
  endsAt: Date
}

/** The grid free start times sit on, unless a caller asks for another. */
export const SLOT_STEP_MINUTES = 15

export interface FreeStartsQuery {
  /** The barber's open windows. */
  windows: Window[]
  /** Bookings and holds; a start may not overlap any of them. */
  busy: Window[]
  durationMinutes: number
  /** Nothing earlier than this — now, for the public page. */
  notBefore: Date
  stepMinutes?: number
}

/**
 * Start times on a `stepMinutes` grid (aligned to each window's start) where
 * `durationMinutes` fits entirely inside a window without touching a busy
 * block, starting no earlier than `notBefore`. An options object, because
 * `windows` and `busy` have the same type and must not be swapped.
 */
export function freeStarts(query: FreeStartsQuery): Date[] {
  const { windows, busy, durationMinutes, notBefore, stepMinutes = SLOT_STEP_MINUTES } = query
  // A zero or negative step would never leave the loop below.
  assert(Number.isInteger(stepMinutes), 'freeStarts: stepMinutes must be whole minutes')
  assert(stepMinutes > 0, 'freeStarts: stepMinutes must be positive')
  assert(Number.isInteger(durationMinutes), 'freeStarts: durationMinutes must be whole minutes')
  assert(durationMinutes > 0, 'freeStarts: durationMinutes must be positive')

  const starts: Date[] = []
  for (const window of windows) {
    assert(window.startsAt < window.endsAt, 'freeStarts: a window must end after it starts')
    for (
      let start = window.startsAt;
      addMinutes(start, durationMinutes) <= window.endsAt;
      start = addMinutes(start, stepMinutes)
    ) {
      if (start >= notBefore) {
        const end = addMinutes(start, durationMinutes)
        const clashes = busy.some((block) => start < block.endsAt && end > block.startsAt)
        if (!clashes) starts.push(start)
      }
    }
  }
  return starts.sort((a, b) => a.getTime() - b.getTime())
}
