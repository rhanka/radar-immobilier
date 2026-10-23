import { describe, expect, it } from "vitest";
import {
  LOT_BATCH_MAX,
  STATUS_TOOL_NAMES,
  validateCommandKey,
  validateLotBatchShape,
  validateNoSignalBatch,
  validateSignalCommand,
} from "./command-contracts.js";

const FINGERPRINT = "a".repeat(64);
const HEAD = "11111111-2222-4333-8444-555555555555";
const WORKSPACE = "11111111-2222-4333-8444-555555555555";

describe("status command contracts", () => {
  it("freezes the six tool names without a signal batch", () => {
    expect(STATUS_TOOL_NAMES).toHaveLength(6);
    expect(STATUS_TOOL_NAMES).toContain("command_signal_facet");
    expect(STATUS_TOOL_NAMES).toContain("batch_lot_facet_commands");
    expect(validateNoSignalBatch("batch_signal_facet_commands")).toBe("signal_batch_unsupported");
    expect(validateNoSignalBatch("batch_lot_facet_commands")).toBeNull();
  });

  it("validates UUID command keys for idempotency", () => {
    expect(validateCommandKey(HEAD)).toBeNull();
    expect(validateCommandKey("not-a-uuid")).toBe("command_key_malformed");
    expect(validateCommandKey(null)).toBe("command_key_malformed");
  });

  it("checks signal expectations before any no-op handling", () => {
    expect(
      validateSignalCommand(
        { target: { citySlug: "longueuil", type: "Signal", id: "s1" }, expectedHeadId: HEAD, displayedFingerprint: FINGERPRINT, basket: "pertinent" },
        "select",
      ),
    ).toBeNull();
    expect(
      validateSignalCommand(
        { target: { citySlug: "longueuil", type: "Signal", id: "s1" }, expectedHeadId: HEAD, displayedFingerprint: FINGERPRINT, expectedSelectionHeads: { pertinent: HEAD } },
        "restore",
      ),
    ).toBe("expectations_mismatch");
    expect(
      validateSignalCommand(
        { target: { citySlug: "longueuil", type: "DesignationEvent", id: "s1" }, expectedHeadId: HEAD, displayedFingerprint: FINGERPRINT, deselect: ["pertinent"], expectedSelectionHeads: { a_surveiller: HEAD } },
        "discard",
      ),
    ).toBe("expectations_mismatch");
    expect(
      validateSignalCommand(
        { target: { citySlug: "longueuil", type: "Signal", id: "s1" }, expectedHeadId: "bad", displayedFingerprint: FINGERPRINT },
        "restore",
      ),
    ).toBe("head_malformed");
    expect(
      validateSignalCommand(
        { target: { citySlug: "longueuil", type: "Signal", id: "s1" }, expectedHeadId: HEAD, displayedFingerprint: "short" },
        "restore",
      ),
    ).toBe("fingerprint_malformed");
  });

  it("bounds lot batches to 1-500 distinct targets in one context", () => {
    const one = [{ citySlug: "longueuil", canonicalId: "L1" }];
    const ctx = [{ workspaceId: WORKSPACE, scope: "common", mode: "real" }];
    expect(validateLotBatchShape(one, ctx)).toBeNull();
    expect(validateLotBatchShape([], [])).toBe("batch_out_of_bounds");
    const dup = [one[0]!, one[0]!];
    expect(validateLotBatchShape(dup, [ctx[0]!, ctx[0]!])).toBe("batch_duplicate_target");
    const mixed = [{ workspaceId: WORKSPACE, scope: "common", mode: "real" }, { workspaceId: WORKSPACE, scope: "personal", mode: "real" }];
    expect(validateLotBatchShape(one.concat(one.map((i) => ({ ...i, canonicalId: "L2" }))), mixed)).toBe(
      "batch_mixed_context",
    );
    expect(LOT_BATCH_MAX).toBe(500);
  });
});
