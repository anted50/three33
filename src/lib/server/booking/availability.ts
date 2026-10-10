import { addMinutes } from './time'

/**
 * Free start times, computed from the two time tables and nothing else:
 *
 *   free = the barber's shifts − their busy blocks
 *
 * Busy blocks are appointments from starts_at to blocked_until (buffer
 * included), at ANY location. Because nothing is stored, a booking made
 * outside every shift (overtime) takes nothing from the plan, and a shift
 * edited later is reflected immediately. Pure: unit tested.
 */

export interface Window {
  startsAt: Date
  endsAt: Date
}

export interface Busy {
  startsAt: Date
  blockedUntil: Date
}

/**
 * Start times on a `stepMinutes` grid (aligned to each shift's start) where a
 * block of `blockMinutes` — service time + buffer — fits entirely inside a
 * shift without touching a busy block, and starts no earlier than `notBefore`.
 */
export function freeStarts(
  shifts: Window[],
  busy: Busy[],
  blockMinutes: number,
  notBefore: Date,
  stepMinutes = 15,
): Date[] {
  const out: Date[] = []
  for (const shift of shifts) {
    for (
      let start = shift.startsAt;
      addMinutes(start, blockMinutes) <= shift.endsAt;
      start = addMinutes(start, stepMinutes)
    ) {
      if (start < notBefore) continue
      const end = addMinutes(start, blockMinutes)
      const clashes = busy.some((b) => start < b.blockedUntil && end > b.startsAt)
      if (!clashes) out.push(start)
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}

/**
 * What customers are told about a day at one location:
 *
 *   working    shifts here
 *   elsewhere  the barber works that day, but only at other locations
 *   off        the barber said they won't work
 *   unknown    the barber hasn't said anything about this day
 */
export type DayStatus = 'working' | 'elsewhere' | 'off' | 'unknown'

export function dayStatus(input: {
  shiftsHere: number
  shiftsElsewhere: number
  isOff: boolean
}): DayStatus {
  if (input.shiftsHere > 0) return 'working'
  if (input.shiftsElsewhere > 0) return 'elsewhere'
  if (input.isOff) return 'off'
  return 'unknown'
}
