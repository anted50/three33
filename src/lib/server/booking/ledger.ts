import { barberLedger, type PaymentMethod } from '~/db/schema'
import type { Tx } from './db'
import { splitPayment } from './ledger-split'
import { requireTerms } from './terms'

/**
 * Writes the barber_ledger rows for one paid POS payment, inside the same
 * transaction that marked it paid — the money and its accounting land
 * together or not at all. The unique index on (sale_payment_id, kind) makes a
 * second attempt fail instead of double-crediting.
 */
export async function creditSalePayment(
  tx: Tx,
  input: { barberId: string; salePaymentId: string; method: PaymentMethod; amount: number; actorId: string | null },
) {
  const terms = await requireTerms(input.barberId, tx)
  const lines = splitPayment(input.method, input.amount, terms.serviceCutBps)
  await tx.insert(barberLedger).values(
    lines.map((line) => ({
      ...line,
      barberId: input.barberId,
      salePaymentId: input.salePaymentId,
      actorId: input.actorId,
    })),
  )
}
