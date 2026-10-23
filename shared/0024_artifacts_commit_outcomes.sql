-- A1 technical ledger for typed publication outcomes (CT-4 candidate).
--
-- Candidate file number 0024: reserved 0022/0023 stay with BASE's pinned 6K
-- import. The single integration writer confirms the final number, tag, idx
-- and when, registers the journal entry (CT-5) and freezes the order
-- before first persistent use across the release chain (CT-7). Reservation
-- alone is not migration-order proof. Applied/deployed state is unverified
-- until an operator receipt.
--
-- One row per refused or failed write dispatch, correlated by the
-- server-derived invocation id. Reads are never recorded. No internal cause
-- is stored: only the public reason, status and correlation fields.

CREATE TABLE IF NOT EXISTS artifacts.commit_outcomes (
  invocation_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('ensure', 'publish')),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unauthorized_at_commit', 'admission_unavailable',
    'provider_conflict', 'provider_unavailable', 'provider_error')),
  status INTEGER NOT NULL,
  at_ms BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invocation_id, op)
);

CREATE INDEX IF NOT EXISTS commit_outcomes_by_actor
  ON artifacts.commit_outcomes (actor_id, at_ms);
