/**
 * Time left on an invoice: `1:58:21` once it's an hour or more, `4:07` under
 * that. Plain minutes:seconds read "118:21" for a fresh two-hour invoice.
 */
export function formatCountdown(timeLeftMs: number): string {
  // An overdue invoice reads 0:00, never a negative count.
  const totalSeconds = Math.max(0, Math.floor(timeLeftMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}
