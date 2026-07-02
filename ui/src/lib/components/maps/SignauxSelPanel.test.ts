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
    expect(queryByText("Preuve")).toBeNull();

    // Clic sur le bouton du 1er signal.
    await fireEvent.click(getByText("Avis de motion règlement zonage H-431"));

    // La fiche détail doit apparaître.
    expect(queryByText("Premier signal de zonage.")).not.toBeNull();
    expect(queryByText("Preuve")).not.toBeNull();
    // Source documentaire présente (sourceRef raw/...) → bouton "Voir la preuve".
    expect(queryByText("Voir la preuve")).not.toBeNull();
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

// ── Carte LOT enrichie (#314) + contrat d'interaction lot → zone ─────────────

import type { LotFeature, LotsResponse } from "$lib/maps/lots-client.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";

function makeLotsResponse(features: LotFeature[]): LotsResponse {
  return {
    ok: true,
    citySlug: "delson",
    source: "donnees-quebec",
    collectionId: "qc-lots-delson",
    numberMatched: features.length,
    numberReturned: features.length,
    featureCollection: { type: "FeatureCollection", features },
  };
}

function makeZonesResponse(codes: string[]): GeoZonesResponse {
  return {
    ok: true,
    citySlug: "delson",
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: codes.length,
    warnings: [],
    featureCollection: {
      type: "FeatureCollection",
      features: codes.map((code) => ({
        type: "Feature",
        geometry: null,
        properties: {
          code,
          citySlug: "delson",
          geometryStatus: "official" as const,
          confidence: 1,
          source: "official-zone" as const,
          lotCount: 0,
          lots: [],
        },
      })),
    },
  };
}

describe("SignauxSelPanel — carte lot enrichie (zone, 4+, superficie, TOD, score honnête)", () => {
  const enrichedLot: LotFeature = {
    type: "Feature",
    geometry: null,
    properties: {
      noLot: "5399042",
      citySlug: "delson",
      zoneCode: "H-431",
      multifamilial4plus: true,
      multifamilial4plusSource: "grille",
      superficieM2: 850.4,
      tod: false,
      potentialScore: 0,
      potentialScoreStatus: "unavailable",
    },
  };

  it("affiche zone (code), 4+ avec source, superficie formatée et TOD", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([enrichedLot]),
      },
    });

    await fireEvent.click(getByText("5399042"));

    expect(queryByText("H-431")).not.toBeNull();
    expect(queryByText("Multifamilial 4+")).not.toBeNull();
    expect(queryByText("Oui · grille")).not.toBeNull();
    expect(queryByText("850 m²")).not.toBeNull();
    expect(queryByText("Périmètre TOD")).not.toBeNull();
    expect(queryByText("Non")).not.toBeNull();
  });

  it("score indisponible → « non évalué », JAMAIS « 0.0/10 » présenté comme mesuré", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([enrichedLot]),
      },
    });

    // Sous-titre de la rangée AVANT le clic : "lot", pas un faux score.
    expect(queryByText("0.0/10")).toBeNull();

    await fireEvent.click(getByText("5399042"));
    expect(queryByText("non évalué")).not.toBeNull();
    expect(queryByText("0.0/10")).toBeNull();
  });

  it("score évalué → affiché « x.x/10 »", () => {
    const scoredLot: LotFeature = {
      ...enrichedLot,
      properties: {
        ...enrichedLot.properties,
        potentialScore: 7.5,
        potentialScoreStatus: "scored",
      },
    };
    const { queryAllByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([scoredLot]),
      },
    });
    // Sous-titre de la rangée lot (visible sans clic).
    expect(queryAllByText("7.5/10").length).toBeGreaterThan(0);
  });

  it("champs absents → « — » discret (zone/4+/superficie), TOD omis", async () => {
    const bareLot: LotFeature = {
      type: "Feature",
      geometry: null,
      properties: { noLot: "111", citySlug: "delson" },
    };
    const { getByText, queryAllByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([bareLot]),
      },
    });
    await fireEvent.click(getByText("111"));
    expect(queryAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(queryByText("Périmètre TOD")).toBeNull();
  });

  it("badge zone cliquable → ouvre le détail de la zone (type dérivé, signaux citants)", async () => {
    const { getByText, queryByText, getByTitle } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([enrichedLot]),
        zonesResponse: makeZonesResponse(["H-431"]),
      },
    });

    await fireEvent.click(getByText("5399042"));
    // Le code de zone est rendu en badge-bouton (remontée lot → zone).
    const badge = getByTitle("Ouvrir le détail de la zone");
    expect(badge.textContent).toContain("H-431");

    await fireEvent.click(badge);
    // Détail zone ouvert : type dérivé du code (H- → Habitation) + section signaux.
    expect(queryByText("Habitation")).not.toBeNull();
    expect(queryByText("Signaux citant la zone")).not.toBeNull();
    expect(queryByText("Aucun signal ne cite cette zone.")).not.toBeNull();
  });
});

describe("SignauxSelPanel — détail zone : signaux citant la zone", () => {
  it("liste les signaux dont zone_ref matche (forme comparable) et ouvre leur fiche", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: NODES, // sig-1 porte zone_ref H-431
        zonesResponse: makeZonesResponse(["H-431"]),
      },
    });

    // Ouvre la fiche de la zone H-431 (libellé = code, rangée du bucket Zones).
    await fireEvent.click(getByText("H-431", { selector: ".sel-entity-label" }));
    expect(queryByText("Signaux citant la zone")).not.toBeNull();

    // Le signal citant est listé ; le cliquer ouvre sa fiche signal.
    const link = getByText("Avis de motion règlement zonage H-431", {
      selector: "button.zone-signal-link",
    });
    await fireEvent.click(link);
    expect(queryByText("Premier signal de zonage.")).not.toBeNull();
  });
});
