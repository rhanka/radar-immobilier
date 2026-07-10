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
  displaySubsetKey,
  subsetDisplayCount,
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

// ── displaySubsetKey / subsetDisplayCount ─────────────────────────────────────
//
// Régression : COHÉRENCE du COMPTEUR rail (subsetCounts, calcul serveur) ↔
// panneau (filterNodesBySubset, affichage réel). Le rail SOUS-COMPTAIT parce
// qu'il lisait `subsetCounts["z|m|p"]` (cohorte RESTRICTIVE z∩m∩p) alors que le
// panneau affiche z∩m (« p » ne masque jamais). La clé d'affichage retire « p ».

describe("displaySubsetKey", () => {
  it("retire l'axe « p » (neutre à l'affichage)", () => {
    expect(displaySubsetKey("z|m|p")).toBe("z|m");
    expect(displaySubsetKey("z|p")).toBe("z");
    expect(displaySubsetKey("m|p")).toBe("m");
    expect(displaySubsetKey("p")).toBe("");
  });

  it("laisse z / m / z|m inchangés", () => {
    expect(displaySubsetKey("z")).toBe("z");
    expect(displaySubsetKey("m")).toBe("m");
    expect(displaySubsetKey("z|m")).toBe("z|m");
    expect(displaySubsetKey("")).toBe("");
  });
});

describe("subsetDisplayCount — cohérence rail ↔ panneau", () => {
  // Ville « rosemère »-like : 2 nœuds z∩m dont UN SEUL précoce.
  //   → panneau (filterNodesBySubset, clé défaut "z|m|p") = 2
  //   → subsetCounts serveur : z|m = 2, mais z|m|p = 1 (précoce restrictif)
  const rosemereLikeNodes: GraphSignalNode[] = [
    // z∩m ET précoce (avis_motion) → compte partout
    makeNode({ id: "sig-precoce", props: { category: "rezonage", nb_unites_max: 8, etape: "avis_motion" } }),
    // z∩m mais NON précoce (adoption) → affiché au panneau, exclu de z∩m∩p
    makeNode({ id: "sig-tardif", props: { category: "rezonage", nb_unites_max: 6, etape: "adoption" } }),
  ];
  // subsetCounts tel que produit par listCitiesWithSignalNodes (serveur) pour
  // cette ville : « p » restrictif → z|m|p sous-compte z|m.
  const rosemereSubsetCounts: Record<string, number> = {
    "": 2, z: 2, m: 2, p: 1, "z|m": 2, "z|p": 1, "m|p": 1, "z|m|p": 1,
  };

  it("panneau (filterNodesBySubset) montre les 2 signaux z∩m sous « z|m|p »", () => {
    // « p » ne masque pas → le panneau affiche z∩m = 2
    expect(filterNodesBySubset(rosemereLikeNodes, "z|m|p")).toHaveLength(2);
  });

  it("BUG reproduit : lire subsetCounts[\"z|m|p\"] brut donne 1 (sous-compte)", () => {
    // C'est ce que faisait le rail avant le fix → rail=1 vs panneau=2.
    expect(rosemereSubsetCounts["z|m|p"]).toBe(1);
    expect(rosemereSubsetCounts["z|m|p"]).not.toBe(
      filterNodesBySubset(rosemereLikeNodes, "z|m|p").length,
    );
  });

  it("FIX : subsetDisplayCount égale le panneau (2) sous « z|m|p »", () => {
    const railCount = subsetDisplayCount(rosemereSubsetCounts, "z|m|p");
    const panelCount = filterNodesBySubset(rosemereLikeNodes, "z|m|p").length;
    expect(railCount).toBe(2);
    expect(railCount).toBe(panelCount);
  });

  it("ville saine (z∩m tous précoces) reste correcte : rail == panneau", () => {
    // 1 seul nœud z∩m, précoce → z|m = z|m|p = 1. Aucun écart avant/après.
    const healthyNodes: GraphSignalNode[] = [
      makeNode({ id: "ok", props: { category: "rezonage", nb_unites_max: 8, etape: "projet_reglement" } }),
    ];
    const healthySubsetCounts: Record<string, number> = {
      "": 1, z: 1, m: 1, p: 1, "z|m": 1, "z|p": 1, "m|p": 1, "z|m|p": 1,
    };
    expect(subsetDisplayCount(healthySubsetCounts, "z|m|p")).toBe(1);
    expect(subsetDisplayCount(healthySubsetCounts, "z|m|p")).toBe(
      filterNodesBySubset(healthyNodes, "z|m|p").length,
    );
    // Et le compte reste juste pour les clés sans « p ».
    expect(subsetDisplayCount(healthySubsetCounts, "z")).toBe(1);
  });
});
