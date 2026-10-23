import { defineConfig } from 'vitest/config'

const alias = {
  '~': new URL('./src/', import.meta.url).pathname,
  // Only exists inside workerd; see src/node-shims/cloudflare-workers.ts.
  'cloudflare:workers': new URL('./src/node-shims/cloudflare-workers.ts', import.meta.url).pathname,
}

/**
 * Two projects:
 *
 *   unit  plain TS functions — pricing, state machines, callback handling.
 *         Deliberately does NOT load the TanStack Start or Cloudflare plugins.
 *   d1    *.d1.test.ts — the code that writes to the database, run against a
 *         real local D1 (wrangler's getPlatformProxy) with every migration
 *         applied. This is where batch atomicity, guards, unique indexes and
 *         the no-overlap triggers are checked, because none of them can be
 *         faked convincingly.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.d1.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'd1',
          environment: 'node',
          include: ['src/**/*.d1.test.ts'],
          setupFiles: ['src/test/d1-setup.ts'],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
