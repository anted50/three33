import { addDays, isoWeekday, localDateOf } from '~/lib/server/booking/time'
import type { IsoDate } from '~/lib/server/booking/time'

/**
 * How the booking pages say dates and times — always Ulaanbaatar time, never
 * the browser's. Built from the same fixed-offset maths as the server
 * (booking/time.ts, pure, safe to import here), so a slot the API calls
 * "2026-10-29T06:30:00Z" reads 14:30 on every device.
 */

export type { IsoDate }
export { addDays, isoWeekday, localDateOf }

const WEEKDAY = ['Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням']
const WEEKDAY_SHORT = ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня']

/** Today in Ulaanbaatar. */
export function todayUb(now = new Date()): IsoDate {
  return localDateOf(now)
}

/** "14:30" — the wall-clock time of an instant in Ulaanbaatar. */
export function slotTime(instant: string | Date): string {
  const ub = new Date(new Date(instant).getTime() + 8 * 60 * 60 * 1000)
  return ub.toISOString().slice(11, 16)
}

/** Evening slots get the moon icon instead of the sun. */
export function isEvening(instant: string | Date): boolean {
  return Number(slotTime(instant).slice(0, 2)) >= 18
}

export function weekdayShort(date: IsoDate): string {
  return WEEKDAY_SHORT[isoWeekday(date) - 1] ?? ''
}

export function dayOfMonth(date: IsoDate): number {
  return Number(date.slice(8, 10))
}

/** "10-р сар" */
export function monthLabel(date: IsoDate): string {
  return `${Number(date.slice(5, 7))}-р сар`
}

/** "2026 оны 10-р сар" — the month calendar's heading. */
export function monthTitle(month: string): string {
  return `${month.slice(0, 4)} оны ${Number(month.slice(5, 7))}-р сар`
}

/** "Пүрэв, 10-р сарын 29" */
export function dayTitle(date: IsoDate): string {
  return `${WEEKDAY[isoWeekday(date) - 1]}, ${Number(date.slice(5, 7))}-р сарын ${dayOfMonth(date)}`
}

/** "45 мин", "1 цаг", "1 цаг 15 мин" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  return m === 0 ? `${h} цаг` : `${h} цаг ${m} мин`
}

/** "2026-10" for the month a date falls in. */
export function monthOf(date: IsoDate): string {
  return date.slice(0, 7)
}

export function addMonths(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + n
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/**
 * The cells of a Monday-first month grid: leading nulls for the days before
 * the 1st, then every date of the month.
 */
export function monthGrid(month: string): (IsoDate | null)[] {
  const first = `${month}-01`
  const cells: (IsoDate | null)[] = Array(isoWeekday(first) - 1).fill(null)
  for (let d = first; monthOf(d) === month; d = addDays(d, 1)) cells.push(d)
  return cells
}
