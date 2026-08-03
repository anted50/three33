import { createConnection } from 'node:net'

/**
 * PGlite is a single-writer embedded database. Two processes opening the same
 * directory do not fail cleanly — they corrupt it, and the next read aborts
 * inside the WASM runtime with a stack trace that says nothing about the cause.
 *
 * That happened once during development: seeding while the dev server held the
 * directory produced a database that could not be read by either. The fix was
 * deleting .pglite and starting over.
 *
 * So scripts check first and refuse. A clear error beats silent corruption.
 * Not needed for the Compose Postgres, which handles concurrency properly —
 * this guard no-ops when DB_DRIVER is not pglite.
 */
export async function assertNoDevServer(port = 3000): Promise<void> {
  const driver =
    process.env.DB_DRIVER ?? (process.env.DATABASE_URL ? 'postgres' : 'pglite')

  if (driver !== 'pglite') return

  /**
   * Both stacks: on Windows, Vite binds `localhost` to ::1, so probing only
   * 127.0.0.1 reports the port free while the dev server is plainly running —
   * which is exactly the false negative this guard exists to prevent.
   */
  const [v4, v6] = await Promise.all([
    isPortInUse(port, '127.0.0.1'),
    isPortInUse(port, '::1'),
  ])

  if (!v4 && !v6) return

  throw new Error(
    [
      `Something is listening on port ${port} — probably the dev server.`,
      '',
      'PGlite allows one writer at a time. Running this now would corrupt',
      `.pglite rather than fail cleanly. Stop \`npm run dev\` and retry.`,
      '',
      'This restriction goes away once the Compose Postgres is running',
      '(DB_DRIVER=postgres).',
    ].join('\n'),
  )
}

function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}
