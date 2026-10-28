// PW-A PWA-02: strict prepare/status shapes, typed refusals.
import { describe, expect, it } from "vitest";
import { assertIdempotencyKey, assertWritePrepareBody } from "./write-intent-schemas.js";

const BASE = {
  operation: "facets.signals.personal.select.v1",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  target: { citySlug: "demo-town", type: "Signal", id: "synthetic-signal-01" },
  expectedHeadId: null,
  displayedFingerprint: "a".repeat(64),
  expectedProjectionToken: "b".repeat(64),
  basket: "pertinent",
};

describe("write prepare schemas", () => {
  it("should preserve Unicode without accepting invalid surrogate sequences", () => {
    for (const id of ["signal-é", "signal-e\u0301", "signal-🏠"]) {
      expect(() => assertWritePrepareBody({ ...BASE, target: { ...BASE.target, id } })).not.toThrow();
    }
    expect(() => assertWritePrepareBody({ ...BASE, target: { ...BASE.target, id: "\ud800" } }))
      .toThrowError("invalid_facet_command");
  });
  it("should accept the six closed shapes and refuse unknown fields", () => {
    expect(() => assertWritePrepareBody(BASE)).not.toThrow();
    expect(() => assertWritePrepareBody({
      ...BASE, operation: "facets.signals.workspace.restore.v1",
      basket: undefined,
    })).not.toThrow();
    expect(() => assertWritePrepareBody({ ...BASE, actorId: "forged" })).toThrow();
    expect(() => assertWritePrepareBody({ ...BASE, basket: "unknown" })).toThrow();
    expect(() => assertWritePrepareBody({
      ...BASE, operation: "facets.signals.workspace.discard.v1",
      basket: "pertinent", reasonCode: "N-NON-RES",
    })).toThrow();
  });

  it("should require exactly the expected heads for the explicit removal set", () => {
    const discard = { ...BASE, operation: "facets.signals.personal.discard.v1", basket: undefined,
      reasonCode: "N-NON-RES", deselect: ["pertinent"], expectedSelectionHeads: { pertinent: null } };
    expect(() => assertWritePrepareBody(discard)).not.toThrow();
    for (const patch of [{ expectedSelectionHeads: undefined }, { expectedSelectionHeads: null },
      { expectedSelectionHeads: { extra: null } }, { expectedSelectionHeads: { pertinent: "invalid" } },
      { deselect: ["pertinent", "pertinent"] }, { commandKey: "forged" }, { expiresAtMs: 0 }]) {
      expect(() => assertWritePrepareBody({ ...discard, ...patch })).toThrowError("invalid_facet_command");
    }
  });

  it("should require reason codes with 422 and UUID keys with 400", () => {
    expect(() => assertWritePrepareBody({
      ...BASE, operation: "facets.signals.personal.discard.v1",
      basket: undefined,
    })).toThrowError("reason_code_required");
    expect(() => assertIdempotencyKey("22222222-2222-4222-8222-222222222222")).not.toThrow();
    expect(() => assertIdempotencyKey("not-a-uuid")).toThrowError("invalid_idempotency_key");
  });
});
