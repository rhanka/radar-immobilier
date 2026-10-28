import { describe, expect, it } from "vitest";
import { validateReaderResponse } from "./reader-responses.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

function snapshot() {
  return { kind: "signal-projection-v1" as const, baseToken: HASH, queryToken: HASH,
    queryDigest: HASH, projectionVersion: "v1", catalogVersion: HASH };
}

function closedContext() {
  const closed = { state: "closed" as const, reason: "not_activated" as const };
  return { ok: true as const, context: { contractVersion: "facet-context-v2" as const,
    workspaceId: WORKSPACE,
    semanticProfile: { lotReason: "required" as const, correspondence: "sent" as const,
      signalClassification: "separate_action" as const, semanticContractVersion: "base-classification-v1" as const },
    signals: { availability: closed, baskets: [{ id: "pertinent" as const, scope: "personal" as const }],
      canSelectPersonally: true, canDiscardPersonally: true, canModerateArchive: false,
      queryProfile: "signal-query-basic-v1" as const },
    lots: { availability: closed, selectionBasket: null, modes: [], canSelect: false,
      canChangePipeline: false, canChangeMarket: false, canDiscardPersonally: true, canModerateArchive: false },
    reasonCatalog: { availability: closed, profileId: null, digest: null, entries: null } } };
}

describe("basket reader responses", () => {
  it("should accept the three frozen basket contracts and refuse extras", () => {
    expect(validateReaderResponse("baskets.context.v1", closedContext(), "reader-alice")).toBeDefined();
    expect(() => validateReaderResponse("baskets.context.v1", {}, "reader-alice")).toThrow();
    expect(() => validateReaderResponse("baskets.search.v1",
      { ok: true, credential: "secret" }, "reader-alice")).toThrow();
  });

  it("should accept search and state shapes from the existing services", () => {
    const search = { ok: true as const, contractVersion: "signal-classifications-v1" as const,
      workspaceId: WORKSPACE, citySlug: "valleyfield", mode: "signal" as const,
      population: "signal_nodes_v1" as const, snapshot: snapshot(),
      counts: { unit: "distinct_targets" as const, eligible: 0, visible: 0, discarded: 0,
        discardedByScope: { personalOnly: 0, workspaceOnly: 0, both: 0 },
        navigation: { basis: "after_content_personal_history_and_archive_before_basket" as const,
          population: 0, pertinent: 0, a_surveiller: 0, selectedDistinct: 0,
          selectionMemberships: 0, unselected: 0 }, matched: 0 },
      items: [], page: { limit: 20, nextCursor: null, truncated: false } };
    expect(validateReaderResponse("baskets.search.v1", search, "reader-alice")).toBeDefined();
    const state = { ok: true as const, contractVersion: "signal-state-v1" as const,
      workspaceId: WORKSPACE, snapshot: snapshot(),
      item: { target: { citySlug: "valleyfield", type: "Signal" as const, id: "sig-1" },
        readiness: "source_unavailable" as const, displayedFingerprint: null, card: null,
        facets: { selection: { pertinent: null, a_surveiller: null },
          archive: { personal: null, workspace: null }, personalHistoryState: "untouched" as const,
          personalHidden: false, workspaceHidden: false, effectiveHidden: false } } };
    expect(validateReaderResponse("baskets.state.v1", state, "reader-alice")).toBeDefined();
  });
});
