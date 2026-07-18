import { describe, it, expect } from "vitest";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type { GeoZoneFeature } from "$lib/maps/geo-zones-client.js";
import {
  aggregateReglements,
  normalizeReglementKey,
  readReglementNumbers,
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
});

describe("normalizeReglementKey", () => {
  it("neutralise casse et espaces (garde le tiret)", () => {
    expect(normalizeReglementKey(" 2008-102 ")).toBe("2008-102");
    expect(normalizeReglementKey("URB 2008-102")).toBe("urb2008-102");
  });
});

describe("aggregateReglements", () => {
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
