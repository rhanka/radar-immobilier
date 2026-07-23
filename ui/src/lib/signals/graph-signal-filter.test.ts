/**
 * QA léger — graph-signal-filter : logique de filtrage zonage/précoce.
 *
 * Vérifie :
 *   1. nodeIsZonage : DesignationEvent → toujours zonage ; Signal avec
 *      catégorie dans ZONAGE_CATEGORIES → zonage ; Signal sans catégorie → non.
 *   2. nodeMatchesSubset : key="" → no B-prime exclusion ; "z" → zonage ;
 *      "z|p" → intersection ; "p" → étape précoce.
 *   3. filterNodesBySubset : même référence si key="" ; filtre correct sinon.
 *
 * Aucun docker, aucune API, aucun composant Svelte.
 */
import { describe, it, expect } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  nodeIsZonage,
  nodeIsResidentielPertinent,
  nodeBPrimeClassification,
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

// ── nodeIsResidentielPertinent ───────────────────────────────────────────────

describe("nodeIsResidentielPertinent", () => {
  it("catégorie résidentielle → true", () => {
    expect(nodeIsResidentielPertinent(signalWithCategory("densification"))).toBe(true);
    expect(nodeIsResidentielPertinent(signalWithCategory("logement_abordable"))).toBe(true);
  });

  it("marqueur texte résidentiel (label) → true", () => {
    expect(
      nodeIsResidentielPertinent(makeNode({ label: "Rezonage résidentiel multifamilial" })),
    ).toBe(true);
  });

  it("marqueur texte résidentiel (description) → true", () => {
    expect(
      nodeIsResidentielPertinent(
        makeNode({ props: { description: "Immeuble à logements de 8 unités" } }),
      ),
    ).toBe(true);
  });

  it("non résidentiel explicite → false (industriel/commercial/camping/enviro)", () => {
    expect(nodeIsResidentielPertinent(makeNode({ label: "Agrandissement du parc industriel" }))).toBe(false);
    expect(nodeIsResidentielPertinent(makeNode({ label: "Nouvelle zone commerciale" }))).toBe(false);
    expect(nodeIsResidentielPertinent(makeNode({ label: "Projet de camping" }))).toBe(false);
    expect(
      nodeIsResidentielPertinent(makeNode({ props: { description: "Protection des milieux humides" } })),
    ).toBe(false);
  });

  it("mixte (résidentiel + commercial) → true (opportunité)", () => {
    expect(
      nodeIsResidentielPertinent(makeNode({ label: "Rezonage de commercial à résidentiel" })),
    ).toBe(true);
  });

  it("indéterminé (aucun marqueur) → true (conservé, anti-faux-négatif)", () => {
    expect(nodeIsResidentielPertinent(makeNode({ label: "Avis de motion 2025-11" }))).toBe(true);
    expect(nodeIsResidentielPertinent(makeNode({}))).toBe(true);
  });

  it("« complexe » ne matche PAS « plex » (borne \\b)", () => {
    expect(nodeIsResidentielPertinent(makeNode({ label: "Complexe sportif municipal" }))).toBe(true);
    // « triplex » matche bien résidentiel (contrôle positif).
    expect(nodeIsResidentielPertinent(makeNode({ label: "Construction d'un triplex" }))).toBe(true);
  });
});

// ── nodeMatchesSubset ─────────────────────────────────────────────────────────

describe("nodeMatchesSubset", () => {
  const zonageNode = signalWithCategory("rezonage");
  const plainNode = makeNode({ props: { category: "vente" } });
  const deNode = designationEvent();

  it('key="" → tout passe', () => {
    expect(nodeMatchesSubset(plainNode, "")).toBe(true);
    expect(nodeMatchesSubset(zonageNode, "")).toBe(true);
  });

  it('"z" → seulement zonage passe', () => {
    expect(nodeMatchesSubset(zonageNode, "z")).toBe(true);
    expect(nodeMatchesSubset(deNode, "z")).toBe(true);
    expect(nodeMatchesSubset(plainNode, "z")).toBe(false);
  });

  it("l’ancien flag dimension est ignoré et ne filtre plus les nœuds", () => {
    expect(nodeMatchesSubset(plainNode, "m")).toBe(true);
    expect(nodeMatchesSubset(zonageNode, "z|m")).toBe(true);
  });

  it('"p" → garde seulement les étapes précoces, avec annotation prioritaire', () => {
    const annotated = makeNode({
      label: "Adoption du règlement",
      props: { etape: "avis_motion" },
    });
    const invalid = makeNode({
      label: "Avis de motion",
      props: { etape: "instrument: refonte" },
    });
    expect(nodeMatchesSubset(annotated, "p")).toBe(true);
    expect(nodeMatchesSubset(invalid, "p")).toBe(false);
    expect(nodeMatchesSubset(plainNode, "p")).toBe(false);
  });

  it('"r" → masque le bruit non résidentiel, garde résidentiel + indéterminé', () => {
    const residentiel = makeNode({ label: "Rezonage résidentiel" });
    const industriel = makeNode({ label: "Parc industriel" });
    const indetermine = makeNode({ label: "Avis de motion 2025-11" });
    expect(nodeMatchesSubset(residentiel, "r")).toBe(true);
    expect(nodeMatchesSubset(indetermine, "r")).toBe(true); // anti-faux-négatif
    expect(nodeMatchesSubset(industriel, "r")).toBe(false);
  });

  it('"z|r" → intersection zonage ET (non explicitement non résidentiel)', () => {
    // DesignationEvent zonage mais texte industriel → exclu par r.
    const deIndustriel = makeNode({ id: "de-ind", type: "DesignationEvent", label: "Zone industrielle" });
    expect(nodeMatchesSubset(deIndustriel, "z")).toBe(true);
    expect(nodeMatchesSubset(deIndustriel, "z|r")).toBe(false);
    // Signal zonage + résidentiel → passe.
    const zonageResidentiel = makeNode({ props: { category: "rezonage" }, label: "Habitation multifamiliale" });
    expect(nodeMatchesSubset(zonageResidentiel, "z|r")).toBe(true);
  });

  it('"z|p" → intersection zonage et étape précoce', () => {
    const earlyDesignation = makeNode({ type: "DesignationEvent", props: { etape: "avis_motion" } });
    const earlyZonage = makeNode({ props: { category: "rezonage", etape: "projet_reglement" } });
    expect(nodeMatchesSubset(earlyDesignation, "z|p")).toBe(true);
    expect(nodeMatchesSubset(earlyZonage, "z|p")).toBe(true);
    expect(nodeMatchesSubset(plainNode, "z|p")).toBe(false);
  });

  it("excludes commercial/industrial signals and regional commercial poles from B while retaining their classification", () => {
    const industrial = makeNode({
      label: "Densification du parc industriel",
      props: { category: "rezonage", etape: "avis_motion" },
    });
    const regionalPole = makeNode({
      label: "Pôle commercial régional — projet résidentiel",
      props: { category: "rezonage", etape: "avis_motion", extrait: "Pôle commercial régional" },
      sourceRef: "pv-42",
    });
    // A legacy z|m|p stays unchanged; B′ exclusions apply only to axis r.
    expect(nodeMatchesSubset(regionalPole, "")).toBe(true);
    expect(nodeMatchesSubset(industrial, "z|p")).toBe(true);
    expect(nodeMatchesSubset(regionalPole, "z|p")).toBe(true);
    expect(nodeMatchesSubset(industrial, "z|p|r")).toBe(false);
    expect(nodeMatchesSubset(regionalPole, "z|p|r")).toBe(false);
    expect(nodeBPrimeClassification(regionalPole)).toMatchObject({
      residentiel: "non",
      exclusionReason: "pole_commercial_regional",
      provenance: { extrait: "Pôle commercial régional", source: "pv-42" },
    });
  });
});

// ── filterNodesBySubset ───────────────────────────────────────────────────────

describe("filterNodesBySubset", () => {
  const nodes: GraphSignalNode[] = [
    makeNode({ props: { category: "rezonage", etape: "avis_motion" } }),
    makeNode({ id: "n2", props: { category: "vente" } }),
    makeNode({ id: "n4", props: { category: "rezonage", nb_unites_max: 8, etape: "avis_motion" } }),
  ];

  it('key="" → retourne le même tableau (même référence)', () => {
    expect(filterNodesBySubset(nodes, "")).toBe(nodes);
  });

  it('"z" → garde zonage uniquement (rezonage + nœud zonage)', () => {
    const result = filterNodesBySubset(nodes, "z");
    // rezonage (idx0) et nœud zonage (idx2)
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toContain("test-node"); // idx0
    expect(result.map((n) => n.id)).toContain("n4");
  });

  it('"m" ancien → conserve tous les nœuds', () => {
    const result = filterNodesBySubset(nodes, "m");
    expect(result).toHaveLength(nodes.length);
  });

  it('"z|p" → garde les nœuds zonage aux étapes précoces', () => {
    const result = filterNodesBySubset(nodes, "z|p");
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toContain("test-node");
    expect(result.map((n) => n.id)).toContain("n4");
  });
});
