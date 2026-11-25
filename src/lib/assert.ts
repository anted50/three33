/**
 * Assertions: checks on what the code itself guarantees, not on input.
 *
 * A failed assertion means a bug here, so it throws and is never caught to
 * carry on — the request fails loudly instead of acting on data it has not
 * understood. Bad input from a customer or a provider is an operating error
 * and gets a real error (badRequest, conflict, a provider error) instead.
 *
 * Keep each call to one condition, so the failure names the exact one.
 */

export class AssertionError extends Error {
  constructor(message: string) {
    super(`Assertion failed: ${message}`)
    this.name = 'AssertionError'
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message)
}

/** For the `else` of a switch or if-chain over a union that should be exhaustive. */
export function assertNever(value: never, message: string): never {
  throw new AssertionError(`${message}: ${String(value)}`)
}
