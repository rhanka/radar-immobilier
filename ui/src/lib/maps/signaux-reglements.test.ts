import { describe, it, expect } from "vitest";
import type { RegulatoryStatusT } from "@radar/domain";
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
  readNodeEtape,
  readReglementNumbers,
  reglementSourceViewerTitle,
} from "./signaux-reglements.js";

function node(
  id: string,
  props: Record<string, unknown>,
  regulatoryStatus: RegulatoryStatusT | null = "firm",
): GraphSignalNode {
  return {
    id,
    type: "DesignationEvent",
    label: id,
    citySlug: "delson",
    sourceRef: null,
    createdAt: null,
    regulatoryStatus,
    props,
  };
}

type ServedNode = GraphSignalNode & { etape: string | null };

function servedNode(
  id: string,
  props: Record<string, unknown>,
  etape: string | null,
  regulatoryStatus: RegulatoryStatusT | null = null,
): ServedNode {
  return { ...node(id, props, regulatoryStatus), etape };
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

describe("readNodeEtape — D5 drawer lit sans re-classifier", () => {
  it("lit node.etape servi en priorité sur le fallback legacy", () => {
    const served = servedNode(
      "avis de motion dans le libellé",
      { properties: { etape: "avis_motion" } },
      "  AdOpTiOn ",
    );

    expect(readNodeEtape(served)).toBe("adoption");
  });

  it("n'invente aucune étape depuis le libellé quand le servi et le legacy sont absents", () => {
    expect(readNodeEtape(node("Adoption du règlement 2026-100", {}))).toBeNull();
  });
});

describe("isReglementAvisOnly", () => {
  it.each([
    [["avis_motion"]],
    [["avis_motion", "piia"]],
    [["avis_motion", "derogation_mineure"]],
    [["avis_motion", "ppcmoi"]],
    [["avis_motion", "usage_conditionnel"]],
    [["avis_motion", "accorde"]],
  ])("removes stages %j", (stages) => {
    expect(isReglementAvisOnly(new Set(stages))).toBe(true);
  });

  it.each([
    [["piia"]],
    [["derogation_mineure"]],
    [[]],
    [["avis_motion", "adoption"]],
    [["avis_motion", "premier_projet"]],
    [["avis_motion", "second_projet"]],
    [["avis_motion", "projet_reglement"]],
    [["avis_motion", "consultation_publique"]],
    [["avis_motion", "entree_vigueur"]],
    [["avis_motion", "inconnu"]],
  ])("keeps stages %j", (stages) => {
    expect(isReglementAvisOnly(new Set(stages))).toBe(false);
  });
});

describe("aggregateReglements", () => {
  it("masque les statuts non-firm après lecture de node.etape", () => {
    const steMartineAvisOnly = [
      "025-500",
      "026-508",
      "026-509",
      "026-510",
      "026-502",
    ];
    const nodes = [
      ...steMartineAvisOnly.map((number, index) =>
        servedNode(
          `ste-martine-${index}`,
          { properties: { reglement_number: number } },
          "avis_motion",
        ),
      ),
      servedNode(
        "barnston-avis",
        { properties: { reglement_number: "328-2026" } },
        "avis_motion",
      ),
      servedNode(
        "barnston-piia",
        { properties: { reglement_number: "328-2026" } },
        "piia",
      ),
      servedNode("adoption", { reglement_number: "Adoption 100" }, "adoption"),
      servedNode("premier", { reglement_number: "Premier 200" }, "premier_projet"),
      servedNode("mix-avis", { reglement_number: "Mixte 300" }, "avis_motion"),
      servedNode("mix-premier", { reglement_number: "Mixte 300" }, "premier_projet"),
      node("sans-etape", { reglement_number: "Sans Etape 400" }),
      servedNode("piia-seul", { reglement_number: "PIIA 500" }, "piia"),
    ];

    const numbers = aggregateReglements(nodes).map((entry) => entry.number);

    expect(numbers.filter((number) => steMartineAvisOnly.includes(number))).toEqual([]);
    expect(numbers).not.toContain("328-2026");
    expect(numbers).toEqual(["Adoption 100", "Sans Etape 400"]);
  });

  it("applique le fallback firm-only après agrégation des étapes legacy", () => {
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
      node("barnston-avis", {
        properties: { etape: "avis_motion", reglement_number: "328-2026" },
      }),
      node("barnston-piia", {
        properties: { etape: "piia", reglement_number: "328-2026" },
      }),
      node("closed-avis", {
        properties: { etape: "avis_motion", reglement_number: "FeRmE 100" },
      }),
      node("closed-adoption", {
        properties: { etape: "adoption", reglement_number: "ferme 100" },
      }),
      node("unknown-avis", {
        properties: { etape: "avis_motion", reglement_number: "InCoNnU 200" },
      }),
      node("unknown-stage", {
        properties: {
          etape: "inconnu",
          reglement_number: "inconnu 200",
        },
      }),
      node("sans-etape", {
        properties: { reglement_number: "Sans Etape 300" },
      }),
      node("piia", {
        properties: { etape: "piia", reglement_number: "PIIA 400" },
      }),
    ].map((node) => ({ ...node, regulatoryStatus: null }));

    const numbers = aggregateReglements(nodes).map((entry) => entry.number);

    expect(numbers.filter((number) => avisOnlyNumbers.includes(number))).toEqual([]);
    expect(numbers).not.toContain("328-2026");
    expect(numbers).toEqual(["FeRmE 100"]);
  });

  it("montre un règlement adopté avec regulatoryStatus firm", () => {
    const entries = aggregateReglements([
      servedNode("adoption", { reglement_number: "2026-100" }, "adoption", "firm"),
    ]);

    expect(entries).toMatchObject([
      { number: "2026-100", regulatoryStatus: "firm" },
    ]);
  });

  it.each(["projet_reglement", "second_projet", "avis_motion"])(
    "masque un règlement à l'étape %s",
    (etape) => {
      const entries = aggregateReglements([
        servedNode(etape, { reglement_number: `REG-${etape}` }, etape, "anticipation"),
      ]);

      expect(entries).toEqual([]);
    },
  );

  it("masque Brossard REG-362-46/49 quand tous ses nœuds sont en anticipation", () => {
    const entries = aggregateReglements([
      servedNode(
        "brossard-projet",
        { reglement_number: "REG-362-46/49" },
        "projet_reglement",
        "anticipation",
      ),
      servedNode(
        "brossard-second",
        { reglement_number: "REG-362-46/49" },
        "second_projet",
        "anticipation",
      ),
    ]);

    expect(entries).toEqual([]);
  });

  it("masque uniformément les règlements non-firm des trois villes", () => {
    const entries = aggregateReglements([
      {
        ...servedNode("ste-martine", { reglement_number: "026-508" }, "avis_motion", "anticipation"),
        citySlug: "sainte-martine",
      },
      {
        ...servedNode("st-bruno", { reglement_number: "URB-Z17" }, "second_projet", "anticipation"),
        citySlug: "saint-bruno-de-montarville",
      },
      {
        ...servedNode("brossard", { reglement_number: "REG-362-46" }, "projet_reglement", "anticipation"),
        citySlug: "brossard",
      },
    ]);

    expect(entries).toEqual([]);
  });

  it("dérive firm depuis adoption quand regulatoryStatus est null", () => {
    const entries = aggregateReglements([
      servedNode("legacy-adoption", { reglement_number: "2026-101" }, "adoption", null),
    ]);

    expect(entries).toMatchObject([
      { number: "2026-101", regulatoryStatus: "firm" },
    ]);
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
