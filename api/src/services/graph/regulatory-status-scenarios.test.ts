/**
 * SPOT-CHECKS serving (LOT 1 serving, A.5b / D5) — le regulatoryStatus SERVI d'un
 * règlement = l'AGRÉGAT (`aggregateRegulatoryStatus`) de ses nœuds LUS via le locus
 * unique (`readRegulatoryStatus`). Exerce des ancres réelles de la fixture avis-only
 * (`__fixtures__/avis-only-72.tsv` : sainte-martine 026-508 / 026-509, barnston…)
 * + l'invariant REVERSE (i-arch) + l'orthogonalité case-marker.
 *
 * Pur : aucun Docker/DB. (La preuve que CHAQUE consommateur passe par ce locus =
 * `regulatory-status-archi.test.ts` FACE-1 ; la face client-side = PR vues.)
 */
import { describe, it, expect } from "vitest";
import { readRegulatoryStatus, aggregateRegulatoryStatus } from "@radar/domain";

type NodeInput = Parameters<typeof readRegulatoryStatus>[0];

/** Statut SERVI d'un règlement = agrégat de ses nœuds LUS (miroir de la vue/zone). */
const servedStatusForReglement = (nodes: NodeInput[]) =>
  aggregateRegulatoryStatus(nodes.map((n) => readRegulatoryStatus(n)));

describe("A.5b spot-checks — fixture avis-only (026-508 / 026-509) → SERVI anticipation", () => {
  it("sainte-martine 026-509 (avis + projet, 0 adoption) → anticipation (jamais firm)", () => {
    // Le règlement-namesake du D5 i-arch : tous ses nœuds au stade avis/projet.
    const reg509: NodeInput[] = [{ etape: "avis_motion" }, { etape: "projet_reglement" }];
    expect(servedStatusForReglement(reg509)).toBe("anticipation");
  });

  it("sainte-martine 026-508 (avis-only) → anticipation", () => {
    expect(servedStatusForReglement([{ etape: "avis_motion" }])).toBe("anticipation");
  });

  it("2026-509 : chaque nœud LU rend anticipation quel que soit le champ de preuve (jamais firm sur aucun consommateur)", () => {
    // Chaque consommateur LIT via readRegulatoryStatus → verdict par nœud identique.
    expect(readRegulatoryStatus({ etape: "avis_motion" })).toBe("anticipation");
    expect(readRegulatoryStatus({ statut: "avis-motion" })).toBe("anticipation");
    expect(readRegulatoryStatus({ regulatoryStatus: "anticipation", etape: "adoption" })).toBe("anticipation");
  });
});

describe("A.5b spot-checks — invariant REVERSE (adopté → firm via AGRÉGAT, pas nœud isolé)", () => {
  it("règlement adopté : Bylaw sans stade (anticipation ISOLÉ) + nœud-adoption firm → SERVI firm", () => {
    const bylawNode: NodeInput = { regulatoryStatus: null, etape: null }; // legacy sans stade
    const adoptionNode: NodeInput = { etape: "adoption" };
    // Le nœud-Bylaw isolé, lu seul, serait anticipation (fail-safe)…
    expect(readRegulatoryStatus(bylawNode)).toBe("anticipation");
    // …mais l'AGRÉGAT du règlement est firm (hérite de l'adoption frère) = pas de reverse-bug.
    expect(servedStatusForReglement([bylawNode, adoptionNode])).toBe("firm");
  });

  it("entrée en vigueur : agrégat firm (statut entree-vigueur autoritatif)", () => {
    expect(servedStatusForReglement([{ statut: "entree-vigueur" }, { etape: "avis_motion" }])).toBe("firm");
  });

  it("le champ PERSISTÉ firm prime au niveau nœud (agrégat firm même si etape brut contredit)", () => {
    expect(servedStatusForReglement([{ regulatoryStatus: "firm", etape: "avis_motion" }])).toBe("firm");
  });
});

describe("A.5b spot-checks — case-marker (piia/derogation) safe-not-firm (instrument ⊥ regulatoryStatus)", () => {
  it("l'instrument N'EST PAS un input du classifieur → un case-marker au stade avis reste anticipation", () => {
    // deriveRegulatoryStatus ne lit que statut/etape : aucun instrument ne peut forcer firm.
    expect(readRegulatoryStatus({ etape: "avis_motion" })).toBe("anticipation");
    expect(readRegulatoryStatus({ statut: "2e-projet" })).toBe("anticipation");
  });

  it("un règlement HABILITANT (derogation) réellement adopté suit la MÊME règle (firm par ADOPTION, pas par instrument)", () => {
    // L'axe orthogonal : type_instrument=derogation + adoption → firm par l'adoption, cohérent.
    expect(readRegulatoryStatus({ statut: "adopte" })).toBe("firm");
  });
});
