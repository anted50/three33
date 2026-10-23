import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api/errors'

vi.mock('./orders/reconcile', () => ({ reconcileOrders: vi.fn() }))
vi.mock('./booking/sweep', () => ({ sweepBooking: vi.fn() }))
vi.mock('./maintenance', () => ({ runCleanup: vi.fn() }))

const { reconcileOrders } = await import('./orders/reconcile')
const { sweepBooking } = await import('./booking/sweep')
const { runCleanup } = await import('./maintenance')
const { runJob } = await import('./jobs')

const sweepTally = { holdsConfirmed: 0, holdsDeleted: 1, holdsKept: 0, errors: 0 }

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

beforeEach(() => {
  vi.mocked(reconcileOrders).mockReset()
  vi.mocked(sweepBooking).mockReset()
  vi.mocked(runCleanup).mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('runJob', () => {
  it('returns the tally of a clean run', async () => {
    vi.mocked(sweepBooking).mockResolvedValue(sweepTally)
    const run = await runJob('booking-sweep')
    expect(run.job).toBe('booking-sweep')
    expect(run.result).toEqual(sweepTally)
    expect(run.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('fails with JOB_FAILED and the tally when part of the run failed', async () => {
    vi.mocked(reconcileOrders).mockResolvedValue({ checked: 3, error: 1, settled: 2 })
    const error = await rejection(runJob('reconcile'))
    expect(error.status).toBe(500)
    expect(error.code).toBe('JOB_FAILED')
    expect(error.details).toMatchObject({ result: { checked: 3, error: 1, settled: 2 } })
  })

  it('reduces a failed cleanup task to its message', async () => {
    vi.mocked(runCleanup).mockResolvedValue([
      { task: 'sessions', ok: true },
      { task: 'carts', ok: false, error: new Error('permission denied') },
    ])
    const error = await rejection(runJob('cleanup'))
    expect(error.details).toMatchObject({
      result: [
        { task: 'sessions', ok: true },
        { task: 'carts', ok: false, error: 'permission denied' },
      ],
    })
  })

  it('refuses a second concurrent run of the same job with 409', async () => {
    let finish!: () => void
    vi.mocked(sweepBooking).mockReturnValue(new Promise((r) => (finish = () => r(sweepTally))))

    const first = runJob('booking-sweep')
    const second = await rejection(runJob('booking-sweep'))
    expect(second.status).toBe(409)
    expect(second.code).toBe('JOB_RUNNING')

    // A different job is not blocked.
    vi.mocked(reconcileOrders).mockResolvedValue({ checked: 0, error: 0 })
    await expect(runJob('reconcile')).resolves.toMatchObject({ job: 'reconcile' })

    finish()
    await expect(first).resolves.toMatchObject({ job: 'booking-sweep' })
  })

  it('releases the lock after a run that threw', async () => {
    vi.mocked(sweepBooking).mockRejectedValueOnce(new Error('db down'))
    await expect(runJob('booking-sweep')).rejects.toThrow('db down')

    vi.mocked(sweepBooking).mockResolvedValue(sweepTally)
    await expect(runJob('booking-sweep')).resolves.toMatchObject({ job: 'booking-sweep' })
  })
})
