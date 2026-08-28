import { describe, expect, it } from 'vitest'
import { basketFingerprint, sameBasket } from './basket'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('basketFingerprint', () => {
  it('ignores line order', () => {
    const one = basketFingerprint(
      [
        { variantId: A, qty: 1 },
        { variantId: B, qty: 2 },
      ],
      5000,
    )
    const other = basketFingerprint(
      [
        { variantId: B, qty: 2 },
        { variantId: A, qty: 1 },
      ],
      5000,
    )

    expect(sameBasket(one, other)).toBe(true)
  })

  it('separates a changed quantity', () => {
    expect(
      sameBasket(
        basketFingerprint([{ variantId: A, qty: 1 }], 5000),
        basketFingerprint([{ variantId: A, qty: 2 }], 10000),
      ),
    ).toBe(false)
  })

  it('separates a changed price on identical lines', () => {
    // The whole point of folding the total in: the customer must be sent to an
    // invoice for the amount they were just shown, not the one from before the
    // price moved.
    expect(
      sameBasket(
        basketFingerprint([{ variantId: A, qty: 1 }], 5000),
        basketFingerprint([{ variantId: A, qty: 1 }], 6000),
      ),
    ).toBe(false)
  })

  it('separates a removed line', () => {
    expect(
      sameBasket(
        basketFingerprint(
          [
            { variantId: A, qty: 1 },
            { variantId: B, qty: 1 },
          ],
          5000,
        ),
        basketFingerprint([{ variantId: A, qty: 1 }], 5000),
      ),
    ).toBe(false)
  })

  it('does not confuse different splits of the same quantity', () => {
    expect(
      sameBasket(
        basketFingerprint(
          [
            { variantId: A, qty: 1 },
            { variantId: B, qty: 11 },
          ],
          5000,
        ),
        basketFingerprint(
          [
            { variantId: A, qty: 11 },
            { variantId: B, qty: 1 },
          ],
          5000,
        ),
      ),
    ).toBe(false)
  })
})
