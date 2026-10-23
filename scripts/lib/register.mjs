/**
 * Loaded with `tsx --import ./scripts/lib/register.mjs` by every npm script
 * that runs app code in Node. Resolves `cloudflare:workers` — which only
 * exists inside workerd — to src/node-shims/cloudflare-workers.ts, so modules
 * that import it (~/db, the background helper) load in a script too.
 */
import { register } from 'node:module'

register('./workers-shim-hooks.mjs', import.meta.url)
