/**
 * Production build wrapper.
 *
 * NODE_ENV must be "production" before Vite — and specifically
 * @vitejs/plugin-react — is imported. The plugin decides between React's
 * development and production JSX transforms from process.env.NODE_ENV at
 * module load, so setting it inside vite.config.ts is already too late: the
 * config file's own imports have run by then.
 *
 * Get this wrong and the failure is nasty. `vite build` reports success, both
 * bundles ship the *development* JSX transform, and then every server-rendered
 * route 500s at runtime with "jsxDEV is not a function" — because React is
 * external in the Node build and production React has no working jsxDEV.
 *
 * A wrapper rather than `NODE_ENV=production vite build` in the npm script,
 * because that syntax is not valid on Windows and this repo is developed there.
 */
process.env.NODE_ENV = 'production'

const { createBuilder } = await import('vite')

/**
 * createBuilder().buildApp() — not build().
 *
 * This app has two Vite environments, client and ssr. The programmatic
 * build() only builds the default one, so it silently produced dist/client
 * and no dist/server, and the server then died with ERR_MODULE_NOT_FOUND on
 * a path that had never been generated. buildApp() is what the `vite build`
 * CLI runs, and it builds both.
 */
const builder = await createBuilder()
await builder.buildApp()

console.log('build: done (NODE_ENV=production, all environments)')
