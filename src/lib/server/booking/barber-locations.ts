import { and, eq, gt, inArray, notInArray } from 'drizzle-orm'
import { db } from '~/db'
import { barberLocations, barberShifts, locations, services } from '~/db/schema'
import { badRequest, conflict, forbidden } from '../api/errors'
import type { Executor } from './db'

/**
 * Where each barber may work. The owner sets it; services and shifts can only
 * be placed at these locations.
 */

export async function locationIdsOf(barberId: string, ex: Executor = db): Promise<string[]> {
  const rows = await ex
    .select({ locationId: barberLocations.locationId })
    .from(barberLocations)
    .where(eq(barberLocations.barberId, barberId))
  return rows.map((r) => r.locationId)
}

export async function assertWorksAt(barberId: string, locationIds: string[], ex: Executor = db) {
  const allowed = new Set(await locationIdsOf(barberId, ex))
  const missing = [...new Set(locationIds)].filter((id) => !allowed.has(id))
  if (missing.length > 0) {
    throw forbidden(`Not assigned to location(s): ${missing.join(', ')}`)
  }
}

/**
 * Replaces the set. Removing a location the barber still has active services
 * or future shifts at is refused — the owner is told what is in the way
 * rather than those being deleted silently.
 */
export async function setLocations(barberId: string, locationIds: string[], ex: Executor) {
  const wanted = [...new Set(locationIds)]
  if (wanted.length === 0) throw badRequest('A barber needs at least one location')

  const found = await ex.select({ id: locations.id }).from(locations).where(inArray(locations.id, wanted))
  if (found.length !== wanted.length) throw badRequest('Unknown location id')

  const removed = (await locationIdsOf(barberId, ex)).filter((id) => !wanted.includes(id))
  if (removed.length > 0) await assertNothingAt(barberId, removed, ex)

  await ex
    .delete(barberLocations)
    .where(and(eq(barberLocations.barberId, barberId), notInArray(barberLocations.locationId, wanted)))
  await ex
    .insert(barberLocations)
    .values(wanted.map((locationId) => ({ barberId, locationId })))
    .onConflictDoNothing()
  return wanted
}

async function assertNothingAt(barberId: string, locationIds: string[], ex: Executor) {
  const [service] = await ex
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.barberId, barberId), inArray(services.locationId, locationIds), eq(services.isActive, true)))
    .limit(1)
  const [shift] = await ex
    .select({ id: barberShifts.id })
    .from(barberShifts)
    .where(and(eq(barberShifts.barberId, barberId), inArray(barberShifts.locationId, locationIds), gt(barberShifts.endsAt, new Date())))
    .limit(1)
  if (service || shift) {
    throw conflict(
      'LOCATION_IN_USE',
      'The barber still has active services or upcoming shifts there; deactivate or move them first',
    )
  }
}

/** setLocations in its own transaction, for the owner's PUT. */
export function replaceLocations(barberId: string, locationIds: string[]) {
  return db.transaction((tx) => setLocations(barberId, locationIds, tx))
}
