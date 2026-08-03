import { defineConfig } from 'drizzle-kit'
import { loadDotEnv } from './src/lib/load-dot-env'

loadDotEnv()

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
