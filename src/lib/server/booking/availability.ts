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

/**
 * Start times on a `stepMinutes` grid (aligned to each window's start) where
 * `durationMinutes` fits entirely inside a window without touching a busy
 * block, starting no earlier than `notBefore`.
 */
export function freeStarts(
  windows: Window[],
  busy: Window[],
  durationMinutes: number,
  notBefore: Date,
  stepMinutes = 15,
): Date[] {
  const out: Date[] = []
  for (const window of windows) {
    for (
      let start = window.startsAt;
      addMinutes(start, durationMinutes) <= window.endsAt;
      start = addMinutes(start, stepMinutes)
    ) {
      if (start < notBefore) continue
      const end = addMinutes(start, durationMinutes)
      const clashes = busy.some((b) => start < b.endsAt && end > b.startsAt)
      if (!clashes) out.push(start)
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}
