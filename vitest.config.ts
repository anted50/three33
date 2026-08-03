import { defineConfig } from 'vitest/config'

// Deliberately does NOT load the TanStack Start plugin: the units we care about
// (pricing, order state machine, QPay callback handling) are plain TS functions.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '~': new URL('./src/', import.meta.url).pathname,
    },
  },
})
