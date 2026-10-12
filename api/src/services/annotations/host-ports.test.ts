import { describe, expect, it } from "vitest";
import type { ResourceRef } from "@sentropic/comments";
import { createAnnotationHostPorts, snapshotResource, type RegisteredResource } from "./host-ports.js";
import { SYNTHETIC_SCOPE } from "./fixtures.js";

const ref = snapshotResource({ scope: SYNTHETIC_SCOPE, namespace: "immo.graph",
  citySlug: "city-a", kind: "regulation", nativeId: "native-1", sourceVersion: "v1" });

function setup() {
  let granted = true;
  let rows: readonly RegisteredResource[] = [{ ref, sourceVersion: "v1",
    frozenDigest: "a".repeat(64), currentDigest: "a".repeat(64), available: true }];
  const ports = createAnnotationHostPorts({
    hasCapability: async (principal, scope, cap) => granted && principal === "subject-a" &&
      scope.tenantId === SYNTHETIC_SCOPE.tenantId && scope.workspaceId === SYNTHETIC_SCOPE.workspaceId &&
      ["read", "comment"].includes(cap),
    resources: async (target) => target.id === ref.id ? rows : [],
  });
  return { ports, revoke: () => { granted = false; }, change: (value: readonly RegisteredResource[]) => { rows = value; } };
}

describe("annotations host authorization and exact snapshots", () => {
  it("should distinguish municipality, native kind and frozen source version", () => {
    for (const changed of [{ citySlug: "city-b" }, { kind: "signal" }, { sourceVersion: "v2" }]) {
      expect(snapshotResource({ scope: SYNTHETIC_SCOPE, namespace: "immo.graph", citySlug: "city-a",
        kind: "regulation", nativeId: "native-1", sourceVersion: "v1", ...changed }).id).not.toBe(ref.id);
    }
    expect(() => snapshotResource({ scope: SYNTHETIC_SCOPE, namespace: "immo.graph",
      citySlug: "city-a", kind: "regulation", nativeId: "gn-display", sourceVersion: "v1" })).toThrow();
  });

  it("should deny an unconfigured sensitive capability and recheck revocation", async () => {
    const { ports, revoke } = setup();
    expect(await ports.capabilities.check("subject-a", "comment", [ref])).toBe(true);
    expect(await ports.capabilities.check("subject-a", "review", [ref])).toBe(false);
    expect(await ports.decisions.resolve("admin-assertion")).toBeNull();
    revoke();
    expect(await ports.capabilities.check("subject-a", "comment", [ref])).toBe(false);
    expect(await ports.resolver.resolve("subject-a", ref)).toBe("unavailable");
  });

  it("should deny empty, malformed, mixed-scope and inaccessible secondary targets", async () => {
    const { ports } = setup();
    expect(await ports.capabilities.check("subject-a", "read", [])).toBe(false);
    expect(await ports.capabilities.check("subject-a", "read", [{} as ResourceRef])).toBe(false);
    expect(await ports.capabilities.check("subject-a", "read", [ref, { ...ref, id: "missing" }])).toBe(false);
    expect(await ports.capabilities.check("subject-a", "read", [ref,
      { ...ref, scope: { ...SYNTHETIC_SCOPE, workspaceId: "other" } }])).toBe(false);
  });

  it("should preserve changed, unknown, ambiguous and unavailable source evidence", async () => {
    const { ports, change } = setup();
    const binding = { resource: ref, source: { variant: "observed" as const, sourceVersion: "v1", evidence: "proof" } };
    expect(await ports.resolveBinding("subject-a", binding)).toBe("exact");
    expect(await ports.resolveBinding("subject-a", { ...binding, source: { variant: "unknown", classification: "historical-gap" } })).toBe("unresolved");
    expect(await ports.resolveBinding("subject-a", { ...binding,
      source: { ...binding.source, sourceVersion: "v0" } })).toBe("source-changed");
    const resource = { ref, sourceVersion: "v1", frozenDigest: "a".repeat(64), currentDigest: "b".repeat(64), available: true };
    change([resource]);
    expect(await ports.resolver.resolve("subject-a", ref)).toBe("source-changed");
    change([resource, resource]);
    expect(await ports.resolver.resolve("subject-a", ref)).toBe("unresolved");
    change([{ ...resource, available: false }]);
    expect(await ports.resolver.resolve("subject-a", ref)).toBe("unavailable");
    change([]);
    expect(await ports.resolver.resolve("subject-a", ref)).toBe("unavailable");
  });
});
