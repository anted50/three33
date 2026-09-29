import { z } from 'zod'

/**
 * Response shapes from the StorePay merchant API, per
 * "Стор пэй мерчант системийн API гарын авлага" v3.0.
 *
 * Permissive in the same spirit as the QPay schemas: StorePay sends
 * loan/payment ids that could be numeric or string depending on the endpoint,
 * so those are coerced to string and the rest is ignored rather than 400-ing
 * on an unexpected extra key.
 */

export const storepayTokenResponse = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string().optional(),
  /**
   * Unlike QPay's `expires_in`, StorePay's is documented and observed to be a
   * real duration in seconds (~7200 = 120 minutes), not a UNIX timestamp.
   */
  expires_in: z.coerce.number(),
})
export type StorepayTokenResponse = z.infer<typeof storepayTokenResponse>

const storepayMessage = z.object({
  code: z.string().nullish(),
  text: z.string().nullish(),
  params: z.unknown().nullish(),
})

/**
 * Every StorePay endpoint wraps its payload the same way. `value` differs per
 * endpoint, so callers parse it separately with the right shape.
 */
function storepayEnvelope<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullish(),
    data: z.unknown().nullish(),
    msgList: z.array(storepayMessage).default([]),
    attrs: z.unknown().nullish(),
    status: z.enum(['Success', 'Failed']).catch('Failed'),
  })
}

/** POST /merchant/loan — value is the new loan's id. */
export const storepayCreateLoanResponse = storepayEnvelope(z.coerce.string())
export type StorepayCreateLoanResponse = z.infer<
  typeof storepayCreateLoanResponse
>

const storepayLoanData = z.object({
  loanId: z.coerce.string(),
  status: z.string(),
  amount: z.coerce.number(),
  description: z.string().nullish(),
  storeId: z.coerce.string().nullish(),
  number: z.string().nullish(),
  isExist: z.boolean(),
  isConfirmed: z.boolean(),
})
export type StorepayLoanData = z.infer<typeof storepayLoanData>

/** GET /merchant/loan/check/{loanId} — value is a plain confirmed flag. */
export const storepayCheckByLoanResponse = z.object({
  value: z.boolean().nullish(),
  data: storepayLoanData.nullish(),
  msgList: z.array(storepayMessage).default([]),
  attrs: z.unknown().nullish(),
  status: z.enum(['Success', 'Failed']).catch('Failed'),
})
export type StorepayCheckByLoanResponse = z.infer<
  typeof storepayCheckByLoanResponse
>

/** GET /merchant/loan/checkRequest/{requestId} — value carries the loan id too. */
export const storepayCheckByRequestResponse = z.object({
  value: z
    .object({
      loanId: z.coerce.string().nullish(),
      isExist: z.boolean(),
      isConfirmed: z.boolean(),
    })
    .nullish(),
  data: storepayLoanData.nullish(),
  msgList: z.array(storepayMessage).default([]),
  attrs: z.unknown().nullish(),
  status: z.enum(['Success', 'Failed']).catch('Failed'),
})
export type StorepayCheckByRequestResponse = z.infer<
  typeof storepayCheckByRequestResponse
>

/** POST /merchant/account/cancel — same envelope, boolean value. */
export const storepayCancelResponse = z.object({
  value: z.boolean().nullish(),
  msgList: z.array(storepayMessage).default([]),
  attrs: z.unknown().nullish(),
  status: z.enum(['Success', 'Failed']).catch('Failed'),
})
export type StorepayCancelResponse = z.infer<typeof storepayCancelResponse>
