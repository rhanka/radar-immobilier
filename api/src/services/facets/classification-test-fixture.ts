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
