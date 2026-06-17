-- Migration 0006: auditable account status transitions.
--
-- Adds the suspended account status and an append-only transition log. The log
-- records actor, timestamp, target status and reason for admin decisions without
-- overloading approved_at for rejected/suspended accounts.

--> statement-breakpoint
ALTER TABLE account_users
  DROP CONSTRAINT IF EXISTS account_users_status_check;
--> statement-breakpoint
ALTER TABLE account_users
  ADD CONSTRAINT account_users_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));

--> statement-breakpoint
CREATE TABLE account_user_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL REFERENCES account_users(sub) ON DELETE RESTRICT,
  from_status TEXT CHECK (
    from_status IS NULL
    OR from_status IN ('pending', 'approved', 'rejected', 'suspended')
  ),
  to_status TEXT NOT NULL CHECK (
    to_status IN ('pending', 'approved', 'rejected', 'suspended')
  ),
  actor_sub TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX account_user_status_events_user_idx
  ON account_user_status_events(user_sub);
--> statement-breakpoint
CREATE INDEX account_user_status_events_actor_idx
  ON account_user_status_events(actor_sub);
--> statement-breakpoint
CREATE INDEX account_user_status_events_created_at_idx
  ON account_user_status_events(created_at);
