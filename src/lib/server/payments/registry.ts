import { env } from '../env'
import { buildCallbackUrl } from './callback-token'
import { getQpayProvider } from './qpay'
import type { PaymentProvider } from './provider'
import { getStorepayProvider, isStorepayConfigured } from './storepay'

/** Every provider name ever written to payments.provider — keep in sync with
 * checkoutMethod in orders/create.ts, which is what actually reaches here. */
export type ProviderName = 'qpay' | 'storepay'

/**
 * Resolves a payments.provider value (or a checkout method choice) to its
 * PaymentProvider. The one place that knows every provider that exists, so
 * settleOrder, expireCheckout and checkout itself don't each need their own
 * qpay-or-storepay branch.
 */
export function getProvider(name: string): PaymentProvider {
  switch (name) {
    case 'qpay':
      return getQpayProvider()
    case 'storepay':
      return getStorepayProvider()
    default:
      throw new Error(`Unknown payment provider: ${name}`)
  }
}

/**
 * The signed callback URL a provider is told to hit when `orderNo` is paid.
 * Callers must have checked availableProviders() first — that is what
 * guarantees STOREPAY_CALLBACK_SECRET is set.
 */
export function providerCallbackUrl(name: ProviderName, orderNo: string): string {
  return name === 'qpay'
    ? buildCallbackUrl(env.APP_URL, '/api/qpay/callback', orderNo, env.QPAY_CALLBACK_SECRET)
    : buildCallbackUrl(env.APP_URL, '/api/storepay/callback', orderNo, env.STOREPAY_CALLBACK_SECRET!)
}

/** Payment methods checkout may currently offer, in display order. */
export function availableProviders(): ProviderName[] {
  const methods: ProviderName[] = ['qpay']
  if (isStorepayConfigured()) methods.push('storepay')
  return methods
}
