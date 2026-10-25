import type { SignalQueryArgs } from "./classification-query.js";
import { SignalCounts, type SignalFacetsDto } from "./classification-contracts.js";

export function selectClassifications<T extends { facets: SignalFacetsDto }>(rows: readonly T[], query: SignalQueryArgs) {
  const eligible = rows.filter(({ facets }) => query.personalHistory === "any"
    || (query.personalHistory === "untouched") === (facets.personalHistoryState === "untouched"));
  const discarded = eligible.filter(({ facets }) => facets.effectiveHidden);
  const discardedByScope = { personalOnly: 0, workspaceOnly: 0, both: 0 };
  for (const { facets } of discarded) {
    if (facets.personalHidden && facets.workspaceHidden) discardedByScope.both++;
    else if (facets.personalHidden) discardedByScope.personalOnly++;
    else discardedByScope.workspaceOnly++;
  }
  const visible = eligible.filter(({ facets }) => query.archive === "include"
    || (query.archive === "only") === facets.effectiveHidden);
  const active = (facets: SignalFacetsDto, basket: "pertinent" | "a_surveiller") => facets.selection[basket]?.state === "active";
  const pertinent = visible.filter(({ facets }) => active(facets, "pertinent")).length;
  const watching = visible.filter(({ facets }) => active(facets, "a_surveiller")).length;
  const selected = visible.filter(({ facets }) => active(facets, "pertinent") || active(facets, "a_surveiller")).length;
  const matched = visible.filter(({ facets }) => query.basket === "all" || (query.basket === "none"
    ? !active(facets, "pertinent") && !active(facets, "a_surveiller") : active(facets, query.basket)));
  const counts = SignalCounts.parse({ unit: "distinct_targets", eligible: eligible.length,
    visible: eligible.length - discarded.length, discarded: discarded.length, discardedByScope,
    navigation: { basis: "after_content_personal_history_and_archive_before_basket", population: visible.length,
      pertinent, a_surveiller: watching, selectedDistinct: selected, selectionMemberships: pertinent + watching,
      unselected: visible.length - selected }, matched: matched.length });
  return { counts, matched };
}
