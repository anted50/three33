import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Loads `.env` into process.env using Node's built-in loader (22.6+), so we
 * don't carry a dotenv dependency. No-ops in production, where the environment
 * comes from the container/host rather than a file on disk.
 */
export function loadDotEnv(file = '.env'): void {
  if (process.env.NODE_ENV === 'production') return

  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return

  /**
   * NODE_ENV is preserved across the load.
   *
   * vite.config.ts calls this, and `vite build` sets NODE_ENV=production for
   * the build. Letting .env's `NODE_ENV=development` win meant the production
   * bundle was compiled with React's *development* JSX transform, and every
   * SSR page then died at runtime with "jsxDEV is not a function" — a 500 on
   * every route that renders, with nothing in the build output to suggest why.
   *
   * .env supplies secrets. It does not get to decide the build mode.
   */
  const preserved = process.env.NODE_ENV
  process.loadEnvFile(path)
  if (preserved !== undefined) process.env.NODE_ENV = preserved
}
