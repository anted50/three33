// Module resolution hook registered by ./register.mjs.
const SHIM = new URL('../../src/node-shims/cloudflare-workers.ts', import.meta.url).href

export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: SHIM, shortCircuit: true }
  return next(specifier, context)
}
