import { describe, expect, it } from "vitest";
import {
  aggregateGraphSignalProjectionRows,
  buildLegacyZmpProjection,
  buildNodeRow,
  classifyGraphNodeLegacyZmp,
} from "./graph-store.js";
import { classifyVivierSignal } from "./vivier-v2.js";
import {
  BPRIME_RECETTE_EXPECTATIONS,
  BPRIME_RECETTE_OFFLINE_GAPS,
  BPRIME_RECETTE_ROWS,
} from "./bprime-recette.fixture.js";
import { SUTTON_LEGACY_GRAPH_NODES, SUTTON_A_IDS } from "./sutton-legacy.fixture.js";
import type { VivierV2Counts } from "@radar/domain";

/**
 * Recette de réception B′ × Steve-30 — HONNÊTE et PROUVABLE hors-ligne.
 * Contrat : docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md.
 *
 * Chemin testé = le VRAI chemin serveur `aggregateGraphSignalProjectionRows`
 * (identique à `listCitiesWithSignalNodes` en prod, au `WHERE` près) sur des
 * NŒUDS DE GRAPHE RÉELS committés (Sutton, Coaticook). Le badge rail de la vue B
 * (précoce) = `stageCounts.avis_motion + stageCounts.projet_reglement` — la
 * formule EXACTE de `countForVivierCity` (parité prouvée dans
 * ui/.../vivier-view-mode.test.ts). On lit la sortie serveur, on ne la miroite
 * pas.
 */
function bBadgePrecoce(counts: VivierV2Counts): number {
  return counts.stageCounts.avis_motion + counts.stageCounts.projet_reglement;
}

const byCity = new Map(
  aggregateGraphSignalProjectionRows(BPRIME_RECETTE_ROWS).map((c) => [
    c.citySlug,
    c.vivierV2Counts,
  ]),
);

describe("Recette B′ × Steve-30 — villes PROUVABLES hors-ligne (nœuds réels)", () => {
  it("le calcul serveur ne porte QUE des villes réelles (zéro ville fabriquée)", () => {
    expect([...byCity.keys()].sort()).toEqual(["coaticook", "sutton"]);
  });

  it("Sutton ✓2 — la PAIRE refonte remonte via le périmètre permissif, SANS gate refonte→oui", () => {
    const counts = byCity.get("sutton")!;
    // Sortie SERVEUR brute sur les 5 nœuds réels de graph/sutton/latest.json.
    expect(counts).toMatchObject({
      qualified: 0, // les refontes sont résidentiel=INDÉTERMINÉ, pas « oui » forcé
      residentialUnknown: 4,
      excludedByReason: { non_residentiel_franc: 1 }, // CPTAQ agricole exclu
      total: 5,
    });
    expect(counts.stageCounts.projet_reglement).toBe(2); // la paire refonte
    expect(counts.stageCounts.avis_motion).toBe(0);
    // Badge rail précoce (= countForVivierCity) : ✓2, l'attendu du contrat.
    expect(bBadgePrecoce(counts)).toBe(2);
  });

  it("Coaticook — 1 nœud réel qualifié (✓1) ; le ✓2 du contrat n'est PAS prouvable hors-ligne", () => {
    const counts = byCity.get("coaticook")!;
    expect(counts).toMatchObject({ qualified: 1, total: 1 });
    expect(counts.stageCounts.projet_reglement).toBe(1);
    expect(bBadgePrecoce(counts)).toBe(1);
    // Le contrat vise ✓2 (2 nœuds en prod) ; un seul est committé → gap assumé.
    const coaticook = BPRIME_RECETTE_EXPECTATIONS.find((e) => e.citySlug === "coaticook")!;
    expect(coaticook.provable).toBe(false);
    expect(coaticook.provableBPrime).toBeLessThan(coaticook.contractBPrime);
  });

  it("chaque attendu prouvable-hors-ligne = la sortie serveur réelle, ville par ville", () => {
    for (const exp of BPRIME_RECETTE_EXPECTATIONS) {
      const counts = byCity.get(exp.citySlug);
      expect(counts, `ville absente du calcul serveur: ${exp.citySlug}`).toBeDefined();
      expect(bBadgePrecoce(counts!), `${exp.label} badge précoce`).toBe(exp.provableBPrime);
      if (exp.provable) {
        // Vert STRICT : seules les villes prouvables engagent le compte du contrat.
        expect(exp.provableBPrime, `${exp.label} doit atteindre le contrat`).toBe(
          exp.contractBPrime,
        );
      }
    }
  });

  it("R3 serveur — Lavaltrie zone C-8 « usages commerciaux » (TEXTE RÉEL) est exclu du périmètre", () => {
    // proces-verbaux-lavaltrie.fixture.ts : « Règlement modifiant le Règlement de
    // zonage … aux fins d'autoriser certains usages commerciaux … dans les zones
    // C 8 et C 168 ». Le pluriel -aux échappait au regex → il entrait à tort.
    const classification = classifyVivierSignal({
      id: "lavaltrie-c8-usages-commerciaux",
      type: "Signal",
      category: "rezonage",
      label: "Règlement de zonage RRU2 — zones C-8 et C-168",
      description:
        "Règlement modifiant le Règlement de zonage numéro RRU2 aux fins d'autoriser certains usages commerciaux et d'ajouter des exigences d'implantation dans les zones C 8 et C 168.",
      etape: "second_projet",
    });
    expect(classification.residentiel.valeur).toBe("non");
    expect(classification.exclusion_reason).toBe("non_residentiel_franc");
  });
});

describe("Recette B′ × Steve-30 — HONNÊTETÉ : villes NON prouvables hors-ligne", () => {
  it("Rosemère RÉEL — la fabrication est retirée ; le concordance/pôle régional reste INDÉTERMINÉ (gap assumé)", () => {
    // Texte RÉEL du PV 801-71 (proces-verbaux-rosemere.fixture.ts) : un règlement
    // de CONCORDANCE relatif au « pôle régional » — PAS de « densification
    // commerciale » (qui était fabriquée). Le filtre déterministe le classe
    // `indéterminé` : il n'est donc PAS lexicalement ✗0. Le ✗0 attendu relève
    // d'un jugement sémantique (geo) → QA prod, jamais d'un marqueur inventé.
    const classification = classifyVivierSignal({
      id: "rosemere-801-71-concordance",
      type: "DesignationEvent",
      category: null,
      label:
        "801-71 - Règlement modifiant le Règlement de zonage 801 afin d'assurer la conformité au Règlement 24-02 de la MRC de Thérèse-De Blainville et aux Règlements 800-06 et 800-08 de la Ville de Rosemère relatifs au pôle régional - Règlement de concordance - Avis de motion",
      description:
        "Avis de motion : règlement de concordance assurant la conformité au règlement 24-02 de la MRC relatif au pôle régional.",
      etape: "avis_motion",
    });
    // Honnête : indéterminé (à confirmer), NI « oui » NI « non ». Aucune invention.
    expect(classification.residentiel.valeur).toBe("indetermine");
    expect(classification.exclusion_reason).toBeNull();
    // Donc Rosemère est déclarée non-prouvable hors-ligne (voir OFFLINE_GAPS).
    expect(BPRIME_RECETTE_OFFLINE_GAPS.some((g) => g.label === "Rosemère")).toBe(true);
  });

  it("les villes non prouvables sont DÉCLARÉES et jamais fabriquées dans le calcul", () => {
    expect(BPRIME_RECETTE_OFFLINE_GAPS.length).toBeGreaterThan(0);
    // Aucune ville « gap » n'est présente dans le calcul serveur (pas de fixture
    // fabriquée pour la faire passer verte).
    for (const gap of BPRIME_RECETTE_OFFLINE_GAPS) {
      // (comparaison souple : les labels composites listent plusieurs villes)
      const slugs = gap.label
        .toLowerCase()
        .split("/")
        .map((s) => s.trim().replace(/[’']/g, "").replace(/\s+/g, "-"));
      for (const slug of slugs) {
        expect(byCity.has(slug), `ne doit PAS être dans le calcul: ${slug}`).toBe(false);
      }
    }
  });

  it("synthèse honnête ≥6/10 : seule Sutton (10/10) est prouvable hors-ligne ; le reste = QA prod", () => {
    // Le contrat veut TOUTES les ≥6/10 présentes dans B′. Hors-ligne, une seule
    // ville notée 10/10 a des nœuds committés (Sutton) → on prouve celle-là ; les
    // autres sont explicitement listées comme non prouvables hors-ligne.
    expect(bBadgePrecoce(byCity.get("sutton")!)).toBeGreaterThanOrEqual(1);
    const declaredHighNotes = [
      "Saint-Stanislas-de-Kostka",
      "Saint-Raphaël",
      "Saint-Gilbert",
    ];
    for (const label of declaredHighNotes) {
      expect(
        BPRIME_RECETTE_OFFLINE_GAPS.some((g) => g.label === label),
        `≥6/10 non prouvable doit être déclarée: ${label}`,
      ).toBe(true);
    }
  });
});

describe("Non-régression A (legacy z|m|p) — inchangé par B′", () => {
  it("Sutton : la projection A z|m|p reste exactement SUTTON_A_IDS", () => {
    const memberships = SUTTON_LEGACY_GRAPH_NODES.map((node) => {
      const nodeRow = buildNodeRow(node, "sutton");
      return classifyGraphNodeLegacyZmp({
        id: nodeRow.id,
        type: nodeRow.type,
        label: nodeRow.label,
        props: nodeRow.props,
        sourceRef: nodeRow.sourceRef,
      });
    });
    const projection = buildLegacyZmpProjection(memberships);
    expect(projection.a.signalIds).toEqual([...SUTTON_A_IDS]);
  });
});
