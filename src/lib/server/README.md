# `src/lib/server/`

Everything in here runs on the server only. It is never bundled to the browser.

## Why this folder has rules

With the Go API gone, there is no typed REST boundary forcing server functions
into a consistent shape, and no second service re-validating input after the
frontend did. Both of those were free before. Now they are conventions, and
conventions only work if they are written down.

## The rules

1. **Organise by domain, not by kind.** `orders/`, `products/`, `payments/`,
   `auth/`, `cart/`. Not `queries/`, `mutations/`, `helpers/`.

2. **Every server function validates its input with zod.** No exceptions, not
   even for "internal" calls or a single `id` parameter. This folder is the only
   line of defence between the browser and Postgres.

   ```ts
   export const addToCart = createServerFn({ method: 'POST' })
     .validator(addToCartInput)          // a zod schema, exported alongside
     .handler(async ({ data }) => { ... })
   ```

3. **Prices are recomputed, never accepted.** Any amount arriving from the
   client is a display artefact. Checkout re-reads `product_variants.price` and
   recomputes the total server-side. `cart_items.unit_price_snapshot` exists for
   rendering, not for summing.

4. **Money is mungu.** Integers only, via `~/lib/money`. Conversion to tugrik
   happens at display and at the QPay boundary, nowhere else.

5. **Business logic stays out of route files.** A route's `loader` or an action
   calls a server function from here; it doesn't query the database inline. The
   one deliberate exception is `src/routes/index.tsx` during Phase 0, which will
   be replaced in Phase 1.

6. **Anything that must not run twice gets a uniqueness guard in the database,**
   not a check-then-write in application code. See
   `payments_qpay_payment_id_key`.

7. **Admin authorisation is re-checked server-side on every request.** The
   `/admin` layout `beforeLoad` is now the only gate — there is no second
   service behind it. Client-side route guards are cosmetic.

## Shape of a domain module

```
src/lib/server/orders/
  schema.ts      zod input schemas, exported for reuse in forms
  state.ts       pure state machine — no DB, unit tested
  create.ts      server functions
  queries.ts     read-only server functions
```

Pure logic (state machines, pricing, callback verification) lives in files with
no database import so Vitest can exercise it directly.
