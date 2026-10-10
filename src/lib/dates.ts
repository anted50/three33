/**
 * Dates as the shop reads them: `2026.09.29` and `2026.09.29 21:41`, always in
 * Ulaanbaatar time.
 *
 * Not toLocaleString('mn-MN'). The server's Node rendered that as "8/28/2026"
 * while the browser rendered "2026.08.28", and the server runs in UTC while
 * the browser is in UB — so every SSR'd date was a hydration mismatch that
 * made React throw the server HTML away. Building the string from en-US parts
 * with a pinned timezone gives the same answer on both sides.
 */

const TIME_ZONE = 'Asia/Ulaanbaatar'

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function parts(value: Date | string | number) {
  const out: Record<string, string> = {}
  for (const part of dateFormat.formatToParts(new Date(value))) {
    out[part.type] = part.value
  }
  return out
}

export function formatDate(value: Date | string | number): string {
  const p = parts(value)
  return `${p.year}.${p.month}.${p.day}`
}

export function formatDateTime(value: Date | string | number): string {
  const p = parts(value)
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`
}
