/**
 * Facet tests for SignauxSelPanel (lot 4, C6): badges, reveal checkbox
 * gating, controls mount, and the discard notice (focus + undo).
 *
 * Rendered via SignauxSelPanelHarness (no MapLibre, no API). Synthetic
 * fixtures only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import type { MunicipalityT } from "@radar/domain";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import { createSelectionBucketState, makeKey } from "$lib/maps/selection-bucket.js";
import type { TargetFacetState, postFacetCommand } from "$lib/signals/signal-facets-client.js";
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

describe("SignauxSelPanel — reveal checkbox gating", () => {
  it("shows the checkbox when allowed and forwards the toggle", async () => {
    const onToggleShowDiscarded = vi.fn();
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        facetsAllowed: true,
        showDiscarded: false,
        onToggleShowDiscarded,
      },
    });
    const checkbox = screen.getByLabelText("Montrer les écartés") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await fireEvent.click(checkbox);
    expect(onToggleShowDiscarded).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("facets-unavailable-note")).toBeNull();
  });

  it("shows an explicit note instead of controls when not allowed", () => {
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        selectionState: focusedState("sig-1"),
        facetsAllowed: false,
        facetsNote: "Connexion requise pour classer les signaux.",
      },
    });
    expect(screen.queryByLabelText("Montrer les écartés")).toBeNull();
    expect(screen.getByTestId("facets-unavailable-note").textContent).toContain("Connexion requise");
    expect(screen.queryByTestId("signal-facet-controls")).toBeNull();
    expect(screen.getByTestId("facet-card-note").textContent).toContain("Connexion requise");
  });
});

describe("SignauxSelPanel — controls and discard notice", () => {
  it("mounts the controls in the unfolded card and reports saves", async () => {
    const postCommand = vi.fn<typeof postFacetCommand>(async () => null);
    const onFacetSaved = vi.fn();
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        selectionState: focusedState("sig-1"),
        facetsAllowed: true,
        reasonCodes: CODES,
        facetHeads: new Map(),
        facetPostCommand: postCommand,
        onFacetSaved,
      },
    });
    expect(screen.getByTestId("signal-facet-controls")).toBeTruthy();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() => expect(onFacetSaved).toHaveBeenCalledTimes(1));
    expect(onFacetSaved.mock.calls[0]![0]).toBe("discard");
    expect(onFacetSaved.mock.calls[0]![1]).toEqual({
      citySlug: "delson",
      type: "DesignationEvent",
      id: "sig-1",
    });
    expect(postCommand.mock.calls[0]![2]).toEqual({
      target: { citySlug: "delson", type: "DesignationEvent", id: "sig-1" },
      reasonCode: "N-ADMIN",
    });
  });

  it("renders no controls for a node without citySlug", () => {
    const node = makeSignal();
    node.citySlug = null;
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [node],
        unfilteredSignalCount: 1,
        selectionState: focusedState("sig-1"),
        facetsAllowed: true,
        reasonCodes: CODES,
        facetHeads: new Map(),
      },
    });
    expect(screen.queryByTestId("signal-facet-controls")).toBeNull();
  });

  it("focuses the discard notice and undoes on Annuler", async () => {
    const onUndoDiscard = vi.fn();
    const onDismiss = vi.fn();
    const target = { citySlug: "delson", type: "DesignationEvent" as const, id: "sig-1" };
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        facetsAllowed: true,
        discardedNotice: { target, label: "Synthetic zonage signal" },
        onUndoDiscard,
        onDismissDiscardedNotice: onDismiss,
      },
    });
    const notice = screen.getByTestId("discarded-notice");
    expect(notice.contains(document.activeElement)).toBe(true);
    const buttons = within(notice).getAllByRole("button");
    await fireEvent.click(buttons.find((button) => button.textContent === "Annuler")!);
    expect(onUndoDiscard).toHaveBeenCalledWith(target);
    await fireEvent.click(buttons.find((button) => button.textContent === "Fermer")!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the reload failure with a reads-only retry", async () => {
    const onRetryFacetReads = vi.fn();
    render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [makeSignal()],
        unfilteredSignalCount: 1,
        facetsAllowed: true,
        facetReloadError: "Les données affichées peuvent être périmées.",
        onRetryFacetReads,
      },
    });
    const alert = screen.getByTestId("facet-reload-error");
    expect(alert.textContent).toContain("rechargement impossible");
    await fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(onRetryFacetReads).toHaveBeenCalledTimes(1);
  });
});
