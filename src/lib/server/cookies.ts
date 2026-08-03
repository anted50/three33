/**
 * Matches the options bag TanStack Start's setCookie accepts. Declared locally
 * because the package does not export the type.
 */
interface CookieOptions {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  path?: string
  secure?: boolean
  maxAge?: number
}

/**
 * Cookie names and their security attributes, in one place.
 *
 * TanStack Start's getCookie/setCookie do the serialising; what matters here is
 * that nothing sets a cookie with weaker attributes by forgetting an option.
 * Import these rather than passing options inline.
 */

export const SESSION_COOKIE = 'uc_session'
export const CART_COOKIE = 'uc_cart'

/** 30 days, matching the session row's TTL. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

/** Guest carts outlive a browsing session but not forever. */
export const CART_MAX_AGE = 60 * 60 * 24 * 30

/**
 * SameSite=Lax rather than Strict: QPay sends the customer to a bank app and
 * back, and Strict would drop the cart cookie on that cross-site return —
 * the customer would come back from paying to an empty cart.
 */
const base: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
}

export const sessionCookieOptions: CookieOptions = {
  ...base,
  maxAge: SESSION_MAX_AGE,
}

export const cartCookieOptions: CookieOptions = {
  ...base,
  maxAge: CART_MAX_AGE,
}
