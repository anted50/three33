import { getPlatformProxy } from 'wrangler'
import { env } from '../../src/node-shims/cloudflare-workers'

/**
 * Points ~/db at the LOCAL D1 — the same .wrangler/state database `npm run dev`
 * uses — for scripts that read or write through the app's own modules.
 * Call before the first import of ~/db; dispose when done.
 *
 * Local only, on purpose: a script reaching the deployed database should be a
 * deliberate `wrangler d1 execute --remote`, not a flag on a seed script.
 */
export async function useLocalD1(): Promise<{ dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ remoteBindings: false })
  env.DB = proxy.env.DB
  return { dispose: () => proxy.dispose() }
}
