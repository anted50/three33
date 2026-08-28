/**
 * Row housekeeping: expired sessions, expired OTP codes, expired guest carts,
 * and checkout attempts past their retention window.
 *
 * Normally invoked on a timer by the running server (see server/index.mjs);
 * this entry point exists so it can also be run by hand, which is what you
 * want the first time after a long stretch with no cleanup at all.
 *
 * The work itself lives in src/lib/server/maintenance.ts — this file is only
 * the command-line wrapper around it.
 */
import { runCleanup } from '~/lib/server/maintenance'

async function main() {
  const results = await runCleanup()

  for (const result of results) {
    if (result.ok) {
      console.log(`  ${result.task}: ok`)
    } else {
      console.error(`  ${result.task}: FAILED`, result.error)
    }
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(
    `cleanup: ${results.length - failed}/${results.length} task(s) ok`,
  )

  // Non-zero on any failure, so a scheduler or a human sees it went wrong.
  return failed === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('cleanup: failed', error)
    process.exit(1)
  })
