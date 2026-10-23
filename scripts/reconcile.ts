/**
 * Order payment reconciliation: settles pending orders whose callback never
 * arrived and expires the ones past their invoice window, across every
 * provider (QPay, StorePay).
 *
 * Normally run on a timer by the server (see server/index.mjs) or from outside
 * through POST /api/v1/jobs/reconcile; runnable by hand with
 * `npm run reconcile`. The work lives in src/lib/server/orders/reconcile.ts —
 * this is only the command-line wrapper.
 */
import { reconcileOrders } from '~/lib/server/orders/reconcile'

async function main() {
  const tally = await reconcileOrders()
  // Non-zero when any order failed, so a scheduler or a human sees it.
  return tally.error === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('reconcile: failed', error)
    process.exit(1)
  })
