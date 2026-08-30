import { describe, it, expect } from "vitest";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type {
  GeoZoneFeature,
  GeoZonesResponse,
} from "$lib/maps/geo-zones-client.js";
import {
  aggregateReglements,
  enrichGeoZonesWithSignalReglements,
  isReglementAvisOnly,
  normalizeReglementKey,
  readReglementNumbers,
  reglementSourceViewerTitle,
} from "./signaux-reglements.js";

function node(id: string, props: Record<string, unknown>): GraphSignalNode {
  return {
    id,
    type: "DesignationEvent",
    label: id,
    citySlug: "delson",
    sourceRef: null,
    createdAt: null,
    props,
  };
}

function zone(code: string, grillePdfUrl?: string): GeoZoneFeature {
  return {
    type: "Feature",
    geometry: null,
    properties: {
      code,
      citySlug: "delson",
      geometryStatus: "official",
      confidence: 1,
      source: "official-zone",
      lotCount: 0,
      lots: [],
      ...(grillePdfUrl ? { grillePdfUrl } : {}),
    },
  };
}

describe("readReglementNumbers", () => {
  it("lit un numéro scalaire (reglement_number)", () => {
    expect(readReglementNumbers(node("s", { reglement_number: "2021-45" }))).toEqual([
      "2021-45",
    ]);
  });

  it("lit un tableau (reglementNumbers) et déduplique par clé normalisée", () => {
    const got = readReglementNumbers(
      node("s", { reglementNumbers: ["2021-45", "2021-45", "2021-46"] }),
    );
    expect(got).toEqual(["2021-45", "2021-46"]);
  });

  it("accepte un numéro numérique et ignore les valeurs vides", () => {
    expect(readReglementNumbers(node("s", { reglement_numero: 1926 }))).toEqual(["1926"]);
    expect(readReglementNumbers(node("s", { reglement_number: "   " }))).toEqual([]);
    expect(readReglementNumbers(node("s", {}))).toEqual([]);
  });

  it("lit reglement_number IMBRIQUÉ sous props.properties (rien au top-level)", () => {
    // Régression #drawer-vide : graphify range reglement_number sous
    // props.properties sur 154 villes (ex. delson → "756"). Sans lecture
    // imbriquée, readReglementNumbers renvoyait [] → drawer Règlements vide.
    expect(
      readReglementNumbers(node("s", { properties: { reglement_number: "756" } })),
    ).toEqual(["756"]);
  });

  it("déduplique entre top-level et props.properties (même numéro)", () => {
    expect(
      readReglementNumbers(
        node("s", { reglement_number: "756", properties: { reglement_number: "756" } }),
      ),
    ).toEqual(["756"]);
  });
});

describe("normalizeReglementKey", () => {
  it("neutralise casse et espaces (garde le tiret)", () => {
    expect(normalizeReglementKey(" 2008-102 ")).toBe("2008-102");
    expect(normalizeReglementKey("URB 2008-102")).toBe("urb2008-102");
  });
});

describe("isReglementAvisOnly", () => {
  it("conserve un règlement sans étape connue", () => {
    expect(isReglementAvisOnly(new Set())).toBe(false);
  });

  it("identifie un agrégat contenant uniquement avis_motion", () => {
    expect(isReglementAvisOnly(new Set(["avis_motion"]))).toBe(true);
  });

  it("conserve un agrégat contenant une autre étape", () => {
    expect(isReglementAvisOnly(new Set(["avis_motion", "premier_projet"]))).toBe(
      false,
    );
    expect(isReglementAvisOnly(new Set(["piia"]))).toBe(false);
  });
});

describe("aggregateReglements", () => {
  it("retire les numéros avis-only après agrégation sans sur-supprimer", () => {
    const avisOnlyNumbers = [
      "025-500",
      "026-508",
      "026-509",
      "026-510",
      "026-502",
    ];
    const nodes = [
      ...avisOnlyNumbers.map((number, index) =>
        node(`avis-${index}`, {
          properties: { etape: "avis_motion", reglement_number: number },
        }),
      ),
      node("adoption", {
        properties: { etape: "adoption", reglement_number: "Controle 100" },
      }),
      node("premier-controle", {
        properties: {
          etape: "premier_projet",
          reglement_number: "Controle 100",
        },
      }),
      node("mixte-avis-1", {
        properties: { etape: "avis_motion", reglement_number: "MiXtE 200" },
      }),
      node("mixte-avis-2", {
        properties: { etape: "avis_motion", reglement_number: "mixte 200" },
      }),
      node("mixte-projet", {
        properties: {
          etape: "premier_projet",
          reglement_number: "MIXTE 200",
        },
      }),
      node("sans-etape", {
        properties: { reglement_number: "Sans Etape 300" },
      }),
      node("piia", {
        properties: { etape: "piia", reglement_number: "PIIA 400" },
      }),
    ];

    const numbers = aggregateReglements(nodes).map((entry) => entry.number);

    expect(numbers.filter((number) => avisOnlyNumbers.includes(number))).toEqual([]);
    expect(numbers).toEqual(
      expect.arrayContaining([
        "Controle 100",
        "MiXtE 200",
        "Sans Etape 300",
        "PIIA 400",
      ]),
    );
  });

  it("groupe par numéro, compte les signaux et collecte les zones citées", () => {
    const nodes = [
      node("a", { reglement_number: "2021-45", zone_ref: "H-431" }),
      node("b", { reglement_number: "2021-45", zone_ref: "H-102" }),
    ];
    const [entry] = aggregateReglements(nodes, []);
    expect(entry.number).toBe("2021-45");
    expect(entry.signalCount).toBe(2);
    expect(entry.signalNodeIds).toEqual(["a", "b"]);
    expect(entry.zoneCodes).toEqual(["H-431", "H-102"]);
  });

  it("préfère un signal à rawRef comme représentant ouvrable", () => {
    const nodes = [
      // source URL seule (ouvrable mais pas rawRef)
      node("url-only", {
        reglement_number: "2021-45",
        sourceUrl: "https://ville.qc.ca/reg.pdf",
      }),
      // rawRef same-origin → préféré
      node("raw", {
        reglement_number: "2021-45",
        rawRef: "raw/pv/2026/05/reg.txt",
      }),
    ];
    const [entry] = aggregateReglements(nodes, []);
    expect(entry.evidenceNodeId).toBe("raw");
  });

  it("evidenceNodeId null quand aucun signal citant n'a de source ouvrable", () => {
    const [entry] = aggregateReglements(
      [node("a", { reglement_number: "2021-45", zone_ref: "H-431" })],
      [],
    );
    expect(entry.evidenceNodeId).toBeNull();
  });

  it("rattache la grille PDF des zones liées (jointure par clé comparable)", () => {
    const nodes = [node("a", { reglement_number: "2021-45", zone_ref: "H431" })];
    const zones = [zone("H-431", "https://ville.qc.ca/grille-h431.pdf")];
    const [entry] = aggregateReglements(nodes, zones);
    expect(entry.grillePdfUrls).toEqual(["https://ville.qc.ca/grille-h431.pdf"]);
  });

  it("trie par nombre de signaux décroissant puis numéro", () => {
    const nodes = [
      node("a", { reglement_number: "A-1" }),
      node("b", { reglement_number: "B-2" }),
      node("c", { reglement_number: "B-2" }),
    ];
    const entries = aggregateReglements(nodes, []);
    expect(entries.map((e) => e.number)).toEqual(["B-2", "A-1"]);
  });

  it("ignore les signaux sans numéro de règlement (rien de fabriqué)", () => {
    expect(aggregateReglements([node("a", { zone_ref: "H-431" })], [])).toEqual([]);
  });
});

function zonesResponse(features: GeoZoneFeature[]): GeoZonesResponse {
  return {
    ok: true,
    citySlug: "delson",
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: features.length,
    warnings: [],
    featureCollection: { type: "FeatureCollection", features },
  };
}

describe("enrichGeoZonesWithSignalReglements", () => {
  it("injecte le règlement du graphe-signal dans une zone que geo laisse muette", () => {
    const response = zonesResponse([zone("H-315")]);
    const enriched = enrichGeoZonesWithSignalReglements(response, [
      node("e", {
        zone_ref: "H-315",
        reglement_number: "756",
        sourceUrl: "https://ville.delson.qc.ca/pv.pdf",
      }),
    ]);
    const p = enriched!.featureCollection.features[0].properties;
    expect(p.reglementNumero).toBe("756");
    expect(p.reglementUrl).toBe("https://ville.delson.qc.ca/pv.pdf");
  });

  it("LE GEO GAGNE : une zone qui porte déjà un numéro geo n'est jamais écrasée", () => {
    const geoZone = zone("H-315");
    geoZone.properties.reglementNumero = "901";
    geoZone.properties.reglementUrl = "https://ville.delson.qc.ca/grille.pdf";
    const enriched = enrichGeoZonesWithSignalReglements(zonesResponse([geoZone]), [
      node("e", {
        zone_ref: "H-315",
        reglement_number: "756",
        sourceUrl: "https://ville.delson.qc.ca/pv.pdf",
      }),
    ]);
    const p = enriched!.featureCollection.features[0].properties;
    expect(p.reglementNumero).toBe("901");
    expect(p.reglementUrl).toBe("https://ville.delson.qc.ca/grille.pdf");
  });

  it("une zone sans match reste muette (reglementNumero absent — jamais deviné)", () => {
    const enriched = enrichGeoZonesWithSignalReglements(zonesResponse([zone("Z-999")]), [
      node("e", {
        zone_ref: "H-315",
        reglement_number: "756",
        sourceUrl: "https://ville.delson.qc.ca/pv.pdf",
      }),
    ]);
    expect(enriched!.featureCollection.features[0].properties.reglementNumero).toBeUndefined();
  });

  it("join tolérant au format (H315 ↔ H-315) via zoneRefComparableKey", () => {
    const enriched = enrichGeoZonesWithSignalReglements(zonesResponse([zone("H-315")]), [
      node("e", { zone_ref: "H315", reglement_number: "756", sourceUrl: "https://x/pv.pdf" }),
    ]);
    expect(enriched!.featureCollection.features[0].properties.reglementNumero).toBe("756");
  });

  it("renvoie la MÊME référence quand aucun règlement n'est dérivable (non destructif)", () => {
    const response = zonesResponse([zone("H-315")]);
    // Nœuds sans règlement rattachable → map vide → passe-plat.
    expect(enrichGeoZonesWithSignalReglements(response, [node("e", { zone_ref: "H-315" })])).toBe(
      response,
    );
  });

  it("passe-plat sur une réponse null", () => {
    expect(enrichGeoZonesWithSignalReglements(null, [])).toBeNull();
  });
});

describe("reglementSourceViewerTitle — §3.1 : distinguer le PV source du PDF du règlement", () => {
  // Le drawer Règlements ouvre, dans le viewer partagé, la SOURCE documentaire du
  // signal représentatif : le PROCÈS-VERBAL qui CITE le règlement — jamais le
  // texte du règlement lui-même (aucun PDF de règlement n'est modélisé, seul le
  // PV du signal et, à part, la grille de zonage le sont). Le titre du viewer
  // doit le dire explicitement, sinon on substitue le PV au règlement (régression
  // introduite par le drawer Règlements, commit 069e82b).
  it("étiquette le document ouvert comme le PV SOURCE, pas comme le PDF du règlement", () => {
    const entries = aggregateReglements([
      node("evt", {
        reglement_number: "2021-45",
        zone_ref: "H-315",
        rawRef: "raw/pv-delson/cas/abc.pdf",
        sourceUrl: "https://ville.delson.qc.ca/pv.pdf",
        page: 24,
      }),
    ]);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    // La « source » d'un règlement EST le PV du signal représentatif (rawRef).
    expect(entry.evidenceNodeId).toBe("evt");

    const title = reglementSourceViewerTitle(entry.number);
    // Distinction exacte : le titre marque un PV / une source, pas le règlement.
    expect(title).toMatch(/PV|proc[eè]s-verbal|source/i);
    // Régression 069e82b : ne JAMAIS présenter le PV comme s'il était le règlement.
    expect(title).not.toBe(`Règlement ${entry.number}`);
    // Traçabilité : le numéro de règlement reste visible dans le titre.
    expect(title).toContain("2021-45");
  });
});
