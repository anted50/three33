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

-- No two appointments overlap. Pending holds count (nobody can take a time
-- someone else is paying for); cancelled ones don't. Ranges are half-open,
-- [starts_at, ends_at): back-to-back bookings are fine.
CREATE TRIGGER `appointments_no_overlap_insert` BEFORE INSERT ON `appointments`
WHEN NEW.status <> 'cancelled' AND EXISTS (
  SELECT 1 FROM `appointments` a
  WHERE a.status <> 'cancelled'
    AND a.starts_at < NEW.ends_at
    AND NEW.starts_at < a.ends_at
)
BEGIN
  SELECT RAISE(ABORT, 'appointments_no_overlap');
END;--> statement-breakpoint

CREATE TRIGGER `appointments_no_overlap_update`
BEFORE UPDATE OF starts_at, ends_at, status ON `appointments`
WHEN NEW.status <> 'cancelled' AND EXISTS (
  SELECT 1 FROM `appointments` a
  WHERE a.id <> NEW.id
    AND a.status <> 'cancelled'
    AND a.starts_at < NEW.ends_at
    AND NEW.starts_at < a.ends_at
)
BEGIN
  SELECT RAISE(ABORT, 'appointments_no_overlap');
END;--> statement-breakpoint

-- Availability windows never overlap each other. Same half-open ranges.
CREATE TRIGGER `availability_no_overlap_insert` BEFORE INSERT ON `availability`
WHEN EXISTS (
  SELECT 1 FROM `availability` w
  WHERE w.starts_at < NEW.ends_at
    AND NEW.starts_at < w.ends_at
)
BEGIN
  SELECT RAISE(ABORT, 'availability_no_overlap');
END;--> statement-breakpoint

CREATE TRIGGER `availability_no_overlap_update`
BEFORE UPDATE OF starts_at, ends_at ON `availability`
WHEN EXISTS (
  SELECT 1 FROM `availability` w
  WHERE w.id <> NEW.id
    AND w.starts_at < NEW.ends_at
    AND NEW.starts_at < w.ends_at
)
BEGIN
  SELECT RAISE(ABORT, 'availability_no_overlap');
END;
