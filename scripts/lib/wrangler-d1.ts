import { execFileSync } from 'node:child_process'

/**
 * Runs SQL against the D1 database through the wrangler CLI — local by
 * default, the deployed one with { remote: true }. For the few scripts that
 * must be able to reach production (granting the first admin), where going
 * through wrangler means using the operator's own `wrangler login`.
 */
export function d1Execute(sql: string, { remote }: { remote: boolean }): Array<Record<string, unknown>> {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const results = JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>
  return results.flatMap((r) => r.results)
}

/** A SQL string literal. For values the script itself validated; never raw user input from a request. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
