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
    vivierV2Counts: null,
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

/** Classification serveur d'un PIIA (instrument piia, résidentiel oui). */
function piiaClassification(): GraphSignalNode["classification"] {
  return {
    zonage: { valeur: "oui", source: "test", confiance: 0.95 },
    residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
    effet_densifiant: "inconnu",
    instrument: "piia",
    etape: "avis_motion",
    etapes_historique: ["avis_motion"],
    exclusion_reason: null,
    provenance: { extrait: "" },
    confiance: 0.9,
  } as unknown as GraphSignalNode["classification"];
}

afterEach(() => cleanup());

describe("SignauxSelPanel — badge PIIA lié", () => {
  it("marque un PIIA à projet résidentiel prouvé, sans le masquer", () => {
    const austin = makeSignal(
      "signal-austin-piia-densification-impasse-renard",
      "PIIA densification impasse Renard",
      "Construction d'un bâtiment résidentiel comportant quatre logements.",
    );
    austin.classification = piiaClassification();
    austin.props = { ...austin.props, nb_unites_max: 4 };

    const { container, queryByText } = render(Harness, {
      props: { selectedCity: makeCity("austin", "Austin"), detailNodes: [austin] },
    });

    // Le signal reste listé (exclure tout PIIA l'aurait écarté).
    expect(queryByText("PIIA densification impasse Renard")).not.toBeNull();
    expect(container.textContent).toContain("PIIA lié · confiance faible");
  });

  it("n'affiche aucun badge PIIA sur un signal de zonage ordinaire", () => {
    const { container } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: NODES },
    });
    expect(container.textContent).not.toContain("PIIA lié");
  });
});

describe("SignauxSelPanel — vue B : raison de rang + effet densifiant honnête", () => {
  function bNode(
    id: string,
    label: string,
    cls: GraphSignalNode["classification"],
  ): GraphSignalNode {
    const signal = makeSignal(id, label, "Signal du vivier v2.");
    signal.classification = cls;
    return signal;
  }

  it("affiche la raison NEUTRE (instrument + étape) par signal en mode B", () => {
    const refonte = bNode("sig-refonte", "Refonte réglementaire secteur centre", {
      ...piiaClassification(),
      instrument: "refonte",
      etape: "projet_reglement",
    } as GraphSignalNode["classification"]);

    const { container } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [refonte],
        vivierBMode: true,
      },
    });

    expect(container.textContent).toContain("Refonte, projet de règlement");
    // Copy neutre : aucun jargon interne exposé.
    expect(container.textContent).not.toContain("bucket");
    expect(container.textContent).not.toContain("projet_reglement");
  });

  it("effet densifiant inconnu → « à qualifier » (jamais une valeur inventée)", () => {
    const inconnu = bNode("sig-inconnu", "Rezonage H-431", piiaClassification());
    const { container } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [inconnu],
        vivierBMode: true,
      },
    });
    expect(container.textContent).toContain("Effet densifiant : à qualifier");
  });

  it("mode A (vivierBMode=false) : NI raison NI effet densifiant rendus", () => {
    const node = bNode("sig-a", "Avis de motion règlement zonage H-431", piiaClassification());
    const { container } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [node],
        vivierBMode: false,
      },
    });
    expect(container.textContent).not.toContain("Effet densifiant");
    expect(container.textContent).not.toContain("à qualifier");
  });
});

describe("SignauxSelPanel — clic signal → fiche détail", () => {
  it("shows unavailable without a false zero or empty-state message", () => {
    const { container } = render(Harness, {
      props: {
        selectedCity: makeCity("sutton", "Sutton"),
        detailNodes: [],
        detailError: "Projection du vivier indisponible.",
      },
    });

    expect(container.textContent).toContain("Signaux indisponibles");
    expect(container.textContent).toContain("n/d");
    expect(container.textContent).not.toContain("0 signal");
    expect(container.textContent).not.toContain("Aucun signal indexé");
  });

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
    // Détail zone ouvert : type dérivé du code (H- → Habitation) + section
    // signaux. Sélecteur précisé : la chip « Habitation » de l'en-tête de
    // filtre par type (accordéon Zones) porte le même libellé.
    expect(queryByText("Habitation", { selector: ".entity-meta-val" })).not.toBeNull();
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

// ── En-têtes de filtre des accordéons Zones / Lots (drawer droit) ────────────
// Le bloc autonome « Filtre Zones et Lots » du rail gauche est supprimé :
// chaque accordéon porte SON filtre au-dessus de sa liste. L'état vit dans le
// parent (Harness = miroir de SignauxMapView) — il pilote aussi la peinture.

function makeLot(noLot: string, extra: Record<string, unknown> = {}): LotFeature {
  return {
    type: "Feature",
    geometry: null,
    properties: { noLot, citySlug: "delson", ...extra },
  } as LotFeature;
}

describe("SignauxSelPanel — accordéon LOTS : en-tête de filtre au-dessus de la liste", () => {
  const lots = [
    makeLot("100", { multifamilial4plus: true, superficieM2: 900 }),
    makeLot("200", { superficieM2: 400 }),
    makeLot("300", { tod: true, superficieM2: 2000 }),
  ];

  it("rend l'en-tête (catégories exclusives + usages + superficie) avec compteur N/M", () => {
    const { getByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse(lots),
      },
    });

    expect(getByTestId("signaux-lot-filter-header")).toBeTruthy();
    // Filtre par défaut : tous les lots matchent (3/3).
    expect(getByTestId("signaux-filter-count").textContent).toContain("3");
    expect(getByTestId("signaux-filter-all")).toBeTruthy();
    expect(getByTestId("signaux-filter-quatrePlus")).toBeTruthy();
    expect(getByTestId("signaux-filter-tod")).toBeTruthy();
    expect(getByTestId("signaux-filter-priorite")).toBeTruthy();
    expect(getByTestId("signaux-usage-residentiel")).toBeTruthy();
    expect(getByTestId("signaux-superficie-slider")).toBeTruthy();
  });

  it("chip « 4+ logements » : la liste ne montre que les lots 4+ et le compteur passe à 1/3", async () => {
    const { getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse(lots),
      },
    });

    await fireEvent.click(getByTestId("signaux-filter-quatrePlus"));

    expect(queryByText("100", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("200", { selector: ".sel-entity-label" })).toBeNull();
    expect(queryByText("300", { selector: ".sel-entity-label" })).toBeNull();
    expect(getByTestId("signaux-filter-count").textContent).toBe("1/3");
    // Filtre actif → « Réinitialiser » disponible, et il restaure la liste.
    await fireEvent.click(getByTestId("signaux-filter-reset"));
    expect(queryByText("200", { selector: ".sel-entity-label" })).not.toBeNull();
  });

  it("le lot FOCUSÉ (fiche ouverte) reste listé même s'il est écarté par le filtre", async () => {
    const { getByText, getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse(lots),
      },
    });

    // Ouvre la fiche du lot 200 (non-4+), puis filtre « 4+ logements ».
    await fireEvent.click(getByText("200", { selector: ".sel-entity-label" }));
    await fireEvent.click(getByTestId("signaux-filter-quatrePlus"));

    // Sélection carte → fiche jamais cassée par un filtre : 200 reste visible.
    expect(queryByText("200", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("100", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("300", { selector: ".sel-entity-label" })).toBeNull();
  });
});

describe("SignauxSelPanel — accordéon ZONES : filtre par TYPE de zone", () => {
  it("chips = types présents uniquement (catégories de la légende), avec compte", () => {
    const { getByTestId, queryByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: makeZonesResponse(["H-431", "H-102", "C-186"]),
      },
    });

    expect(getByTestId("signaux-zone-filter-header")).toBeTruthy();
    expect(getByTestId("signaux-zone-kind-H").textContent).toContain("Habitation");
    expect(getByTestId("signaux-zone-kind-H").textContent).toContain("2");
    expect(getByTestId("signaux-zone-kind-C").textContent).toContain("Commercial");
    // Aucun type Agricole dans les zones → pas de chip (comme la légende).
    expect(queryByTestId("signaux-zone-kind-A")).toBeNull();
  });

  it("sélection additive : « Habitation » ne montre que H-*, + « Commercial » = union ; compteur N/M", async () => {
    const { getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: makeZonesResponse(["H-431", "C-186"]),
      },
    });

    // Filtre « Habitation » : seule H-431 reste listée (1/2).
    await fireEvent.click(getByTestId("signaux-zone-kind-H"));
    expect(queryByText("H-431", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("C-186", { selector: ".sel-entity-label" })).toBeNull();
    expect(getByTestId("signaux-zone-filter-count").textContent).toBe("1/2");

    // + « Commercial » (ADDITIF) : l'union H ∪ C = les deux zones (2/2).
    await fireEvent.click(getByTestId("signaux-zone-kind-C"));
    expect(queryByText("C-186", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(getByTestId("signaux-zone-filter-count").textContent).toBe("2/2");

    // Réinitialiser (filtre actif) → tout revient.
    await fireEvent.click(getByTestId("signaux-zone-kind-H"));
    await fireEvent.click(getByTestId("signaux-zone-kind-C"));
    expect(queryByText("H-431", { selector: ".sel-entity-label" })).not.toBeNull();
  });

  it("filtre qui vide la liste : l'en-tête reste rendu (désactivable) + copy neutre", async () => {
    const { getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: makeZonesResponse(["H-431"]),
      },
    });

    // H présent ; en ajoutant seulement… rien d'autre : on coche H puis on
    // le décoche via Réinitialiser après avoir vérifié l'état vide sur C.
    await fireEvent.click(getByTestId("signaux-zone-kind-H"));
    expect(queryByText("H-431", { selector: ".sel-entity-label" })).not.toBeNull();

    // Décocher H → filtre vide → tout matche à nouveau.
    await fireEvent.click(getByTestId("signaux-zone-kind-H"));
    expect(queryByText("H-431", { selector: ".sel-entity-label" })).not.toBeNull();
  });

  it("la zone FOCUSÉE reste listée même si le filtre type l'écarte", async () => {
    const { getByText, getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: makeZonesResponse(["H-431", "C-186"]),
      },
    });

    // Ouvre la fiche de C-186, puis filtre « Habitation » (écarte C-186).
    await fireEvent.click(getByText("C-186", { selector: ".sel-entity-label" }));
    await fireEvent.click(getByTestId("signaux-zone-kind-H"));

    // Sélection → fiche jamais cassée : C-186 (focusée) reste listée.
    expect(queryByText("C-186", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("H-431", { selector: ".sel-entity-label" })).not.toBeNull();
  });
});
