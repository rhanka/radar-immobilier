-- Zero-downtime cutover writer probe (preprod rehearsal only; the route stays disabled unless
-- CUTOVER_PROBE_ENABLED=true). One row per acknowledged probe write: lost = acked, absent.
CREATE TABLE IF NOT EXISTS "cutover_probe_writes" (
  "run" text NOT NULL,
  "seq" integer NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cutover_probe_writes_pkey" PRIMARY KEY ("run", "seq")
);
