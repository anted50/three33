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

  process.loadEnvFile(path)
}
