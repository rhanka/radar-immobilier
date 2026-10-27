import { describe, expect, it } from "vitest";
import {
  buildWorkspaceArchiveBody,
  effectiveWorkspaceHiding,
  explainWorkspaceHiding,
  WorkspaceArchiveClientError,
} from "./signal-facet-workspace.js";

const fingerprint = "a".repeat(64);
const headId = "123e4567-e89b-12d3-a456-426614174000";
const target = { citySlug: "synthetic-city", type: "Signal" as const, id: "native-id" };

describe("6I workspace archive intentions", () => {
  it("should explain effective hiding per scope without naming another member", () => {
    const active = { id: headId, state: "active", reasonCode: "N-NON-RES",
      targetAvailable: true, changedSinceArchive: false };
    const inactive = { ...active, state: "inactive" };
    expect(effectiveWorkspaceHiding({ personal: null, workspace: null })).toBe(false);
    expect(explainWorkspaceHiding({ personal: null, workspace: null })).toBe("visible");
    expect(explainWorkspaceHiding({ personal: active, workspace: null }))
      .toBe("hidden-by-personal");
    expect(explainWorkspaceHiding({ personal: inactive, workspace: active }))
      .toBe("hidden-by-workspace");
    expect(explainWorkspaceHiding({ personal: active, workspace: active }))
      .toBe("hidden-by-both");
    expect(effectiveWorkspaceHiding({ personal: inactive, workspace: active })).toBe(true);
  });

  it("should build explicit workspace bodies without actor or default heads", () => {
    expect(buildWorkspaceArchiveBody("discard", { target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint }))
      .toEqual({ target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint });
    expect(buildWorkspaceArchiveBody("restore", { target,
      expectedHeadId: headId, displayedFingerprint: fingerprint }))
      .toEqual({ target, expectedHeadId: headId, displayedFingerprint: fingerprint });
    expect(() => buildWorkspaceArchiveBody("discard", { target,
      expectedHeadId: null, displayedFingerprint: fingerprint }))
      .toThrow(WorkspaceArchiveClientError);
    expect(() => buildWorkspaceArchiveBody("restore", { target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint }))
      .toThrow(WorkspaceArchiveClientError);
    expect(() => buildWorkspaceArchiveBody("discard", { target, reasonCode: "N-NON-RES",
      expectedHeadId: "not-a-head", displayedFingerprint: fingerprint }))
      .toThrow(WorkspaceArchiveClientError);
  });
});
