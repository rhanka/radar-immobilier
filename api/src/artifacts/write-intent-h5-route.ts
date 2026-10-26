import { writeRefusal } from "./write-intent-refusal.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { readPwWriteStatus } from "../services/facets/pw-write-admission-durable.js";
import { loadPwIntentForShare } from "../services/facets/pw-write-store.js";
import { verifyWriteGrant } from "./write-grant.js";
import { assertIdempotencyKey, assertWritePrepareBody } from "./write-intent-schemas.js";
import { hasDuplicateJsonKeys } from "./write-intent-binding.js";
import { canonicalWritePrincipal } from "./write-intent-principal.js";
import { prepareWriteIntent, type PrepareDeps } from "./write-intent-service.js";
import { resolveWritePage, type PageWriteAuthorityDeps } from "./write-intent-page-authority.js";
import type { Database } from "../db/client.js";
import { FacetError } from "../services/facets/target.js";
import { writeIntentError } from "./write-intent-errors.js";
import { projectWriteIntentStatus } from "./write-intent-status.js";
import { assertPwAuthorityOpen } from "../services/facets/pw-write-fences.js";
import { eq, sql } from "drizzle-orm";
import { pwWriteIntents } from "../db/schema-pw-write.js";

export interface H5WriteDeps extends PrepareDeps, PageWriteAuthorityDeps {
  db: Database;
  /** PW-D terminal-refusal reader; no second persistence implementation here. */
  readRejection?: (intentId: string) => Promise<{ code: string } | null>;
}

export function writeIntentH5Route(deps: H5WriteDeps | null): Hono {
  const app = new Hono();
  app.use("/write-intents/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    await next();
  });
  app.use("/write-intents/*", bodyLimit({ maxSize: 16 * 1024,
    onError: (c) => writeRefusal(c, "request_too_large", 413) }));
  app.post("/write-intents/prepare", async (c) => {
    if (!deps) return writeRefusal(c, "write_transport_closed", 503);
    try {
      if (c.req.header("content-encoding") !== undefined) return writeRefusal(c, "unsupported_media_type", 415);
      if ((c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return writeRefusal(c, "unsupported_media_type", 415);
      }
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 16 * 1024) return writeRefusal(c, "request_too_large", 413);
      if (hasDuplicateJsonKeys(raw)) throw new FacetError(400, "invalid_facet_command");
      let body: unknown;
      try { body = JSON.parse(raw); } catch { throw new FacetError(400, "invalid_facet_command"); }
      const key = c.req.header("idempotency-key") ?? "";
      assertIdempotencyKey(key);
      assertWritePrepareBody(body);
      const page = await resolveWritePage(c, deps, (deps.nowMs ?? Date.now)());
      const grant = await verifyWriteGrant(c.req.header("x-preview-write-grant") ?? "",
        page.grant, deps.grantSecret, (deps.nowMs ?? Date.now)());
      if (!grant) throw new FacetError(403, "write_grant_required");
      const prepared = await prepareWriteIntent(deps.db, grant, body, key, page.pageInstanceId,
        { ...deps, authorityReferences: page.authorityReferences,
          authorityExpiresAtMs: Math.min(page.pageExpiresAtMs, page.delegationExpiresAtMs) });
      const { created, ...data } = prepared;
      return c.json({ operation: "facets.write-intents.prepare.v1", reader: { sub: grant.readerSub }, data }, created ? 201 : 200);
    } catch (error) { return writeIntentError(c, error); }
  });
  app.all("/write-intents/prepare", (c) => writeRefusal(c, "method_not_allowed", 405));
  app.get("/write-intents/:intentId", async (c) => {
    if (!deps) return writeRefusal(c, "write_transport_closed", 503);
    try {
      const id = c.req.param("intentId");
      assertIdempotencyKey(id);
      // Poll uses the existing authenticated P, never mints or renews a grant.
      const page = await resolveWritePage(c, deps, (deps.nowMs ?? Date.now)());
      const row = await deps.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        const [observed] = await tx.select().from(pwWriteIntents).where(eq(pwWriteIntents.intentId, id));
        if (!observed) throw new FacetError(404, "write_intent_not_found");
        await assertPwAuthorityOpen(tx, observed.authorityReferences as Record<string, string>);
        const row = await loadPwIntentForShare(tx, id);
        const artifact = row.artifactRef as Record<string, unknown>;
        if (row.pageSessionId !== page.grant.sessionId || row.pageInstanceId !== page.pageInstanceId
          || artifact.artifactId !== page.grant.artifactId
          || artifact.releaseId !== page.grant.releaseId
          || artifact.host !== page.grant.host || artifact.profileName !== page.grant.profileName
          || artifact.profileFingerprint !== page.grant.profileFingerprint
          || artifact.policyRevision !== page.grant.policyRevision) throw new FacetError(403, "write_grant_required");
        return row;
      });
      const status = await readPwWriteStatus(deps.db, id, canonicalWritePrincipal(page.grant), deps.nowMs ?? Date.now);
      const rejection = status.status === "rejected" ? await deps.readRejection?.(id) : undefined;
      const data = await projectWriteIntentStatus(deps.db, row, status.status, rejection);
      return c.json({ operation: "facets.write-intents.status.v1", reader: { sub: page.grant.readerSub }, data });
    } catch (error) { return writeIntentError(c, error); }
  });
  app.all("/write-intents/:intentId", (c) => writeRefusal(c, "method_not_allowed", 405));
  return app;
}
