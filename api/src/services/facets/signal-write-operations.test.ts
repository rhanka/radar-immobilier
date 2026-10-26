// PW-B operation shapes: pure validation, digests, window, refusal codes.
// No database, no network, no environment.
import { describe, expect, it } from "vitest";
import { FacetError } from "./target.js";
import { ScopeError } from "./scope.js";
import { WorkspaceError } from "../workspaces/types.js";
import {
  assertAdmissionWindow,
  assertSignalWriteInput,
  isPersonalOperation,
  signalWriteOperationDigest,
  type SignalWriteInput,
} from "./signal-write-operations.js";
import { toWriteRefusal } from "./signal-write-receipt.js";

const FINGERPRINT = "a".repeat(64);
const TOKEN = "b".repeat(64);

function selectInput(overrides: Partial<SignalWriteInput> = {}): SignalWriteInput {
  return {
    operation: "facets.signals.personal.select.v1",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    target: { citySlug: "demo-town", type: "Signal", id: "synthetic-signal-01" },
    basket: "pertinent",
    expectedHeadId: null,
    displayedFingerprint: FINGERPRINT,
    expectedProjectionToken: TOKEN,
    commandKey: "22222222-2222-4222-8222-222222222222",
    expiresAtMs: 9_999_999_999_999,
    ...overrides,
  };
}

describe("signal write operations", () => {
  it("should accept the six closed operations with their exact shapes", () => {
    const base = selectInput();
    expect(() => assertSignalWriteInput(base)).not.toThrow();
    expect(isPersonalOperation(base.operation)).toBe(true);
    expect(isPersonalOperation("facets.signals.workspace.discard.v1")).toBe(false);
    expect(() => assertSignalWriteInput({
      ...base, operation: "facets.signals.workspace.restore.v1",
      basket: undefined, expectedHeadId: base.expectedHeadId,
    })).not.toThrow();
    expect(() => assertSignalWriteInput({
      ...base, operation: "facets.signals.personal.discard.v1",
      reasonCode: "N-NON-RES", basket: undefined,
    })).not.toThrow();
  });

  it("should refuse unknown fields, bad identifiers, and mixed scopes", () => {
    expect(() => assertSignalWriteInput(selectInput({ basket: "unknown" as never })))
      .toThrowError("invalid_facet_command");
    expect(() => assertSignalWriteInput(selectInput({ displayedFingerprint: "short" })))
      .toThrowError("invalid_facet_command");
    expect(() => assertSignalWriteInput(selectInput({ expectedProjectionToken: TOKEN.toUpperCase() })))
      .toThrowError("invalid_facet_command");
    expect(() => assertSignalWriteInput({
      ...selectInput(), operation: "facets.signals.workspace.discard.v1", basket: "pertinent",
    })).toThrowError("invalid_facet_command");
    expect(() => assertSignalWriteInput({
      ...selectInput(), operation: "facets.signals.personal.restore.v1", basket: "pertinent",
    })).toThrowError("invalid_facet_command");
    expect(() => assertSignalWriteInput(
      { ...selectInput(), actorId: "forged" } as unknown as SignalWriteInput))
      .toThrowError("invalid_facet_command");
  });

  it("should digest deterministically and cover deselect order and token", () => {
    const first = signalWriteOperationDigest(selectInput());
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(signalWriteOperationDigest(selectInput())).toBe(first);
    const discard = (deselect: SignalWriteInput["deselect"]): SignalWriteInput => ({
      ...selectInput(), operation: "facets.signals.personal.discard.v1",
      basket: undefined, reasonCode: "N-NON-RES", deselect,
      expectedSelectionHeads: { pertinent: null, a_surveiller: null },
    });
    expect(signalWriteOperationDigest(discard(["pertinent", "a_surveiller"])))
      .toBe(signalWriteOperationDigest(discard(["a_surveiller", "pertinent"])));
    expect(signalWriteOperationDigest(selectInput({ expectedProjectionToken: "c".repeat(64) })))
      .not.toBe(first);
  });

  it("should enforce the admission window without extending it", () => {
    expect(() => assertAdmissionWindow(1_000, 2_000)).not.toThrow();
    expect(() => assertAdmissionWindow(2_001, 2_000))
      .toThrowError("challenge_expired");
  });

  it("should map BASE refusals to the closed PW codes", () => {
    expect(toWriteRefusal(new FacetError(409, "facet_head_conflict")))
      .toEqual({ status: 409, code: "facet_head_conflict", retryable: false });
    expect(toWriteRefusal(new FacetError(409, "target_version_conflict")))
      .toEqual({ status: 409, code: "facet_target_version_conflict", retryable: false });
    expect(toWriteRefusal(new FacetError(409, "projection_revision_conflict")))
      .toEqual({ status: 409, code: "projection_revision_conflict", retryable: false });
    expect(toWriteRefusal(new ScopeError(503, "scoped_facet_scope_unavailable:ws")))
      .toEqual({ status: 503, code: "signal_capability_unavailable", retryable: false });
    expect(toWriteRefusal(new ScopeError(503, "projection_revision_unstable")))
      .toEqual({ status: 503, code: "projection_revision_unstable", retryable: true });
    expect(toWriteRefusal(new WorkspaceError(403, "workspace_membership_required")))
      .toEqual({ status: 403, code: "workspace_not_authorized", retryable: false });
    expect(toWriteRefusal(new Error("boom")).code).toBe("internal_error");
  });
});
