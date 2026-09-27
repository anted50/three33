import { and, desc, eq, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db'
import { barberTerms } from '~/db/schema'
import { conflict } from '../api/errors'
import { isoDate, mungu } from '../api/input'
import type { Executor } from './db'

/**
 * The owner–barber deal, versioned: a change is a new row, the terms in force
 * are the latest effective_from <= now. Owner-only to write.
 */

const bps = z.number().int().min(0).max(10_000)

export const termsInput = z
  .object({
    /** Shop's cut of service payments, basis points: 3000 = 30%. */
    serviceCutBps: bps,
    /** Barber's commission on product sales they ring up. */
    productCommissionBps: bps.default(0),
    rentAmount: mungu.default(0),
    rentPeriod: z.enum(['weekly', 'biweekly', 'monthly']).nullish(),
    rentStartsOn: isoDate.nullish(),
    /** Defaults to now. */
    effectiveFrom: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((t) => t.rentAmount === 0 || (t.rentPeriod && t.rentStartsOn), {
    message: 'Rent needs rentPeriod and rentStartsOn',
    path: ['rentPeriod'],
  })

export type TermsInput = z.infer<typeof termsInput>

export async function currentTerms(barberId: string, at = new Date(), ex: Executor = db) {
  const [row] = await ex
    .select()
    .from(barberTerms)
    .where(and(eq(barberTerms.barberId, barberId), lte(barberTerms.effectiveFrom, at)))
    .orderBy(desc(barberTerms.effectiveFrom))
    .limit(1)
  return row ?? null
}

/** Money can't be split without terms; every barber is created with some. */
export async function requireTerms(barberId: string, ex: Executor) {
  const terms = await currentTerms(barberId, new Date(), ex)
  if (!terms) throw conflict('NO_TERMS', 'The owner has not set terms for this barber yet')
  return terms
}

export async function addTerms(
  barberId: string,
  input: TermsInput,
  createdBy: string,
  ex: Executor = db,
) {
  const [row] = await ex
    .insert(barberTerms)
    .values({
      barberId,
      serviceCutBps: input.serviceCutBps,
      productCommissionBps: input.productCommissionBps,
      rentAmount: input.rentAmount,
      rentPeriod: input.rentAmount > 0 ? input.rentPeriod : null,
      rentStartsOn: input.rentAmount > 0 ? input.rentStartsOn : null,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
      createdBy,
    })
    .returning()
  return row!
}
