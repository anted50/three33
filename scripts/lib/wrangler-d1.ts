import { execFileSync } from 'node:child_process'

/**
 * Runs SQL against a D1 database through the wrangler CLI: the local one,
 * production's, or staging's. For the few scripts that must be able to reach
 * a deployed database (granting the first admin), where going through
 * wrangler means using the operator's own `wrangler login`.
 */
export type D1Target = 'local' | 'production' | 'staging'

export function d1Execute(sql: string, { target }: { target: D1Target }): Array<Record<string, unknown>> {
  const where = target === 'local' ? ['--local'] : target === 'staging' ? ['--remote', '--env', 'staging'] : ['--remote']
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', ...where, '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const results = JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>
  return results.flatMap((r) => r.results)
}

/** A SQL string literal. For values the script itself validated; never raw user input from a request. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
