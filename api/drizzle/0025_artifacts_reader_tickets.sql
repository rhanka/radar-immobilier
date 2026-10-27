-- Short-lived, browser-bound, single-use opening tickets shared across API replicas.
CREATE TABLE IF NOT EXISTS artifacts.reader_tickets (
  ticket_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds')
);
CREATE INDEX IF NOT EXISTS reader_tickets_expiry ON artifacts.reader_tickets (expires_at);
