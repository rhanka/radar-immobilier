/**
 * purge-avis-bylaws — tests du cœur PUR `planCityPurge` (derive-live + ASSERT-vs-oracle
 * + pré-flight sibling + remove-edges + idempotence + grouping A1-safe).
 *
 * Graphes latest.json synthétiques (nodes/edges) ; aucune I/O. La vraie
 * suppression PG (upsertGraphAtomic) est couverte ailleurs (graph-store) + à
 * confirmer sur la 1re ville en --apply (0 abort réel, i-arch).
 */
import { describe, expect, it } from "vitest";
import { planCityPurge, parseOracleTsv, nodeReglementKey } from "./purge-avis-bylaws.js";

type N = Record<string, unknown>;
const bylaw = (id: string, numero: string, etape?: string): N => ({
  id,
  type: "Bylaw",
  properties: { reglement_number: numero, ...(etape ? { etape } : {}) },
});
const de = (id: string, cible: string, etape = "avis_motion"): N => ({
  id,
  type: "DesignationEvent",
  properties: { cibleReglementNumero: cible, etape },
});
const signal = (id: string, numero: string, etape = "avis_motion"): N => ({
  id,
  type: "Signal",
  properties: { reglement_number: numero, etape },
});
const ids = (plan: { nextGraph: Record<string, unknown> }) =>
  (plan.nextGraph.nodes as N[]).map((n) => n.id as string);

describe("planCityPurge — remove-safe (avis-only : Bylaw + DesignationEvent frère)", () => {
  it("retire le stale avis-Bylaw + ses edges, garde le DE frère et les Bylaws adoptés", () => {
    const graph = {
      nodes: [
        bylaw("bylaw-x-325", "325-2026"), // etape null = stale avis-Bylaw
        de("event-x-avis-325", "325-2026"),
        signal("signal-x-325", "325-2026"),
        bylaw("bylaw-x-999", "999-2026", "adoption"), // adopté → PROTÉGÉ
      ],
      edges: [
        { source: "bylaw-x-325", target: "signal-x-325", relation: "cites" },
        { source: "event-x-avis-325", target: "signal-x-325", relation: "cites" },
      ],
    };
    const plan = planCityPurge(graph, "x", ["bylaw-x-325"]);
    expect(plan.assertOk).toBe(true);
    expect(plan.removed).toEqual(["bylaw-x-325"]);
    expect(plan.changed).toBe(true);
    expect(ids(plan)).not.toContain("bylaw-x-325");
    expect(ids(plan)).toContain("bylaw-x-999"); // adopté conservé
    expect(ids(plan)).toContain("event-x-avis-325"); // avis canonique conservé
    // edge référençant le Bylaw retiré = enlevée ; l'autre reste.
    expect((plan.nextGraph.edges as N[]).some((e) => e.source === "bylaw-x-325" || e.target === "bylaw-x-325")).toBe(false);
    expect((plan.nextGraph.edges as N[]).length).toBe(1);
  });
});

describe("planCityPurge — ASSERT-vs-oracle (fail-safe HALT, jamais wrong-removal)", () => {
  it("un avis-Bylaw présent HORS oracle → HALT (0 removal, graphe intact)", () => {
    const graph = {
      nodes: [bylaw("bylaw-x-325", "325"), de("e1", "325"), bylaw("bylaw-x-777", "777"), de("e2", "777")],
    };
    const plan = planCityPurge(graph, "x", ["bylaw-x-325"]); // oracle rate 777
    expect(plan.assertOk).toBe(false);
    expect(plan.assertDiff?.onlyDerived).toEqual(["bylaw-x-777"]);
    expect(plan.removed).toEqual([]);
    expect(plan.changed).toBe(false);
    expect(plan.nextGraph).toBe(graph); // intact
  });

  it("un oracle-Bylaw présent qui n'est PLUS avis-only (adopté depuis) → HALT (drift)", () => {
    const graph = {
      nodes: [bylaw("bylaw-x-325", "325", "adoption"), de("e1", "325")], // adopté → pas dérivé
    };
    const plan = planCityPurge(graph, "x", ["bylaw-x-325"]); // oracle l'attend encore
    expect(plan.assertOk).toBe(false);
    expect(plan.assertDiff?.onlyOraclePresent).toEqual(["bylaw-x-325"]);
    expect(plan.removed).toEqual([]);
  });
});

describe("planCityPurge — pré-flight (a) sibling DesignationEvent belt-and-suspenders", () => {
  it("avis-only via Signal SEUL (0 DesignationEvent) → SKIP + flag (ne perd pas l'avis canonique)", () => {
    const graph = { nodes: [bylaw("bylaw-x-325", "325"), signal("signal-x-325", "325", "avis_motion")] };
    const plan = planCityPurge(graph, "x", ["bylaw-x-325"]);
    expect(plan.assertOk).toBe(true); // dérivé==oracle (avis-only), mais…
    expect(plan.removed).toEqual([]); // …pas de DE frère → skip
    expect(plan.skipped).toEqual([{ nodeId: "bylaw-x-325", reason: "no-sibling-avis-DesignationEvent" }]);
    expect(plan.changed).toBe(false);
  });
});

describe("planCityPurge — IDEMPOTENCE (re-run = no-op)", () => {
  it("oracle-Bylaw déjà ABSENT (retiré au 1er run) → dérivé=[]==présent=[] → no-op", () => {
    const graph = { nodes: [de("event-x-avis-325", "325"), signal("signal-x-325", "325")] }; // Bylaw parti
    const plan = planCityPurge(graph, "x", ["bylaw-x-325"]);
    expect(plan.assertOk).toBe(true);
    expect(plan.removed).toEqual([]);
    expect(plan.changed).toBe(false);
  });
});

describe("planCityPurge — grouping A1-safe (i-arch)", () => {
  it("unifie Bylaw(n°) + DesignationEvent(cible=n°, id SANS le n°) sous la même clé", () => {
    const graph = {
      nodes: [
        { id: "bylaw-x-325", type: "Bylaw", properties: { reglement_number: "325-2026" } },
        // id n'embarque PAS 325 ; le n° vit dans cibleReglementNumero (A1-safe §5)
        { id: "event-x-avis-abcdef", type: "DesignationEvent", properties: { cibleReglementNumero: "325-2026", etape: "avis_motion" } },
      ],
    };
    const plan = planCityPurge(graph, "x", ["bylaw-x-325"]);
    expect(plan.assertOk).toBe(true);
    expect(plan.removed).toEqual(["bylaw-x-325"]); // groupés → avis-only → retiré
  });

  it("nodeReglementKey : DE lit la CIBLE, Bylaw lit son propre n°, normalisés pareil", () => {
    expect(nodeReglementKey({ type: "DesignationEvent", properties: { cibleReglementNumero: "325-2026" } })).toBe("325-2026");
    expect(nodeReglementKey({ type: "Bylaw", properties: { reglement_number: "325-2026" } })).toBe("325-2026");
    expect(nodeReglementKey({ type: "Bylaw", properties: { numero: " 325-2026 " } })).toBe("325-2026");
  });
});

describe("planCityPurge — protège les stades FERMES et inconnu (n'agit QUE sur avis-only)", () => {
  it("règlement ADOPTÉ (etape=adoption) → PAS dérivé → PAS retiré", () => {
    const graph = {
      nodes: [
        { id: "bylaw-x-500", type: "Bylaw", properties: { reglement_number: "500-2026", etape: "adoption" } },
        de("event-x-avis-500", "500-2026"),
      ],
    };
    const plan = planCityPurge(graph, "x", []); // adopté → hors oracle
    expect(plan.assertOk).toBe(true);
    expect(plan.removed).toEqual([]);
  });

  it("`inconnu` présent dans le groupe → PAS dérivé (anti-invention)", () => {
    const graph = {
      nodes: [
        bylaw("bylaw-x-600", "600-2026"),
        de("event-x-avis-600", "600-2026"),
        signal("signal-x-600", "600-2026", "inconnu"),
      ],
    };
    const plan = planCityPurge(graph, "x", []);
    expect(plan.assertOk).toBe(true);
    expect(plan.removed).toEqual([]);
  });
});

describe("parseOracleTsv", () => {
  it("parse city\\treglement_number\\tbylaw_node_id → ids par ville (header sauté)", () => {
    const tsv =
      "city\treglement_number\tbylaw_node_id\n" +
      "barnston-ouest\t325-2026\tbylaw-barnston-ouest-325-2026\n" +
      "barnston-ouest\t326-2026\tbylaw-barnston-ouest-326-2026\n" +
      "sainte-martine\t026-508\tbylaw-sainte-martine-026-508\n";
    const map = parseOracleTsv(tsv);
    expect(map.get("barnston-ouest")).toEqual(["bylaw-barnston-ouest-325-2026", "bylaw-barnston-ouest-326-2026"]);
    expect(map.get("sainte-martine")).toEqual(["bylaw-sainte-martine-026-508"]);
    expect([...map.keys()].length).toBe(2);
  });
});
