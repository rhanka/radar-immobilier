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
import type { GeometryProvenanceStatus } from "$lib/maps/geo-provenance.js";
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

  // Mode 2 — la ville A des signaux mais la plage de dates les masque tous :
  // l'état vide ne doit PAS prétendre que rien n'est indexé.
  it("distingue « aucun signal dans la plage » de « aucun signal indexé »", () => {
    const { container } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        unfilteredSignalCount: 3,
      },
    });

    expect(container.textContent).toContain(
      "Aucun signal dans la plage de dates sélectionnée.",
    );
    expect(container.textContent).not.toContain("Aucun signal indexé");
  });

  it("garde « aucun signal indexé » quand la ville n'a réellement rien", () => {
    const { container } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        unfilteredSignalCount: 0,
      },
    });

    expect(container.textContent).toContain("Aucun signal indexé pour cette ville.");
    expect(container.textContent).not.toContain("dans la plage de dates");
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

describe("SignauxSelPanel — #2a lien de preuve DIRECT (PDF public)", () => {
  function sigWithProps(id: string, props: Record<string, unknown>): GraphSignalNode {
    return {
      id,
      type: "DesignationEvent",
      label: id,
      citySlug: "delson",
      sourceRef: null,
      createdAt: "2026-05-19T12:00:00.000Z",
      description: "x",
      publishedAt: "2026-05-19T12:00:00.000Z",
      props: { description: "x", ...props },
    };
  }

  it("URL https → lien direct « Ouvrir le PDF source » avec href réel (nouvel onglet)", async () => {
    const url = "https://brossard.ca/app/uploads/2026/01/pv.pdf";
    const { getByText, getByTestId } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [sigWithProps("sig-url", { sourceUrl: url })] },
    });
    await fireEvent.click(getByText("sig-url", { selector: ".sel-entity-label" }));
    const link = getByTestId("signal-proof-direct-link");
    expect(link.getAttribute("href")).toBe(url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("URL non http(s) (javascript:) → AUCUN lien direct (garde anti-XSS)", async () => {
    const { getByText, queryByTestId } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [sigWithProps("sig-xss", { sourceUrl: "javascript:alert(1)" })] },
    });
    await fireEvent.click(getByText("sig-xss", { selector: ".sel-entity-label" }));
    expect(queryByTestId("signal-proof-direct-link")).toBeNull();
  });

  it("rawRef seul → PAS de lien public, mais lien ARCHIVE durable same-origin (#2b)", async () => {
    const { getByText, getByTestId, queryByTestId } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [sigWithProps("sig-raw", { rawRef: "raw/proces-verbaux-delson/cas/abc.pdf" })] },
    });
    await fireEvent.click(getByText("sig-raw", { selector: ".sel-entity-label" }));
    expect(queryByTestId("signal-proof-direct-link")).toBeNull();
    const archive = getByTestId("signal-proof-archive-link");
    expect(archive.getAttribute("href")).toBe(
      "/api/documents/raw?rawRef=raw%2Fproces-verbaux-delson%2Fcas%2Fabc.pdf",
    );
  });

  it("URL publique + rawRef → LES DEUX liens (source publique + archive durable)", async () => {
    const { getByText, getByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [
          sigWithProps("sig-both", {
            sourceUrl: "https://terrebonne.ca/wp-content/uploads/pv.pdf",
            rawRef: "raw/proces-verbaux-terrebonne/cas/xyz.pdf",
          }),
        ],
      },
    });
    await fireEvent.click(getByText("sig-both", { selector: ".sel-entity-label" }));
    expect(getByTestId("signal-proof-direct-link").getAttribute("href")).toBe(
      "https://terrebonne.ca/wp-content/uploads/pv.pdf",
    );
    expect(getByTestId("signal-proof-archive-link").getAttribute("href")).toContain(
      "/api/documents/raw?rawRef=",
    );
  });
});

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

// ── m7 — accordéon Règlements (entre Signaux et Zones) ───────────────────────

describe("SignauxSelPanel — m7 accordéon Règlements", () => {
  it("liste le règlement cité par les signaux (numéro + bouton PDF)", () => {
    const { getByText, queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: NODES },
    });
    expect(getByText("Règlements")).not.toBeNull();
    // NODES citent tous « 1926-26 » → une entrée de règlement.
    expect(queryByText("1926-26")).not.toBeNull();
    expect(queryByText("Voir le PDF")).not.toBeNull();
  });

  it("« Voir le PDF » appelle onOpenSource (titre = « Règlement <numéro> »)", async () => {
    const calls: Array<{ title: string; sourceUrl: string | null }> = [];
    const { getByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: NODES,
        onOpenSource: (p: { title: string; sourceUrl: string | null }) =>
          calls.push(p),
      },
    });
    await fireEvent.click(getByText("Voir le PDF"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe("Règlement 1926-26");
  });

  it("aucun règlement cité → état vide honnête (rien de fabriqué)", () => {
    const noReg: GraphSignalNode = {
      id: "no-reg",
      type: "DesignationEvent",
      label: "Signal sans règlement",
      citySlug: "delson",
      sourceRef: null,
      createdAt: null,
      props: { description: "x", zone_ref: "H-431" },
    };
    const { getByText, queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [noReg] },
    });
    expect(getByText("Règlements")).not.toBeNull();
    expect(
      queryByText("Aucun règlement cité par les signaux de cette ville."),
    ).not.toBeNull();
  });
});

// ── m8 — source de la zone (type + ouverture) ────────────────────────────────

describe("SignauxSelPanel — m8 source de la zone", () => {
  function zonesWithGrille(code: string, grillePdfUrl: string): GeoZonesResponse {
    const base = makeZonesResponse([code]);
    base.featureCollection.features[0]!.properties.grillePdfUrl = grillePdfUrl;
    return base;
  }

  it("fiche zone : type de source mentionné + ouverture en viewer (grille servie)", async () => {
    const calls: Array<{ title: string; sourceUrl: string | null }> = [];
    const { getByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zonesWithGrille(
          "H-431",
          "https://ville.qc.ca/grille-h431.pdf",
        ),
        onOpenSource: (p: { title: string; sourceUrl: string | null }) =>
          calls.push(p),
      },
    });
    await fireEvent.click(getByText("H-431", { selector: ".sel-entity-label" }));
    // m8.2 — le type de source est mentionné.
    expect(queryByText("Type de source")).not.toBeNull();
    // m8.1 — la source est ouvrable dans le viewer partagé.
    await fireEvent.click(getByText("Ouvrir la source (PDF)"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sourceUrl).toBe("https://ville.qc.ca/grille-h431.pdf");
  });

  it("fiche zone sans URL servie : type affiché, note « source non ouvrable »", async () => {
    const { getByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: makeZonesResponse(["H-431"]),
      },
    });
    await fireEvent.click(getByText("H-431", { selector: ".sel-entity-label" }));
    expect(queryByText("Type de source")).not.toBeNull();
    expect(queryByText(/Source non ouvrable/)).not.toBeNull();
  });
});

// ── m6 — axe millésime du zonage (fiche + sélecteur masqué mono-cohorte) ──────

describe("SignauxSelPanel — m6 millésime du zonage", () => {
  /** Zones avec millésime + n° de règlement PAR ZONE (axe millésime). */
  function zonesWithMillesime(
    entries: Array<{ code: string; millesime?: string | null; numero?: string | null }>,
  ): GeoZonesResponse {
    const base = makeZonesResponse(entries.map((e) => e.code));
    entries.forEach((e, i) => {
      const props = base.featureCollection.features[i]!.properties;
      if (e.millesime !== undefined) props.reglementMillesime = e.millesime;
      if (e.numero !== undefined) props.reglementNumero = e.numero;
    });
    return base;
  }

  it("fiche zone : affiche « Millésime · règl. » quand geo le sert, SANS écraser le Type de source (m8)", async () => {
    const { getByText, queryByText, getByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zonesWithMillesime([
          { code: "CO-939", millesime: "2008", numero: "2008-102" },
        ]),
      },
    });
    await fireEvent.click(getByText("CO-939", { selector: ".sel-entity-label" }));
    // Ligne millésime visible (valeur combinée « 2008 · règl. 2008-102 »).
    expect(getByTestId("zone-reglement-millesime").textContent).toContain("2008");
    expect(getByTestId("zone-reglement-millesime").textContent).toContain("règl. 2008-102");
    // m8 non régressé : la ligne « Type de source » reste présente.
    expect(queryByText("Type de source")).not.toBeNull();
  });

  it("fiche zone : aucune ligne millésime fabriquée quand geo ne sert rien", async () => {
    const { getByText, queryByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: makeZonesResponse(["H-431"]),
      },
    });
    await fireEvent.click(getByText("H-431", { selector: ".sel-entity-label" }));
    expect(queryByTestId("zone-reglement-millesime")).toBeNull();
  });

  it("sélecteur MASQUÉ tant qu'une seule cohorte est servie (MT = tout 2008)", () => {
    const { queryByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zonesWithMillesime([
          { code: "CO-939", millesime: "2008", numero: "2008-102" },
          { code: "H-431", millesime: "2008", numero: "2008-102" },
        ]),
      },
    });
    expect(queryByTestId("signaux-zone-millesime-select")).toBeNull();
  });

  it("sélecteur VISIBLE dès ≥ 2 millésimes ; choisir un millésime restreint la liste + le compteur N/M", async () => {
    const { getByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zonesWithMillesime([
          { code: "H-2008", millesime: "2008", numero: "2008-102" },
          { code: "H-2020", millesime: "2020", numero: "2020-07" },
          { code: "C-2020", millesime: "2020", numero: "2020-07" },
        ]),
      },
    });

    const select = getByTestId("signaux-zone-millesime-select").querySelector("select");
    expect(select).not.toBeNull();

    // Sélectionne le millésime 2008 (exclusif) → seule H-2008 reste listée ; la
    // couche de type est restreinte au millésime (compteur du header 1/1 :
    // les chips de type reflètent millesimeFilteredZones, pas les 3 zones).
    await fireEvent.change(select!, { target: { value: "2008" } });
    expect(queryByText("H-2008", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("H-2020", { selector: ".sel-entity-label" })).toBeNull();
    expect(queryByText("C-2020", { selector: ".sel-entity-label" })).toBeNull();
    expect(getByTestId("signaux-zone-filter-count").textContent).toBe("1/1");

    // Retour « Tous les millésimes » → toutes les zones reviennent (3/3).
    await fireEvent.change(select!, { target: { value: "__all__" } });
    expect(queryByText("H-2020", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(getByTestId("signaux-zone-filter-count").textContent).toBe("3/3");
  });
});

describe("SignauxSelPanel — audit des sources de zone", () => {
  const labels: Record<GeometryProvenanceStatus, string> = {
    "historical-verified": "Vérification déclarée par la source",
    "legacy-traceable": "Trace historique disponible",
    "candidate-needs-human-confirmation": "À confirmer par une personne",
    orphan: "Source de géométrie non reliée",
  };

  function auditedZones(status: GeometryProvenanceStatus) {
    const response = makeZonesResponse(["H-431"]);
    response.featureCollection.features[0]!.properties.proof = {
      schema_version: "1.0",
      status: status === "historical-verified" ? "complete" : "partial",
      sources: {
        geometry: { status: "available", artifact_uri: "https://geo.example/zone.geojson", upstream_uri: null },
        regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
      },
      zone: null,
      gaps: ["regulation_source_unavailable"],
    };
    response.featureCollection.features[0]!.properties.immo_zone_lot_provenance = {
      contract: "immo-zone-lot-provenance/v1",
      lot_assignment_evidence: { state: "recorded", selected_zone: { collection: "qc-zonage-delson", code: "H-431" }, assignment_method: "area-majority", dominant_fraction: 0.94, multi_zone: false },
      zone_geometry_provenance: { status, public_source: status === "historical-verified" ? { url: "https://ville.example/zonage.geojson" } : null, reason_codes: status === "orphan" ? ["source-identity-unlinked"] : [] },
      acquisition_v2_readiness: { state: "not-ready", unmet_requirement_codes: ["missing-content-sha256"] },
    };
    return response;
  }

  it.each(Object.entries(labels) as Array<[GeometryProvenanceStatus, string]>)("affiche le statut %s", async (status, label) => {
    const view = render(Harness, { props: { selectedCity: makeCity(), detailNodes: [], zonesResponse: auditedZones(status) } });
    await fireEvent.click(view.getByText("H-431", { selector: ".sel-entity-label" }));
    expect(view.getByText(label)).not.toBeNull();
    expect(view.getByText("Source réglementaire indisponible")).not.toBeNull();
  });

  it("n'invente pas de lien lorsque la source publique est nulle", async () => {
    const view = render(Harness, { props: { selectedCity: makeCity(), detailNodes: [], zonesResponse: auditedZones("candidate-needs-human-confirmation") } });
    await fireEvent.click(view.getByText("H-431", { selector: ".sel-entity-label" }));
    expect(view.queryByTestId("zone-geometry-source-link")).toBeNull();
    expect(view.getByText("Empreinte du contenu indisponible")).not.toBeNull();
  });
});
