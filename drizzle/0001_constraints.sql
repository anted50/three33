-- Hand-written: rules the schema builder cannot express. Each one is a
-- trigger that aborts with a stable message, which src/lib/server/api/db-errors.ts
-- maps to an API error code.

-- batch_guards: every insert aborts with the inserted code as the message.
-- This is how a D1 batch re-checks a condition and stops — see
-- src/db/atomic.ts (guard).
CREATE TRIGGER `batch_guards_abort` BEFORE INSERT ON `batch_guards`
BEGIN
  SELECT RAISE(ABORT, NEW.code);
END;--> statement-breakpoint

-- A barber can't have two appointments overlapping, buffer included. Pending
-- holds count (nobody can take a slot someone is paying for); cancelled ones
-- don't. Ranges are half-open, [starts_at, blocked_until), exactly as the
-- Postgres EXCLUDE constraint's tstzrange was: back-to-back bookings are fine.
CREATE TRIGGER `appointments_no_overlap_insert` BEFORE INSERT ON `appointments`
WHEN NEW.status <> 'cancelled' AND EXISTS (
  SELECT 1 FROM `appointments` a
  WHERE a.barber_id = NEW.barber_id
    AND a.status <> 'cancelled'
    AND a.starts_at < NEW.blocked_until
    AND NEW.starts_at < a.blocked_until
)
BEGIN
  SELECT RAISE(ABORT, 'appointments_no_overlap');
END;--> statement-breakpoint

CREATE TRIGGER `appointments_no_overlap_update`
BEFORE UPDATE OF barber_id, starts_at, blocked_until, status ON `appointments`
WHEN NEW.status <> 'cancelled' AND EXISTS (
  SELECT 1 FROM `appointments` a
  WHERE a.barber_id = NEW.barber_id
    AND a.id <> NEW.id
    AND a.status <> 'cancelled'
    AND a.starts_at < NEW.blocked_until
    AND NEW.starts_at < a.blocked_until
)
BEGIN
  SELECT RAISE(ABORT, 'appointments_no_overlap');
END;--> statement-breakpoint

-- A barber's shifts never overlap each other. Same half-open ranges.
CREATE TRIGGER `barber_shifts_no_overlap_insert` BEFORE INSERT ON `barber_shifts`
WHEN EXISTS (
  SELECT 1 FROM `barber_shifts` s
  WHERE s.barber_id = NEW.barber_id
    AND s.starts_at < NEW.ends_at
    AND NEW.starts_at < s.ends_at
)
BEGIN
  SELECT RAISE(ABORT, 'barber_shifts_no_overlap');
END;--> statement-breakpoint

CREATE TRIGGER `barber_shifts_no_overlap_update`
BEFORE UPDATE OF barber_id, starts_at, ends_at ON `barber_shifts`
WHEN EXISTS (
  SELECT 1 FROM `barber_shifts` s
  WHERE s.barber_id = NEW.barber_id
    AND s.id <> NEW.id
    AND s.starts_at < NEW.ends_at
    AND NEW.starts_at < s.ends_at
)
BEGIN
  SELECT RAISE(ABORT, 'barber_shifts_no_overlap');
END;
