import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ALICE, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";
import { normalizeHostOutcome } from "../../../packages/artifacts-host/src/host-outcome.js";
import { withArtifactAdvisoryLock } from "../../../packages/artifacts-host/src/idempotency.js";
import { classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";

describe("astra A5 real PostgreSQL pool acquisition", () => {
  let h: Astra;
  beforeAll(async () => { h = await startAstra("pool", 1); });
  afterAll(async () => { await h?.close(); });

  it("should complete an authorized write on a single-connection pool", async () => {
    const { host, control } = await h.openHost();
    try {
      const ensured = await control.handle("ensure", ALICE, { bindingName: "one", idempotencyKey: "one" });
      expect(ensured.status).toBe(201);
      expect(await h.durable()).toMatchObject({ artifacts: 1, receipts: 1, operations: 1 });
    } finally { host.close(); }
  });

  it("should map actual pool saturation through the host dispatch and mapper", async () => {
    const { host } = await h.openHost();
    const held = await h.pool.connect();
    try {
      const outcome = await host.app.execute({ method: "POST", path: "/ensure", actorId: ALICE,
        body: { bindingName: "saturated", idempotencyKey: "saturated" } }, h.invocation(host));
      expect(outcome).toMatchObject({ ok: false, failure: { category: "provider_unavailable",
        httpStatus: 503, retriable: true, publicCode: "capability_unavailable" } });
      let raw: unknown;
      try { await h.pool.connect(); } catch (error) { raw = error; }
      expect(raw).toBeInstanceOf(Error);
      expect((raw as Error).message).toBe("timeout exceeded when trying to connect");
      expect((raw as { code?: unknown }).code).toBeUndefined();
      const mapped = normalizeHostOutcome({ ok: false, failure: classifyArtifactFailure(raw,
        { invocationId: randomUUID(), operation: "ensure", phase: "dispatch", commitState: "not_committed" }) });
      expect(mapped).toMatchObject({ ok: false, failure: { category: "provider_unavailable", httpStatus: 503, retriable: true } });
      await expect(withArtifactAdvisoryLock(h.pool, "0123456789abcdef", async () => 1))
        .rejects.toMatchObject({ code: "artifact_pool_timeout", cause: { message: "timeout exceeded when trying to connect" } });
    } finally { held.release(); host.close(); }
  });
});
