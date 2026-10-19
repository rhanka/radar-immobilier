/**
 * Facet tests for SignauxSelPanel (lot 4, C6): badges, reveal checkbox
 * gating, controls mount, and the discard notice (focus + undo).
 *
 * Rendered via SignauxSelPanelHarness (no MapLibre, no API). Synthetic
 * fixtures only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import type { MunicipalityT } from "@radar/domain";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import { createSelectionBucketState, makeKey } from "$lib/maps/selection-bucket.js";
import type { TargetFacetState } from "$lib/signals/signal-facets-client.js";
import Harness from "./SignauxSelPanelHarness.svelte";

vi.mock("$lib/collab/annotations-client.js", () => ({
  listAnnotations: vi.fn(async () => []),
  createAnnotation: vi.fn(async () => {}),
  editAnnotation: vi.fn(async () => {}),
  deleteAnnotation: vi.fn(async () => {}),
}));
vi.mock("$lib/collab/prospect-notes-stream.js", () => ({
  subscribeNoteFrames: () => () => {},
  noteMatchesTarget: () => false,
}));

function makeCity(): CityMapEntry {
  const municipality: MunicipalityT = {
    slug: "delson",
    name: "Delson",
    mrc: "Roussillon",
    lat: 45.27,
    lon: -73.55,
    population: 11000,
    distanceToMtlKm: 20,
    priorityRank: 12,
    excluded: false,
    excludedReason: null,
    deprioritized: false,
  };
  return { municipality, signalCount6m: 1, subsetCounts: {}, vivierV2Counts: null };
}

function makeSignal(id = "sig-1"): GraphSignalNode {
  return {
    id,
    type: "DesignationEvent",
    label: "Synthetic zonage signal",
    citySlug: "delson",
    sourceRef: `raw/proces-verbaux-delson/2026/05/19/${id}.txt`,
    createdAt: "2026-05-19T12:00:00.000Z",
    description: "Synthetic description.",
    publishedAt: "2026-05-19T12:00:00.000Z",
    props: { description: "Synthetic description." },
  };
}

function focusedState(id: string) {
  const key = makeKey("signal", id);
  return createSelectionBucketState({ selectedKeys: [key], focusedKey: key });
}

const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" },
  { code: "N-ADMIN", verdict: "non_pertinent" },
];

function facetState(overrides: Partial<TargetFacetState> = {}): TargetFacetState {
  return {
    pertinent: false,
    pertinentCode: null,
    watching: false,
    watchingCode: null,
    archived: false,
    archiveCode: null,
    changedSinceArchive: false,
    targetAvailable: true,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("SignauxSelPanel — facet badges", () => {
  it("shows Pertinent, archived code and changed-since-archive badges", () => {
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        selectionState: focusedState("sig-1"),
        facetsAllowed: true,
        reasonCodes: CODES,
        facetHeads: new Map([
          ["DesignationEvent/sig-1", facetState({
            pertinent: true,
            pertinentCode: "P-DENSITE",
            archived: true,
            archiveCode: "N-ADMIN",
            changedSinceArchive: true,
          })],
        ]),
      },
    });
    expect(screen.getByTestId("facet-badge-pertinent").textContent).toBe("Pertinent");
    expect(screen.getByTestId("facet-badge-archived").textContent).toContain("N-ADMIN");
    expect(screen.getByTestId("facet-badge-changed").textContent).toBe("modifié depuis l'écart");
    expect(screen.queryByTestId("facet-badge-watching")).toBeNull();
  });

  it("shows no badge on an untouched signal", () => {
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        selectionState: focusedState("sig-1"),
        facetsAllowed: true,
        reasonCodes: CODES,
        facetHeads: new Map(),
      },
    });
    for (const testId of ["facet-badge-pertinent", "facet-badge-watching", "facet-badge-archived", "facet-badge-changed"]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });
});

