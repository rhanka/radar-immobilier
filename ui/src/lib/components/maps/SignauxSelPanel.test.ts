/**
 * Component test for SignauxSelPanel — right-panel signal click → detail card.
 *
 * Reproduces the demo-blocking bug: clicking a signal in the right panel must
 * open its detail card (description / Evidence / source button). Rendered via
 * SignauxSelPanelHarness, which owns `selectionState` and mutates it through a
 * faithful mirror of SignauxMapView.toggleBucketKey (#9 accordion logic).
 *
 * No MapLibre, no API: pure click → focus → detail reactivity loop.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import type { MunicipalityT } from "@radar/domain";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import Harness from "./SignauxSelPanelHarness.svelte";

function makeMunicipality(slug: string, name: string): MunicipalityT {
  return {
    slug,
    name,
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
}

function makeCity(slug = "delson", name = "Delson"): CityMapEntry {
  return {
    municipality: makeMunicipality(slug, name),
    signalCount6m: 2,
    subsetCounts: {},
  };
}

function makeSignal(
  id: string,
  label: string,
  description: string,
): GraphSignalNode {
  return {
    id,
    type: "DesignationEvent",
    label,
    citySlug: "delson",
    sourceRef: `raw/proces-verbaux-delson/2026/05/19/${id}.txt`,
    createdAt: "2026-05-19T12:00:00.000Z",
    description,
    publishedAt: "2026-05-19T12:00:00.000Z",
    props: {
      description,
      reglement_number: "1926-26",
      zone_ref: "H-431",
    },
  };
}

const NODES: GraphSignalNode[] = [
  makeSignal("sig-1", "Avis de motion règlement zonage H-431", "Premier signal de zonage."),
  makeSignal("sig-2", "Approbation règlement zonage H-521", "Second signal de zonage."),
];

afterEach(() => cleanup());

describe("SignauxSelPanel — clic signal → fiche détail", () => {
  it("ouvre la fiche du 1er signal au clic (description + Evidence + bouton source)", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: NODES },
    });

    // Avant le clic : aucun détail ouvert.
    expect(queryByText("Premier signal de zonage.")).toBeNull();
    expect(queryByText("Evidence")).toBeNull();

    // Clic sur le bouton du 1er signal.
    await fireEvent.click(getByText("Avis de motion règlement zonage H-431"));

    // La fiche détail doit apparaître.
    expect(queryByText("Premier signal de zonage.")).not.toBeNull();
    expect(queryByText("Evidence")).not.toBeNull();
    // Source documentaire présente (sourceRef raw/...) → bouton "Voir provenance".
    expect(queryByText("Voir provenance")).not.toBeNull();
  });

  it("ouvre n'importe quel signal, pas seulement le 1er", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: NODES },
    });

    await fireEvent.click(getByText("Approbation règlement zonage H-521"));

    expect(queryByText("Second signal de zonage.")).not.toBeNull();
    // Le 1er reste fermé.
    expect(queryByText("Premier signal de zonage.")).toBeNull();
  });

  it("accordéon : un seul détail ouvert à la fois", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: NODES },
    });

    await fireEvent.click(getByText("Avis de motion règlement zonage H-431"));
    expect(queryByText("Premier signal de zonage.")).not.toBeNull();

    await fireEvent.click(getByText("Approbation règlement zonage H-521"));
    expect(queryByText("Second signal de zonage.")).not.toBeNull();
    expect(queryByText("Premier signal de zonage.")).toBeNull();
  });

  it("re-clic sur le signal focusé referme sa fiche", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: NODES },
    });

    const btn = getByText("Avis de motion règlement zonage H-431");
    await fireEvent.click(btn);
    expect(queryByText("Premier signal de zonage.")).not.toBeNull();

    await fireEvent.click(btn);
    expect(queryByText("Premier signal de zonage.")).toBeNull();
  });
});
