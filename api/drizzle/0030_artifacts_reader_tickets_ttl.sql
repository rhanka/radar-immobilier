-- Reader opening window: the 60 s ticket TTL expired before late approvals
-- (tab opened from a Claude link, approved minutes later). Align the DB
-- default with the 10-minute browser-binding/approval window; security is
-- unchanged (still single-use, browser-bound, authority reread at exchange).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE artifacts.reader_tickets ALTER COLUMN expires_at SET DEFAULT (now() + interval '600 seconds');
