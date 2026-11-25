/**
 * D1's hard limits that the code has to plan around. No imports, so pure
 * modules can check their own bounds against these without loading the
 * database client.
 */

/**
 * D1 refuses a statement with more than 100 bound parameters ("too many SQL
 * variables"). A multi-row INSERT binds one parameter per column per row, so
 * any insert of a list goes through insertRows (atomic.ts), and any `inArray`
 * list must be bounded below this.
 */
export const D1_BOUND_PARAMETERS_MAX = 100
