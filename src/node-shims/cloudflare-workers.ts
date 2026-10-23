/**
 * Node stand-in for the `cloudflare:workers` module, which only exists inside
 * workerd. Swapped in for the real thing by vitest.config.ts (tests) and by
 * scripts/lib/register.mjs (scripts run with tsx), so app modules can be
 * imported outside a Worker.
 *
 * `env` starts empty. Whoever needs the database puts a D1 binding on env.DB
 * before ~/db is first imported: src/test/d1-setup.ts for tests,
 * scripts/lib/local-d1.ts for scripts.
 */
export const env: Record<string, unknown> = {}

/** Outside a Worker there is no request to keep alive; the task simply runs. */
export function waitUntil(promise: Promise<unknown>): void {
  void promise
}
