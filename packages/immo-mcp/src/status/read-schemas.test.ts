import { describe, expect, it } from "vitest";
import { ContinuationContextSchema, GetFacetContextInputSchema, GetLotFacetsInputSchema,
  GetSignalFacetsInputSchema, continuationContextKey } from "./read-schemas.js";
import { GetFacetContextOutputSchema, GetLotFacetsOutputSchema,
  GetSignalFacetsOutputSchema } from "./response-schemas.js";

const workspaceId = "11111111-2222-4333-8444-555555555555";
const city = "longueuil";
const target = { citySlug: city, type: "Signal", id: "s1" };
const page = { workspaceId, city, nextCursor: null, truncated: false };
const item = { readiness: "ready", target, displayedContent: "Synthetic evidence",
  displayedFingerprint: "a".repeat(64), personalHeads: [], commonHeads: [],
  personalHidden: false, commonHidden: true, effectiveHidden: true, operations: [] };

const selectedWorkspace = {
  workspaceId, label: "synthetic",
  capabilities: { select: true, changePipeline: false, changeMarket: false,
    discardPersonally: true, moderateArchive: false },
  selectionBasket: "favorites",
  reasonCatalog: [
    { code: "P-VILLE-TERRITOIRE", label: "Pertinent", verdict: "pertinent" },
    { code: "S-PLANIFIE", label: "A surveiller", verdict: "a_surveiller" },
    { code: "N-DOUBLON", label: "Non pertinent", verdict: "non_pertinent" },
  ],
  semanticProfile: { lotReason: "undecided", correspondence: "undecided",
    signalClassification: "separate_action", semanticContractVersion: "v1" },
  operations: [], activation: "closed",
};

describe("closed read schemas", () => {
  it("should accept discovery and reject authority fields or convenience workspaces", () => {
    expect(GetFacetContextInputSchema.parse({})).toEqual({});
    expect(GetFacetContextInputSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(GetFacetContextOutputSchema.safeParse({ workspaces: [], selectedWorkspace: null }).success).toBe(true);
    for (const input of [{ actor: "x" }, { workspaceId: "radar" }, { workspaceId: "default" }]) {
      expect(GetFacetContextInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it.each(["heads", "history", "receipts"])("should reject private %s on a valid selected context", (field) => {
    const output = { workspaces: [], selectedWorkspace };
    expect(GetFacetContextOutputSchema.parse(output)).toEqual(output);
    expect(GetFacetContextOutputSchema.safeParse({ ...output,
      selectedWorkspace: { ...selectedWorkspace, [field]: [] } }).success).toBe(false);
  });

  it("should require closed bounded workspace/city reads and qualified lot targets", () => {
    expect(GetSignalFacetsInputSchema.safeParse({ workspaceId, city, reveal: true, targets: [target] }).success)
      .toBe(true);
    for (const input of [{ city }, { workspaceId }, { workspaceId, city, limit: 101 },
      { workspaceId, city, reveal: "true" }, { workspaceId, city, roles: [] },
      { workspaceId, city, targets: [target], cursor: "c" },
      { workspaceId, city, targets: [{ ...target, citySlug: "other" }] }]) {
      expect(GetSignalFacetsInputSchema.safeParse(input).success).toBe(false);
    }
    expect(GetLotFacetsInputSchema.safeParse({ workspaceId, city, mode: "simulation" }).success).toBe(true);
    expect(GetLotFacetsInputSchema.safeParse({ workspaceId, city }).success).toBe(false);
  });

  it("should require displayed content with fingerprint and preserve unavailable states", () => {
    expect(GetSignalFacetsOutputSchema.safeParse({ ...page, items: [item] }).success).toBe(true);
    for (const bad of [{ ...item, displayedContent: undefined }, { ...item, displayedFingerprint: "bad" },
      { ...item, effectiveHidden: false }, { ...item, actor: "private" }]) {
      expect(GetSignalFacetsOutputSchema.safeParse({ ...page, items: [bad] }).success).toBe(false);
    }
    for (const readiness of ["missing_state", "source_unavailable", "projection_unavailable"]) {
      expect(GetSignalFacetsOutputSchema.safeParse({ ...page, items: [{ readiness, target }] }).success).toBe(true);
    }
    expect(GetSignalFacetsOutputSchema.safeParse({ ...page, truncated: true, items: [item] }).success).toBe(false);
    expect(GetSignalFacetsOutputSchema.safeParse({ ...page, nextCursor: "next", truncated: true,
      items: [item] }).success).toBe(true);
  });

  it("should require a qualified displayed lot version without inventing source readiness", () => {
    const lot = { ...item, target: { type: "Lot", authority: "lot_versions", citySlug: city, canonicalId: "L1" },
      displayed_version: { lot_version_id: workspaceId, fingerprint: "a".repeat(64) } };
    const { displayedContent: _content, displayedFingerprint: _fingerprint, ...lotItem } = lot;
    expect(GetLotFacetsOutputSchema.safeParse({ ...page, mode: "real", items: [lotItem] }).success).toBe(true);
    expect(GetLotFacetsOutputSchema.safeParse({ ...page, mode: "real",
      items: [{ ...lotItem, displayed_version: undefined }] }).success).toBe(false);
  });

  it("should bind every authority and query dimension of continuation", () => {
    const context = ContinuationContextSchema.parse({ accountId: workspaceId, workspaceId,
      authorityRevision: 1, city, kind: "signal", mode: null, reveal: false, limit: 100, filterDigest: "a".repeat(64) });
    for (const patch of [{ accountId: "22222222-3333-4444-8555-666666666666" },
      { workspaceId: "22222222-3333-4444-8555-666666666666" }, { authorityRevision: 2 }, { city: "other" },
      { kind: "lot" as const }, { mode: "real" as const }, { reveal: true }, { limit: 50 }, { filterDigest: "b".repeat(64) }]) {
      expect(continuationContextKey({ ...context, ...patch })).not.toBe(continuationContextKey(context));
    }
  });
});
