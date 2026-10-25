import { describe, expect, it } from "vitest";
import { selectClassifications } from "./classification-counts.js";
import { SignalQuery } from "./classification-query.js";
import type { SignalFacetsDto } from "./classification-contracts.js";

export function syntheticFacets(baskets: string[] = [], personal = false, workspace = false, inactive = false): SignalFacetsDto {
  const head = { id: "11111111-1111-4111-8111-111111111111", state: "active" as const,
    createdAt: "2026-01-01T00:00:00Z", reason: null };
  const archive = { ...head, reason: { profileId: "test", code: "ARCHIVE", verdict: "non_pertinent" as const }, changedSinceArchive: false };
  return { selection: { pertinent: baskets.includes("pertinent") ? head : inactive ? { ...head, state: "inactive" } : null,
    a_surveiller: baskets.includes("a_surveiller") ? head : null },
    archive: { personal: personal ? archive : null, workspace: workspace ? archive : null },
    personalHistoryState: baskets.length || personal || inactive ? "has_history" : "untouched",
    personalHidden: personal, workspaceHidden: workspace, effectiveHidden: personal || workspace };
}
describe("classification distinct counts", () => {
  const rows = [syntheticFacets(["pertinent", "a_surveiller"]), syntheticFacets(["pertinent"]),
    syntheticFacets(["a_surveiller"]), syntheticFacets(), syntheticFacets([], false, false, true),
    syntheticFacets([], true), syntheticFacets([], false, true), syntheticFacets([], true, true)].map((facets) => ({ facets }));
  it("should reproduce the eight-target oracle without summing basket memberships", () => {
    const result = selectClassifications(rows, SignalQuery.parse({ citySlug: "city", basket: "pertinent" }));
    expect(result.counts).toEqual({ unit: "distinct_targets", eligible: 8, visible: 5, discarded: 3,
      discardedByScope: { personalOnly: 1, workspaceOnly: 1, both: 1 },
      navigation: { basis: "after_content_personal_history_and_archive_before_basket", population: 5,
        pertinent: 2, a_surveiller: 2, selectedDistinct: 3, selectionMemberships: 4, unselected: 2 }, matched: 2 });
    expect(result.matched).toHaveLength(2);
  });
  it("should count inactive personal heads as history and a common archive alone as untouched", () => {
    const query = SignalQuery.parse({ citySlug: "city", personalHistory: "untouched", archive: "include", basket: "none" });
    const result = selectClassifications(rows, query);
    expect(result.counts.eligible).toBe(2);
    expect(result.counts.discardedByScope.workspaceOnly).toBe(1);
    expect(result.counts.matched).toBe(2);
    expect(selectClassifications(rows, { ...query, archive: "only" }).matched).toHaveLength(1);
  });
});
