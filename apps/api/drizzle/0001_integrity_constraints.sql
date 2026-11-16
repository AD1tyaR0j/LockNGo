-- Integrity constraints that Drizzle's schema DSL cannot express.
-- See docs/adr/0003-double-booking-prevention.md.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- No two blocking bookings may hold the same compartment for overlapping time ranges.
-- This is the last line of defence; the booking service also serialises allocation with
-- row locks so that customers get a clean "no availability" error instead of a constraint error.
ALTER TABLE storage_bookings
  ADD CONSTRAINT storage_bookings_no_overlap
  EXCLUDE USING gist (
    compartment_id WITH =,
    tstzrange(starts_at, expires_at, '[)') WITH &&
  )
  WHERE (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'ACCESS_READY', 'ACTIVE', 'DISPUTED'));
--> statement-breakpoint

-- Audit logs and booking events are append-only for the application.
-- In production the application DB role should additionally be granted INSERT/SELECT only.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER booking_events_append_only
  BEFORE UPDATE OR DELETE ON booking_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER booking_events_no_truncate
  BEFORE TRUNCATE ON booking_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
