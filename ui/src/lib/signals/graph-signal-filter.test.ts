/**
 * QA léger — graph-signal-filter : logique de filtrage zonage/multi4/précoce.
 *
 * Vérifie :
 *   1. nodeIsZonage : DesignationEvent → toujours zonage ; Signal avec
 *      catégorie dans ZONAGE_CATEGORIES → zonage ; Signal sans catégorie → non.
 *   2. nodeIsMulti4 : nb_unites_max >= 4 (string ou number) → vrai ; < 4 → faux ;
 *      intensite="haute" → vrai.
 *   3. nodeMatchesSubset : key="" → tout passe ; "z" → seulement zonage ;
 *      "m" → seulement multi4+ ; "z|m" → intersection ; "p" → tout passe
 *      (heuristique non masquante).
 *   4. filterNodesBySubset : même référence si key="" ; filtre correct sinon.
 *
 * Aucun docker, aucune API, aucun composant Svelte.
 */
import { describe, it, expect } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  nodeIsZonage,
  nodeIsMulti4,
  nodeMatchesSubset,
  filterNodesBySubset,
} from "./graph-signal-filter.js";

// ── Helpers de fixtures ──────────────────────────────────────────────────────

function makeNode(
  overrides: Partial<GraphSignalNode> & { props?: Record<string, unknown> },
): GraphSignalNode {
  return {
    id: "test-node",
    type: "Signal",
    label: "Test",
    citySlug: "delson",
    sourceRef: null,
    createdAt: null,
    props: {},
    ...overrides,
  };
}

function designationEvent(id = "de-1"): GraphSignalNode {
  return makeNode({ id, type: "DesignationEvent" });
}

function signalWithCategory(category: string): GraphSignalNode {
  return makeNode({ props: { category } });
}

function signalWithNbUnites(nb: number | string): GraphSignalNode {
  return makeNode({ props: { nb_unites_max: nb } });
}

function signalWithIntensite(intensite: string): GraphSignalNode {
  return makeNode({ props: { intensite } });
}

// ── nodeIsZonage ─────────────────────────────────────────────────────────────

describe("nodeIsZonage", () => {
  it("DesignationEvent est toujours zonage (quelque soit ses props)", () => {
    expect(nodeIsZonage(designationEvent())).toBe(true);
  });

  it("Signal avec catégorie 'rezonage' est zonage", () => {
    expect(nodeIsZonage(signalWithCategory("rezonage"))).toBe(true);
  });

  it("Signal avec catégorie 'derogation' est zonage", () => {
    expect(nodeIsZonage(signalWithCategory("derogation"))).toBe(true);
  });

  it("Signal avec catégorie 'lotissement' est zonage", () => {
    expect(nodeIsZonage(signalWithCategory("lotissement"))).toBe(true);
  });

  it("Signal avec catégorie inconnue n'est pas zonage", () => {
    expect(nodeIsZonage(signalWithCategory("vente"))).toBe(false);
  });

  it("Signal sans catégorie n'est pas zonage", () => {
    expect(nodeIsZonage(makeNode({}))).toBe(false);
  });

  it("catégorie 'densification' est zonage", () => {
    expect(nodeIsZonage(signalWithCategory("densification"))).toBe(true);
  });

  it("catégorie 'patrimoine' est zonage", () => {
    expect(nodeIsZonage(signalWithCategory("patrimoine"))).toBe(true);
  });

  it("#4 — Signal sans category mais etape de zonage est zonage (repli etape)", () => {
    expect(
      nodeIsZonage(makeNode({ props: { etape: "derogation_mineure" } })),
    ).toBe(true);
  });

  it("#4 — Signal avec etape hors-zonage n'est pas zonage", () => {
    expect(nodeIsZonage(makeNode({ props: { etape: "vente" } }))).toBe(false);
  });

  it("#4 — category prime mais etape sert de repli (category NULL)", () => {
    // category absente, etape présente → zonage
    expect(nodeIsZonage(makeNode({ props: { etape: "rezonage" } }))).toBe(true);
  });
});

// ── nodeIsMulti4 ─────────────────────────────────────────────────────────────

describe("nodeIsMulti4", () => {
  it("nb_unites_max=4 (number) → vrai", () => {
    expect(nodeIsMulti4(signalWithNbUnites(4))).toBe(true);
  });

  it("nb_unites_max=10 (number) → vrai", () => {
    expect(nodeIsMulti4(signalWithNbUnites(10))).toBe(true);
  });

  it("nb_unites_max=3 (number) → faux", () => {
    expect(nodeIsMulti4(signalWithNbUnites(3))).toBe(false);
  });

  it("nb_unites_max='6' (string) → vrai", () => {
    expect(nodeIsMulti4(signalWithNbUnites("6"))).toBe(true);
  });

  it("nb_unites_max='2' (string) → faux", () => {
    expect(nodeIsMulti4(signalWithNbUnites("2"))).toBe(false);
  });

  it("nb_unites_max='abc' (string non-numérique) → faux", () => {
    expect(nodeIsMulti4(signalWithNbUnites("abc"))).toBe(false);
  });

  it("intensite='haute' → vrai", () => {
    expect(nodeIsMulti4(signalWithIntensite("haute"))).toBe(true);
  });

  it("intensite='basse' → faux", () => {
    expect(nodeIsMulti4(signalWithIntensite("basse"))).toBe(false);
  });

  it("aucune prop → faux", () => {
    expect(nodeIsMulti4(makeNode({}))).toBe(false);
  });
});

// ── nodeMatchesSubset ─────────────────────────────────────────────────────────

describe("nodeMatchesSubset", () => {
  const zonageNode = signalWithCategory("rezonage");
  const multi4Node = signalWithNbUnites(6);
  const plainNode = makeNode({ props: { category: "vente" } });
  const deNode = designationEvent();

  it('key="" → tout passe', () => {
    expect(nodeMatchesSubset(plainNode, "")).toBe(true);
    expect(nodeMatchesSubset(zonageNode, "")).toBe(true);
    expect(nodeMatchesSubset(multi4Node, "")).toBe(true);
  });

  it('"z" → seulement zonage passe', () => {
    expect(nodeMatchesSubset(zonageNode, "z")).toBe(true);
    expect(nodeMatchesSubset(deNode, "z")).toBe(true);
    expect(nodeMatchesSubset(plainNode, "z")).toBe(false);
  });

  it('"m" → seulement multi4+ passe', () => {
    expect(nodeMatchesSubset(multi4Node, "m")).toBe(true);
    expect(nodeMatchesSubset(plainNode, "m")).toBe(false);
  });

  it('"p" → tout passe (heuristique non masquante)', () => {
    expect(nodeMatchesSubset(plainNode, "p")).toBe(true);
    expect(nodeMatchesSubset(zonageNode, "p")).toBe(true);
  });

  it('"z|m" → intersection : seulement zonage ET multi4+ passe', () => {
    // DesignationEvent (zonage=true) mais multi4=false → exclu
    expect(nodeMatchesSubset(deNode, "z|m")).toBe(false);
    // Signal zonage mais pas multi4 → exclu
    expect(nodeMatchesSubset(zonageNode, "z|m")).toBe(false);
    // Signal multi4 mais pas zonage → exclu
    expect(nodeMatchesSubset(multi4Node, "z|m")).toBe(false);
    // Nœud zonage ET multi4 → passe
    const bothNode = makeNode({ props: { category: "rezonage", nb_unites_max: 8 } });
    expect(nodeMatchesSubset(bothNode, "z|m")).toBe(true);
  });

  it('"z|m|p" (défaut) → zonage ET multi4 (p ne masque pas)', () => {
    // Même comportement que z|m pour les nœuds qui ne sont pas les deux
    const bothNode = makeNode({ props: { category: "rezonage", nb_unites_max: 8 } });
    expect(nodeMatchesSubset(bothNode, "z|m|p")).toBe(true);
    expect(nodeMatchesSubset(zonageNode, "z|m|p")).toBe(false);
  });
});

// ── filterNodesBySubset ───────────────────────────────────────────────────────

describe("filterNodesBySubset", () => {
  const nodes: GraphSignalNode[] = [
    signalWithCategory("rezonage"),
    makeNode({ id: "n2", props: { category: "vente" } }),
    signalWithNbUnites(6),
    makeNode({ id: "n4", props: { category: "rezonage", nb_unites_max: 8 } }),
  ];

  it('key="" → retourne le même tableau (même référence)', () => {
    expect(filterNodesBySubset(nodes, "")).toBe(nodes);
  });

  it('"z" → garde zonage uniquement (rezonage + nœud z|m)', () => {
    const result = filterNodesBySubset(nodes, "z");
    // rezonage (idx0) et nœud z|m (idx3) sont zonage
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toContain("test-node"); // idx0
    expect(result.map((n) => n.id)).toContain("n4");
  });

  it('"m" → garde multi4+ uniquement', () => {
    const result = filterNodesBySubset(nodes, "m");
    // signalWithNbUnites(6) (idx2) et nœud z|m (idx3)
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toContain("n4");
  });

  it('"z|m" → intersection : seulement le nœud qui est les deux', () => {
    const result = filterNodesBySubset(nodes, "z|m");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n4");
  });
});
