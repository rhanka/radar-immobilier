import { describe, expect, it } from "vitest";
import { STATUS_TOOL_CONTRACTS } from "./tool-contracts.js";
import { GetFacetContextOutputSchema, GetLotFacetsOutputSchema,
  GetSignalFacetsOutputSchema } from "./response-schemas.js";

const commandKey = "11111111-2222-4333-8444-555555555555";
const workspaceId = "11111111-2222-4333-8444-555555555555";
const createdAt = "2026-10-22T00:00:00.000Z";
const receipt = { commandKey, replayed: true, stateKind: "command_snapshot" };
const target = { type: "Lot", authority: "lot_versions", citySlug: "longueuil", canonicalId: "L1" };
const item = { target, mode: "real", events: [], heads: [], appended: false };
const context = {
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

describe("command response contracts", () => {
  it.each([
    ["command_signal_facet", { ...receipt, event: null }],
    ["command_lot_facet", { ...receipt, events: [], heads: [], appended: false }],
    ["batch_lot_facet_commands", { ...receipt, targets: 1, changed: 0, unchanged: 1,
      eventsAppended: 0, items: [item] }],
  ] as const)("should accept %s historical snapshots and reject current-state claims", (name, output) => {
    const schema = STATUS_TOOL_CONTRACTS[name].output;
    expect(schema.safeParse(output).success).toBe(true);
    expect(schema.safeParse({ ...output, stateKind: "current" }).success).toBe(false);
    expect(schema.safeParse({ ...output, commandKey: "bad" }).success).toBe(false);
    expect(schema.safeParse({ ...output, actor: "private" }).success).toBe(false);
  });

  it("should reject partial, duplicate and inconsistent atomic batch summaries", () => {
    const output = { ...receipt, targets: 1, changed: 0, unchanged: 1, eventsAppended: 0, items: [item] };
    const schema = STATUS_TOOL_CONTRACTS.batch_lot_facet_commands.output;
    for (const patch of [{ targets: 2 }, { changed: 1 }, { eventsAppended: 1 }, { items: [] },
      { targets: 2, unchanged: 2, items: [item, item] }]) {
      expect(schema.safeParse({ ...output, ...patch }).success).toBe(false);
    }
  });
});

describe("facet context diagnostics and read heads", () => {
  it("should bind every reason code to its classification without deriving it", () => {
    expect(GetFacetContextOutputSchema.parse({ workspaces: [],
      selectedWorkspace: context }).selectedWorkspace?.reasonCatalog).toEqual(context.reasonCatalog);
    const entry = context.reasonCatalog[0]!;
    expect(GetFacetContextOutputSchema.safeParse({ workspaces: [],
      selectedWorkspace: { ...context, reasonCatalog: [{ ...entry }] } }).success).toBe(true);
    for (const catalog of [[{ ...entry, verdict: undefined }], [{ ...entry, verdict: "unknown" }],
      [{ ...entry, extra: "x" }], [{ code: "N-DOUBLON", label: "Missing verdict" }]]) {
      expect(GetFacetContextOutputSchema.safeParse({ workspaces: [],
        selectedWorkspace: { ...context, reasonCatalog: catalog } }).success).toBe(false);
    }
    const explicitCatalog = [{ code: "P-VILLE-TERRITOIRE", label: "Carried", verdict: "non_pertinent" }];
    expect(GetFacetContextOutputSchema.parse({ workspaces: [], selectedWorkspace: { ...context,
      reasonCatalog: explicitCatalog } }).selectedWorkspace?.reasonCatalog).toEqual(explicitCatalog);
  });

  it("should express a missing basket only outside open activation", () => {
    for (const activation of ["closed", "unavailable"]) {
      const diagnostic = { ...context, activation, selectionBasket: null,
        operations: [{ operation: "select", scope: "common", label: "Favori",
          availability: { available: false, reason: "business_closed" } }] };
      expect(GetFacetContextOutputSchema.parse({ workspaces: [],
        selectedWorkspace: diagnostic }).selectedWorkspace).toEqual(diagnostic);
    }
    expect(GetFacetContextOutputSchema.safeParse({ workspaces: [],
      selectedWorkspace: { ...context, activation: "open", selectionBasket: null } }).success).toBe(false);
    expect(GetFacetContextOutputSchema.safeParse({ workspaces: [],
      selectedWorkspace: { ...context, activation: "open" } }).success).toBe(true);
  });

  it("should carry read metadata on heads but refuse it on receipts", () => {
    const page = { workspaceId, city: "longueuil", nextCursor: null, truncated: false };
    const signalTarget = { citySlug: "longueuil", type: "Signal", id: "s1" };
    const archived = { id: workspaceId, target: signalTarget, facet: "archive", basket: null,
      state: "active", reasonCode: "N-DOUBLON", verdict: "non_pertinent", createdAt,
      changedSinceArchive: true };
    const selected = { id: commandKey, target: signalTarget, facet: "selection",
      basket: "pertinent", state: "inactive", reasonCode: null, verdict: null, createdAt,
      changedSinceArchive: null };
    const ready = { readiness: "ready", target: signalTarget, displayedContent: "Synthetic",
      displayedFingerprint: "a".repeat(64), personalHeads: [archived], commonHeads: [selected],
      personalHidden: false, commonHidden: false, effectiveHidden: false, operations: [] };
    const signalPage = { ...page, items: [ready] };
    expect(GetSignalFacetsOutputSchema.parse(signalPage)).toEqual(signalPage);
    const { changedSinceArchive: _dropped, ...event } = archived;
    expect(GetSignalFacetsOutputSchema.safeParse({ ...page,
      items: [{ ...ready, personalHeads: [event] }] }).success).toBe(false);
    expect(STATUS_TOOL_CONTRACTS.command_signal_facet.output.safeParse({ ...receipt,
      event: archived }).success).toBe(false);
    expect(STATUS_TOOL_CONTRACTS.command_signal_facet.output.safeParse({ ...receipt,
      event }).success).toBe(true);
    const lotTarget = { type: "Lot", authority: "lot_versions",
      citySlug: "longueuil", canonicalId: "L1" };
    const lotHead = { id: workspaceId, target: lotTarget, mode: "real", facet: "archive",
      basket: null, state: "inactive", reasonCode: "OUT-OF-SCOPE", verdict: "non_pertinent",
      pipelineStatus: null, askingPrice: null, listingUrl: null,
      displayedVersion: { lot_version_id: workspaceId, fingerprint: "b".repeat(64) },
      source: null, createdAt, changedSinceArchive: false };
    const lotReady = { readiness: "ready", target: lotTarget,
      displayed_version: { lot_version_id: workspaceId, fingerprint: "a".repeat(64) },
      personalHeads: [lotHead], commonHeads: [], personalHidden: true,
      commonHidden: false, effectiveHidden: true, operations: [] };
    const lotPage = { ...page, mode: "real", items: [{ ...lotReady,
      commonHeads: [{ ...lotHead, state: "active", changedSinceArchive: true }] }] };
    expect(GetLotFacetsOutputSchema.parse(lotPage)).toEqual(lotPage);
    const { changedSinceArchive: _lotDropped, ...lotEvent } = lotHead;
    expect(GetLotFacetsOutputSchema.safeParse({ ...page, mode: "real",
      items: [{ ...lotReady, personalHeads: [lotEvent] }] }).success).toBe(false);
    expect(STATUS_TOOL_CONTRACTS.command_lot_facet.output.safeParse({ ...receipt,
      events: [lotHead], heads: [lotHead], appended: true }).success).toBe(false);
    expect(STATUS_TOOL_CONTRACTS.command_lot_facet.output.safeParse({ ...receipt,
      events: [lotEvent], heads: [lotEvent], appended: true }).success).toBe(true);
  });
});
