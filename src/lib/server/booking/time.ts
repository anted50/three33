/**
 * Local time for bookings. Ulaanbaatar is UTC+8 all year — Mongolia dropped
 * daylight saving in 2017 — so a fixed offset is exact, and no timezone
 * database is needed.
 *
 * Instants are Dates (stored as timestamptz); calendar days are IsoDate
 * strings ("2026-10-05") in Ulaanbaatar time. Pure: unit tested.
 */

import { assert } from '~/lib/assert'

export type IsoDate = string

export const UB_OFFSET = '+08:00'
const UB_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The instant of a local wall-clock time. "24:00" is the end of the day. */
export function atLocal(date: IsoDate, time: string): Date {
  // One level deep at most: "24:00" becomes the next day's "00:00".
  const instant =
    time === '24:00' ? new Date(`${addDays(date, 1)}T00:00:00${UB_OFFSET}`) : new Date(`${date}T${time}:00${UB_OFFSET}`)
  assert(!Number.isNaN(instant.getTime()), `atLocal: not a local time: ${date} ${time}`)
  return instant
}

/** The local calendar day an instant falls on. */
export function localDateOf(instant: Date): IsoDate {
  return new Date(instant.getTime() + UB_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  assert(Number.isInteger(days), `addDays: whole days only, got ${days}`)
  return new Date(dayStartMs(date) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * How many days `from` to `to` covers, inclusive — 0 when `to` is before
 * `from`. Computed, not counted, so a caller can refuse a huge range before
 * building it.
 */
export function dayCount(from: IsoDate, to: IsoDate): number {
  const spanMs = dayStartMs(to) - dayStartMs(from)
  if (spanMs < 0) return 0
  assert(spanMs % DAY_MS === 0, 'dayCount: dates must be whole days apart')
  return spanMs / DAY_MS + 1
}

/**
 * Every day from `from` to `to`, inclusive. `daysMax` is the caller's bound;
 * the caller refuses a longer range as bad input first (dayCount), so
 * exceeding it here is a bug.
 */
export function datesBetween(from: IsoDate, to: IsoDate, daysMax: number): IsoDate[] {
  const count = dayCount(from, to)
  assert(count <= daysMax, `datesBetween: ${count} days exceeds the bound of ${daysMax}`)

  const dates: IsoDate[] = []
  for (let index = 0; index < count; index++) dates.push(addDays(from, index))
  assert(count === 0 || dates.at(-1) === to, 'datesBetween must end on `to`')
  return dates
}

function dayStartMs(date: IsoDate): number {
  const ms = new Date(`${date}T00:00:00Z`).getTime()
  assert(!Number.isNaN(ms), `not a calendar date: ${date}`)
  return ms
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function addMinutes(instant: Date, minutes: number): Date {
  assert(Number.isInteger(minutes), `addMinutes: whole minutes only, got ${minutes}`)
  return new Date(instant.getTime() + minutes * 60_000)
}

export function todayLocal(now = new Date()): IsoDate {
  return localDateOf(now)
}
