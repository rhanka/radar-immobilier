/**
 * Writer probe of the zero-downtime cutover rehearsal (preprod only). Disabled unless
 * CUTOVER_PROBE_ENABLED=true with a 32+ character token (Secret radar-cutover-probe).
 * Each acknowledged write is a row of cutover_probe_writes in the database that acked it;
 * the rehearsal then proves no acked write is missing. Freeze errors become 503 (app.onError).
 */
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

export interface CutoverProbeDeps {
  enabled: boolean;
  token: string;
  db?: Pick<Database, "execute"> | undefined;
}

const RUN = /^[a-z0-9-]{1,64}$/;

function authorized(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function cutoverProbeRoute(deps: CutoverProbeDeps): Hono {
  const app = new Hono();
  const open = deps.enabled && deps.token.length >= 32 && Boolean(deps.db);
  app.post("/api/internal/cutover-probe", async (c) => {
    if (!open || !deps.db) return c.json({ error: "not_found" }, 404);
    if (!authorized(c.req.header("authorization"), deps.token)) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { run?: unknown; seq?: unknown } | null;
    const run = body?.run, seq = body?.seq;
    if (typeof run !== "string" || !RUN.test(run) || !Number.isSafeInteger(seq) || (seq as number) < 0 || (seq as number) > 2_000_000_000) {
      return c.json({ error: "invalid_probe" }, 400);
    }
    const result = await deps.db.execute<{ db: string }>(sql`
      INSERT INTO cutover_probe_writes (run, seq) VALUES (${run}, ${seq as number})
      ON CONFLICT (run, seq) DO UPDATE SET at = cutover_probe_writes.at
      RETURNING current_database() AS db`);
    return c.json({ id: seq, db: result.rows[0]?.db ?? null });
  });
  return app;
}
