/**
 * Local time for bookings. Ulaanbaatar is UTC+8 all year — Mongolia dropped
 * daylight saving in 2017 — so a fixed offset is exact, and no timezone
 * database is needed.
 *
 * Instants are Dates (stored as timestamptz); calendar days are IsoDate
 * strings ("2026-10-05") in Ulaanbaatar time. Pure: unit tested.
 */

export type IsoDate = string

export const UB_OFFSET = '+08:00'
const UB_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The instant of a local wall-clock time. "24:00" is the end of the day. */
export function atLocal(date: IsoDate, time: string): Date {
  if (time === '24:00') return atLocal(addDays(date, 1), '00:00')
  return new Date(`${date}T${time}:00${UB_OFFSET}`)
}

/** The local calendar day an instant falls on. */
export function localDateOf(instant: Date): IsoDate {
  return new Date(instant.getTime() + UB_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`)
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/** Every day from `from` to `to`, inclusive. */
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000)
}

export function todayLocal(now = new Date()): IsoDate {
  return localDateOf(now)
}
