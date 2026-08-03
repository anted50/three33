import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { db } from '~/db'

/**
 * Placeholder for the real homepage (hero / featured / categories, Phase 1).
 * It exists now to prove the whole Phase 0 chain end to end: route -> loader ->
 * server function -> Drizzle -> Postgres, rendered on the server.
 */
const getDbStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = await db.execute<{ now: Date }>(sql`select now() as now`)
  return { now: String(rows[0]?.now ?? 'unknown') }
})

export const Route = createFileRoute('/')({
  loader: () => getDbStatus(),
  component: Home,
})

function Home() {
  const { now } = Route.useLoaderData()

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Uppercut Deluxe Mongolia</h1>
      <p>Phase 0 skeleton. Database reachable at {now}.</p>
    </main>
  )
}
