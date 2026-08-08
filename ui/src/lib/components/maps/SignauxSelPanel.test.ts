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
import {
  createSelectionBucketState,
  makeKey,
  type SelectionBucketState,
} from "$lib/maps/selection-bucket.js";
import Harness from "./SignauxSelPanelHarness.svelte";

/**
 * État de sélection avec une ZONE active (focusée). Le bucket Zones ayant été
 * retiré (01KZGM07 item 1), les tests entrent en « vue zone » via cet état
 * pré-posé (parité stricte avec le clic carte / le badge zone d'un lot), au lieu
 * de cliquer une ligne de zone qui n'existe plus.
 */
function zoneFocusState(code: string, citySlug = "delson"): SelectionBucketState {
  const key = makeKey("zone", `${citySlug}/${code}`);
  return createSelectionBucketState({ focusedKey: key, selectedKeys: [key] });
}

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

  // #2b — object-storage PUBLIC non signé (VPlus, sites muni) : source canonique
  // légitime → lien direct cliquable (était rejeté par l'ancien garde s3).
  it("#2b object-storage PUBLIC (VPlus s3) non signé → lien direct cliquable", async () => {
    const url =
      "https://vplus-documents.s3.ca-central-1.amazonaws.com/batiscan/_publication/fichiers/pv.pdf";
    const { getByText, getByTestId } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [sigWithProps("sig-s3", { sourceUrl: url })] },
    });
    await fireEvent.click(getByText("sig-s3", { selector: ".sel-entity-label" }));
    expect(getByTestId("signal-proof-direct-link").getAttribute("href")).toBe(url);
  });

  // #2b — URL S3 SIGNÉE : jamais exposée comme lien direct (garde signature).
  it("#2b URL S3 signée (X-Amz-Signature) → AUCUN lien direct (jamais exposée)", async () => {
    const signed =
      "https://vplus-documents.s3.ca-central-1.amazonaws.com/x/pv.pdf?X-Amz-Signature=abc&X-Amz-Credential=AKIA";
    const { getByText, queryByTestId } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [sigWithProps("sig-signed", { sourceUrl: signed })] },
    });
    await fireEvent.click(getByText("sig-signed", { selector: ".sel-entity-label" }));
    expect(queryByTestId("signal-proof-direct-link")).toBeNull();
  });
});

describe("SignauxSelPanel — #3a panneau « Zone active » pinné (01KZGM07 item 1)", () => {
  it("absent tant qu'aucune zone n'est focusée", () => {
    const zones = makeZonesResponse(["H-431"]);
    const { queryByTestId } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: [], zonesResponse: zones },
    });
    expect(queryByTestId("sel-zone-head")).toBeNull();
  });

  it("zone active → panneau pinné (code + « lots liés » + détail dépliable)", () => {
    const zones = makeZonesResponse(["H-431"]);
    zones.featureCollection.features[0]!.properties.kind = "habitation";
    const { getByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zones,
        selectionState: zoneFocusState("H-431"),
      },
    });
    // Panneau « Zone active » pinné rendu (plus de bucket Zones : on entre en vue
    // zone par l'état de sélection, comme le clic carte / le badge zone d'un lot).
    const head = getByTestId("sel-zone-head");
    expect(head.textContent).toContain("Zone active");
    expect(head.textContent).toContain("H-431");
    expect(head.textContent).toContain("lots liés");
    expect(getByTestId("sel-zone-head-more")).toBeTruthy();
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
    const { getByText, queryByText, queryAllByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([enrichedLot]),
      },
    });

    await fireEvent.click(getByText("5399042"));

    // #3b(c) : le code zone apparaît légitimement 2× (pin « Lot actif » +
    // détail inline) — les deux sont servis par geo, aucun n'est fabriqué.
    expect(queryAllByText("H-431").length).toBeGreaterThan(0);
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

  it("badge zone cliquable → focalise la zone (panneau pinné « Zone active »)", async () => {
    const { getByText, getByTestId, queryByTestId, getByTitle } = render(Harness, {
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
    // Avant le clic : aucune zone active pinnée.
    expect(queryByTestId("sel-zone-head")).toBeNull();

    await fireEvent.click(badge);
    // 01KZGM07 item 1 : plus de drawer de zone ; le badge focalise la zone, qui
    // s'affiche dans le panneau pinné « Zone active » (code + type dérivé).
    const head = getByTestId("sel-zone-head");
    expect(head.textContent).toContain("H-431");
    expect(head.textContent).toContain("Habitation");
  });
});

// ── En-tête de filtre de l'accordéon Lots (drawer droit) ─────────────────────
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

describe("SignauxSelPanel — #3b(b) bucket Lots filtré ⊆ zone focusée", () => {
  const zones = makeZonesResponse(["H-431", "C-02"]);
  const lots = [
    makeLot("100", { zoneCode: "H-431" }),
    makeLot("200", { zoneCode: "C-02" }),
  ];

  it("vue ville (aucune zone focusée) → les DEUX lots sont listés (règle 3)", () => {
    const { getByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zones,
        lotsResponse: makeLotsResponse(lots),
      },
    });
    expect(getByText("100", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(getByText("200", { selector: ".sel-entity-label" })).not.toBeNull();
  });

  it("zone H-431 active → seuls ses lots (100) restent listés (règle 4)", () => {
    const { getByText, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        zonesResponse: zones,
        lotsResponse: makeLotsResponse(lots),
        selectionState: zoneFocusState("H-431"),
      },
    });
    expect(getByText("100", { selector: ".sel-entity-label" })).not.toBeNull();
    expect(queryByText("200", { selector: ".sel-entity-label" })).toBeNull();
  });
});

describe("SignauxSelPanel — nav-drill 01KZEG78 : PAS de panneau « Lot actif »", () => {
  it("focus lot → AUCUN pin « Lot actif » (spec owner) ; le lot reste dans sa fiche", async () => {
    const lots = [
      makeLot("5399042", { zoneCode: "H-431", superficieM2: 850.4 }),
    ];
    const { getByText, queryByTestId, queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse(lots),
      },
    });
    // Spec owner (retrait de la vue « Lot actif ») : jamais de pin, même au focus.
    expect(queryByTestId("sel-lot-head")).toBeNull();

    await fireEvent.click(getByText("5399042", { selector: ".sel-entity-label" }));

    // Toujours pas de pin « Lot actif » après focus (l'actif épinglé = Ville/Zone
    // uniquement) ; le lot vit dans sa fiche/drawer, pas dans un header épinglé.
    expect(queryByTestId("sel-lot-head")).toBeNull();
    expect(queryByTestId("sel-lot-head-more")).toBeNull();
    expect(queryByText("Lot actif")).toBeNull();
  });
});

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

// ── m7 — accordéon Règlements (entre Signaux et Lots) ────────────────────────

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

// ── 01KZGM07 item 2 — Signaux / Règlements restreints à la ZONE ACTIVE ────────
// Quand une zone est active, Signaux ET Règlements ne listent QUE les entités
// rattachées à cette zone — EXCEPTION owner : les entités NON rattachées à une
// zone (aucun code de zone) sont GARDÉES. Hors focus zone : liste complète.

describe("SignauxSelPanel — item 2 : Signaux/Règlements ⊆ zone active + exception non-rattachés", () => {
  function zsig(
    id: string,
    label: string,
    props: Record<string, unknown>,
  ): GraphSignalNode {
    return {
      id,
      type: "DesignationEvent",
      label,
      citySlug: "delson",
      sourceRef: null,
      createdAt: "2026-05-19T12:00:00.000Z",
      publishedAt: "2026-05-19T12:00:00.000Z",
      props: { description: "detail neutre", ...props },
    };
  }

  // alpha rattaché à H-431 ; beta à C-02 (autre zone) ; gamma sans aucune zone.
  const nodes: GraphSignalNode[] = [
    zsig("z-alpha", "Signal alpha", { zone_ref: "H-431", reglement_number: "R-100" }),
    zsig("z-beta", "Signal beta", { zone_ref: "C-02", reglement_number: "R-200" }),
    zsig("z-gamma", "Signal gamma", { reglement_number: "R-300" }),
  ];
  const zones = makeZonesResponse(["H-431", "C-02"]);

  it("vue ville (aucune zone active) : tous les signaux ET règlements listés", () => {
    const { queryByText } = render(Harness, {
      props: { selectedCity: makeCity(), detailNodes: nodes, zonesResponse: zones },
    });
    for (const label of ["Signal alpha", "Signal beta", "Signal gamma"]) {
      expect(queryByText(label, { selector: ".sel-entity-label" })).not.toBeNull();
    }
    for (const reg of ["R-100", "R-200", "R-300"]) {
      expect(queryByText(reg)).not.toBeNull();
    }
  });

  it("zone H-431 active : signal rattaché H-431 + signal NON rattaché gardés ; autre zone exclue", () => {
    const { queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: nodes,
        zonesResponse: zones,
        selectionState: zoneFocusState("H-431"),
      },
    });
    // Rattaché à la zone active → gardé.
    expect(queryByText("Signal alpha", { selector: ".sel-entity-label" })).not.toBeNull();
    // Non rattaché à une zone → GARDÉ (exception impérative owner).
    expect(queryByText("Signal gamma", { selector: ".sel-entity-label" })).not.toBeNull();
    // Rattaché à une AUTRE zone (C-02) → exclu.
    expect(queryByText("Signal beta", { selector: ".sel-entity-label" })).toBeNull();
  });

  it("zone H-431 active : règlement rattaché (R-100) + non rattaché (R-300) gardés ; R-200 exclu", () => {
    const { queryByText } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: nodes,
        zonesResponse: zones,
        selectionState: zoneFocusState("H-431"),
      },
    });
    expect(queryByText("R-100")).not.toBeNull(); // rattaché H-431
    expect(queryByText("R-300")).not.toBeNull(); // non rattaché → gardé
    expect(queryByText("R-200")).toBeNull(); // rattaché C-02 → exclu
  });
});

// ── 01KZGM07 item 3 — fiche lot dépliée INLINE dans la liste des lots ─────────

describe("SignauxSelPanel — item 3 : fiche lot inline (drawer sous la ligne)", () => {
  const lot = makeLot("5399042", {
    zoneCode: "H-431",
    superficieM2: 850.4,
    adresse: "10 rue Principale",
    codePostal: "J5A",
    multifamilial4plus: true,
  });

  it("clic lot → drawer inline (sel-lot-drawer) sous sa ligne, avec adresse + superficie", async () => {
    const { getByText, getByTestId, queryByTestId } = render(Harness, {
      props: {
        selectedCity: makeCity(),
        detailNodes: [],
        lotsResponse: makeLotsResponse([lot]),
      },
    });
    // Avant le clic : aucune fiche lot dépliée.
    expect(queryByTestId("sel-lot-drawer")).toBeNull();

    await fireEvent.click(getByText("5399042", { selector: ".sel-entity-label" }));

    // La fiche se déplie INLINE (dans le bucket Lots), pas dans une vue séparée.
    const drawer = getByTestId("sel-lot-drawer");
    expect(drawer.textContent).toContain("10 rue Principale");
    expect(drawer.textContent).toContain("850 m²");
    // Preuve « inline » : le drawer est un enfant de la LIGNE du lot (sel-entity-bar).
    expect(drawer.closest(".sel-entity-bar")).not.toBeNull();
  });
});
