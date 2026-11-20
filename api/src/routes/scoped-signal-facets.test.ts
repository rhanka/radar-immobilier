import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { scopedSignalFacetsRoute } from "./scoped-signal-facets.js";
import { assertScopedExpectations } from "../services/facets/scoped-transition.js";
import { FacetError } from "../services/facets/target.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const BASE = `/api/v1/workspaces/${WORKSPACE_ID}/signal-facets/personal`;
const VALID_TARGET = { citySlug: "rawdon", type: "Signal", id: "sig-1" };
const VALID_FP = "a".repeat(64);

function makeApp(db: Partial<Database> = {}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("session" as never, { sub: "user-1" } as never);
    await next();
  });
  app.route("/", scopedSignalFacetsRoute({ db: db as Database, auth: { enabled: true } }));
  return app;
}

describe("scoped signal-facet 400 diagnostic detail (EVO-3)", () => {
  it("should report missing_or_invalid_idempotency_key when Idempotency-Key is absent or malformed", async () => {
    const app = makeApp();
    const resMissing = await app.request(`${BASE}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: VALID_TARGET, basket: "pertinent", expectedHeadId: null, displayedFingerprint: VALID_FP }),
    });
    expect(resMissing.status).toBe(400);
    expect(await resMissing.json()).toEqual({
      error: "invalid_facet_command",
      detail: "missing_or_invalid_idempotency_key",
    });

    const resInvalid = await app.request(`${BASE}/select`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "secret-not-a-uuid" },
      body: JSON.stringify({ target: VALID_TARGET, basket: "pertinent", expectedHeadId: null, displayedFingerprint: VALID_FP }),
    });
    expect(resInvalid.status).toBe(400);
    expect(await resInvalid.json()).toEqual({
      error: "invalid_facet_command",
      detail: "missing_or_invalid_idempotency_key",
    });
  });

  it("should report expected_selection_heads_forbidden_without_deselect on discard without deselect", async () => {
    const app = makeApp();
    const res = await app.request(`${BASE}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        target: VALID_TARGET,
        reasonCode: "NP-HORS-CIBLE",
        expectedHeadId: null,
        expectedSelectionHeads: { pertinent: null, a_surveiller: null },
        displayedFingerprint: VALID_FP,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_facet_command",
      detail: "expected_selection_heads_forbidden_without_deselect",
    });
  });

  it("should report expected_selection_heads_keys_must_match_deselect when keys disagree with deselect", async () => {
    const app = makeApp();
    const resMissingHeads = await app.request(`${BASE}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        target: VALID_TARGET,
        reasonCode: "NP-HORS-CIBLE",
        deselect: ["pertinent"],
        expectedHeadId: null,
        displayedFingerprint: VALID_FP,
      }),
    });
    expect(resMissingHeads.status).toBe(400);
    expect(await resMissingHeads.json()).toEqual({
      error: "invalid_facet_command",
      detail: "expected_selection_heads_keys_must_match_deselect",
    });

    const resMismatch = await app.request(`${BASE}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        target: VALID_TARGET,
        reasonCode: "NP-HORS-CIBLE",
        deselect: ["pertinent"],
        expectedHeadId: null,
        expectedSelectionHeads: { a_surveiller: null },
        displayedFingerprint: VALID_FP,
      }),
    });
    expect(resMismatch.status).toBe(400);
    expect(await resMismatch.json()).toEqual({
      error: "invalid_facet_command",
      detail: "expected_selection_heads_keys_must_match_deselect",
    });
  });

  it("should report sorted field paths without echoing raw input values", async () => {
    const app = makeApp();
    const secret = "sensitive-input-value-should-never-leak";
    const res = await app.request(`${BASE}/select`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        target: VALID_TARGET,
        basket: "pertinent",
        expectedHeadId: null,
        displayedFingerprint: secret,
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string; detail: string };
    expect(json).toEqual({
      error: "invalid_facet_command",
      detail: "invalid_fields:displayedFingerprint",
    });
    expect(JSON.stringify(json)).not.toContain(secret);

    const resReclassify = await app.request(`${BASE}/reclassify`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        target: VALID_TARGET,
        archives: { personal: randomUUID() },
        selectionHeads: { pertinent: null, a_surveiller: null },
        nextClass: "pertinent",
      }),
    });
    expect(resReclassify.status).toBe(400);
    expect(await resReclassify.json()).toEqual({
      error: "invalid_facet_command",
      detail: "invalid_fields:displayedFingerprint",
    });
  });

  it("should serialize FacetError.detail when present and omit it when absent", async () => {
    const appWithDetail = makeApp({
      transaction: async () => {
        throw new FacetError(400, "invalid_facet_command", "historical_receipt_not_found");
      },
    });
    const resHistorical = await appWithDetail.request(`${BASE}/select`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ target: VALID_TARGET, basket: "pertinent" }),
    });
    expect(resHistorical.status).toBe(400);
    expect(await resHistorical.json()).toEqual({
      error: "invalid_facet_command",
      detail: "historical_receipt_not_found",
    });

    const appWithoutDetail = makeApp({
      transaction: async () => {
        throw new FacetError(422, "reason_code_required");
      },
    });
    const res422 = await appWithoutDetail.request(`${BASE}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ target: VALID_TARGET, expectedHeadId: null, displayedFingerprint: VALID_FP }),
    });
    expect(res422.status).toBe(422);
    expect(await res422.json()).toEqual({ error: "reason_code_required" });
  });

  it("should attach sanitized detail on assertScopedExpectations errors", () => {
    expect(() => assertScopedExpectations(
      { action: "discard", expectedSelectionHeads: { pertinent: null } },
      [],
    )).toThrowError(expect.objectContaining({
      status: 400,
      message: "invalid_facet_command",
      detail: "expected_selection_heads_forbidden_without_deselect",
    }));

    expect(() => assertScopedExpectations(
      { action: "discard", expectedSelectionHeads: { a_surveiller: null } },
      ["pertinent"],
    )).toThrowError(expect.objectContaining({
      status: 400,
      message: "invalid_facet_command",
      detail: "expected_selection_heads_keys_must_match_deselect",
    }));

    expect(() => assertScopedExpectations(
      { action: "select", expectedSelectionHeads: { pertinent: null } },
      [],
    )).toThrowError(expect.objectContaining({
      status: 400,
      message: "invalid_facet_command",
      detail: "expected_selection_heads_forbidden_without_deselect",
    }));
  });
});
