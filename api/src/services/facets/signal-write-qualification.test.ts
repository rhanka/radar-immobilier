import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client.js";
import { coordinateSignalWrite, type SignalWriteInput } from "./signal-write-admission.js";
import { assertSignalWriteInput } from "./signal-write-operations.js";
import { toWriteRefusal } from "./signal-write-receipt.js";

const input = {
  operation: "facets.signals.personal.select.v1", workspaceId: "11111111-1111-4111-8111-111111111111",
  target: { citySlug: "demo", type: "Signal", id: "synthetic" }, basket: "pertinent",
  expectedHeadId: null, displayedFingerprint: "a".repeat(64), expectedProjectionToken: "b".repeat(64),
  commandKey: "22222222-2222-4222-8222-222222222222", expiresAtMs: 20_000,
};
describe("PW-B strict contract", () => {
  it("should allow a catalog reason on personal selection", () => {
    expect(() => assertSignalWriteInput({ ...input, reasonCode: "P-POTENTIEL" })).not.toThrow();
  });
  it.each([
    { basket: "pertinent", reasonCode: "N-NON-RES" },
    { basket: undefined, reasonCode: "N-NON-RES", deselect: ["pertinent", "pertinent"] },
    { basket: undefined, reasonCode: "N-NON-RES", deselect: ["pertinent"] },
  ])("should reject invalid composite discard %j", (variant) => {
    expect(() => assertSignalWriteInput({ ...input,
      operation: "facets.signals.personal.discard.v1", ...variant }))
      .toThrowError("invalid_facet_command");
  });
  it("should mask unrecognized internal errors", () => {
    expect(toWriteRefusal(new Error("SQL private detail")))
      .toEqual({ status: 500, code: "internal_error", retryable: false });
  });
  it("should preserve uncertain commit acknowledgement errors without claiming rollback", async () => {
    const acknowledgement = Object.assign(new Error("synthetic commit acknowledgement failure"), { code: "55P03" });
    const db = { transaction: vi.fn().mockRejectedValue(acknowledgement) } as unknown as Database;
    await expect(coordinateSignalWrite(db, "synthetic", input as SignalWriteInput, {} as never))
      .rejects.toBe(acknowledgement);
    expect(toWriteRefusal(acknowledgement))
      .toEqual({ status: 500, code: "internal_error", retryable: false });
  });
});
