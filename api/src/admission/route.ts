// Lot I1 — preprod ingest webhook + prod mutation push helper.
//
// The webhook authenticates by Ed25519 signature alone (prod holds no preprod
// session): it is public-path (see PUBLIC_PREFIXES in routes/auth.ts) and
// fail-closed — 503 unless the sync is enabled with at least one prod public
// key. Invalid signatures are rejected; valid snapshots apply idempotently.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { KeyObject } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accountUsers } from "../db/schema.js";
import {
  buildAdmissionSnapshot,
  signSnapshot,
  SnapshotRejectedError,
} from "./snapshot.js";
import { applyAdmissionSnapshot, readAdmissionSourceRows } from "./ingest.js";

export interface AdmissionRouteDeps {
  db: Database;
  enabled: boolean;
  publicKeys: Map<string, KeyObject>;
  now?: () => number;
}

export function admissionRoute(deps: AdmissionRouteDeps): Hono {
  const app = new Hono();
  app.post("/api/v1/admission/ingest", bodyLimit({ maxSize: 262_144 }), async (c) => {
    if (!deps.enabled || deps.publicKeys.size === 0) {
      return c.json({ error: "admission_sync_disabled" }, 503);
    }
    let envelope: unknown;
    try {
      envelope = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    try {
      const result = await applyAdmissionSnapshot(deps.db, envelope, {
        publicKeys: deps.publicKeys,
        ...(deps.now ? { now: deps.now } : {}),
      });
      return c.json({ ok: true, ...result }, 200);
    } catch (error) {
      if (error instanceof SnapshotRejectedError) {
        return c.json({ error: "admission_invalid_signature", reason: error.reason }, 401);
      }
      throw error;
    }
  });
  return app;
}

export interface MutationPushDeps {
  db: Database;
  kid: string;
  key: KeyObject;
  pushUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface MutationPushResult {
  pushed: boolean;
  reason?: string;
}

/**
 * Prod-side mutation emission: build a signed incremental snapshot for one
 * account and push it to the preprod webhook. Best-effort by contract — the
 * periodic full snapshot converges regardless — so failures resolve to
 * `{ pushed: false }` and never break the admin action. No prod business
 * content is included (identity fields only).
 */
export async function pushAdmissionMutation(
  deps: MutationPushDeps,
  targetSub: string,
): Promise<MutationPushResult> {
  if (deps.pushUrl === "") return { pushed: false, reason: "push_disabled" };
  const rows = await deps.db
    .select({
      email: accountUsers.email,
      name: accountUsers.name,
      status: accountUsers.status,
      isAdmin: accountUsers.isAdmin,
      createdAt: accountUsers.createdAt,
      approvedAt: accountUsers.approvedAt,
    })
    .from(accountUsers)
    .where(eq(accountUsers.sub, targetSub))
    .limit(1);
  if (rows.length === 0) return { pushed: false, reason: "unknown_account" };
  const payload = buildAdmissionSnapshot(rows, {
    kid: deps.kid,
    issuedAt: new Date(deps.now?.() ?? Date.now()),
    full: false,
  });
  if (payload.entries.length === 0) return { pushed: false, reason: "no_mailable_entry" };
  const envelope = signSnapshot(payload, deps.key);
  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(deps.pushUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
  } catch {
    return { pushed: false, reason: "push_failed" };
  }
  if (!response.ok) return { pushed: false, reason: "push_refused" };
  return { pushed: true };
}

export async function readAllAdmissionSourceRows(db: Database) {
  return readAdmissionSourceRows(db);
}
