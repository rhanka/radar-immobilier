/**
 * 6L1 token composition: the token depends only on the listed authorized
 * components. Same content with different timestamps yields the same
 * token; any authorized component moves it.
 */
import { describe, expect, it } from "vitest";
import {
  projectionToken,
  sourceContentDigest,
  type ProjectionScope,
} from "./projection-scope.js";

const scope: ProjectionScope = {
  workspaceId: "11111111-1111-1111-1111-111111111111",
  accountId: "22222222-2222-2222-2222-222222222222",
  citySlug: "synthetic-city",
  mode: "signal",
  personalRevision: 3,
  workspaceRevision: 1,
  sourceRevision: 7,
  sourceDigest: "digest-a",
  membershipRevision: 2,
  moderateArchive: true,
  manageMembers: false,
};

function changed(partial: Partial<ProjectionScope>): string {
  return projectionToken({ ...scope, ...partial });
}

describe("projectionToken", () => {
  it("is stable for identical authorized content", () => {
    expect(projectionToken({ ...scope })).toBe(projectionToken({ ...scope }));
  });

  it("ignores identifier casing but nothing else", () => {
    expect(changed({ workspaceId: scope.workspaceId.toUpperCase() }))
      .toBe(projectionToken(scope));
  });

  it("moves on every authorized component", () => {
    const base = projectionToken(scope);
    expect(changed({ personalRevision: 4 })).not.toBe(base);
    expect(changed({ workspaceRevision: 2 })).not.toBe(base);
    expect(changed({ sourceRevision: 8 })).not.toBe(base);
    expect(changed({ sourceDigest: "digest-b" })).not.toBe(base);
    expect(changed({ membershipRevision: 3 })).not.toBe(base);
    expect(changed({ moderateArchive: false })).not.toBe(base);
    expect(changed({ manageMembers: true })).not.toBe(base);
    expect(changed({ accountId: "33333333-3333-3333-3333-333333333333" })).not.toBe(base);
    expect(changed({ citySlug: "other-city" })).not.toBe(base);
  });
});

describe("sourceContentDigest", () => {
  const row = { id: "native-id", type: "Signal", label: "l", sourceRef: "s3://x", props: { a: 1 } };

  it("is order-insensitive and ignores community fields", () => {
    const left = sourceContentDigest([row, { ...row, label: "m" }]);
    const right = sourceContentDigest([{ ...row, label: "m" }, row]);
    expect(left).toBe(right);
    const communityOnly = sourceContentDigest([
      { ...row, props: { a: 1, community: 9, community_name: "n" } },
      { ...row, label: "m", props: { a: 1, community: 4 } },
    ]);
    expect(communityOnly).toBe(left);
  });

  it("moves on served content changes", () => {
    const base = sourceContentDigest([row]);
    expect(sourceContentDigest([{ ...row, label: "changed" }])).not.toBe(base);
    expect(sourceContentDigest([{ ...row, props: { a: 2 } }])).not.toBe(base);
    expect(sourceContentDigest([{ ...row, id: "replacement-id" }])).not.toBe(base);
    expect(sourceContentDigest([])).not.toBe(base);
  });
});
