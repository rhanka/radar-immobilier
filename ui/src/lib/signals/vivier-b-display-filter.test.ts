/**
 * Exclusions d'affichage de la vue B.
 *
 * Le cas de référence est réel : `signal-austin-piia-densification-impasse-renard`
 * est un PIIA (donc visé par l'exclusion) qui porte un VRAI projet résidentiel
 * (`nb_unites_max=4`, « quatre logements » cités). Exclure tout PIIA
 * l'écarterait, ainsi que Bedford — ce serait un bug produit, pas un filtre.
 */
import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  applyVivierBExclusions,
  DEFAULT_VIVIER_B_EXCLUSIONS,
  hasResidentialProjectProof,
  isHiddenByVivierBExclusions,
  isPiiaLie,
  type VivierBExclusions,
} from "./vivier-b-display-filter.js";

function node(
  id: string,
  instrument: string,
  properties: Record<string, unknown> = {},
  extra: Partial<GraphSignalNode> = {},
): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "austin",
    sourceRef: null,
    createdAt: null,
    props: { properties },
    classification: {
      zonage: { valeur: "oui", source: "test", confiance: 0.95 },
      residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
      effet_densifiant: "inconnu",
      instrument,
      etape: "avis_motion",
      etapes_historique: ["avis_motion"],
      exclusion_reason: null,
      provenance: { extrait: "" },
      confiance: 0.9,
    } as unknown as GraphSignalNode["classification"],
    ...extra,
  };
}

/** Le cas Austin, vérifié en prod. */
const AUSTIN_PIIA = node(
  "signal-austin-piia-densification-impasse-renard",
  "piia",
  { category: "piia", nb_unites_max: 4 },
  {
    docRefs: [
      {
        docSha: "sha-austin",
        excerpt:
          "ATTENDU la demande de permis de construction no 2025-10-0017 pour la " +
          "construction d'un bâtiment résidentiel comportant quatre logements",
      },
    ],
  },
);

/** Bedford : le projet est cité dans le libellé (« 4 plex »), sans nb_unites_max. */
const BEDFORD_PIIA = node("signal-bedford-piia-4plex-leclair", "piia", {
  category: "piia",
});
BEDFORD_PIIA.label = "PIIA 4 plex accordé rue Leclair";

/** Un PIIA qui ne touche au résidentiel que par le zonage : aucun projet. */
const PIIA_SANS_PROJET = node("signal-x-piia-facade", "piia", { category: "piia" });
PIIA_SANS_PROJET.label = "PIIA — rénovation de façade en zone résidentielle";

const DEROGATION = node("signal-x-derogation-marge", "derogation", {
  category: "derogation_mineure",
});
DEROGATION.label = "Dérogation mineure — marge latérale 1,5 m";

const REZONAGE = node("signal-x-rezonage", "rezonage", { category: "rezonage" });

describe("vivier B — exclusions d'affichage", () => {
  it("coche les deux exclusions par défaut", () => {
    expect(DEFAULT_VIVIER_B_EXCLUSIONS).toEqual({
      piiaSansProjetResidentiel: true,
      derogationsMineures: true,
    });
  });

  it("garde un PIIA porteur d'un projet résidentiel prouvé (Austin, Bedford)", () => {
    // Austin : preuve par nb_unites_max ET par la citation.
    expect(hasResidentialProjectProof(AUSTIN_PIIA)).toBe(true);
    expect(isHiddenByVivierBExclusions(AUSTIN_PIIA, DEFAULT_VIVIER_B_EXCLUSIONS)).toBe(false);

    // Bedford : preuve par « 4 plex » cité dans le libellé.
    expect(hasResidentialProjectProof(BEDFORD_PIIA)).toBe(true);
    expect(isHiddenByVivierBExclusions(BEDFORD_PIIA, DEFAULT_VIVIER_B_EXCLUSIONS)).toBe(false);
  });

  it("recognizes cited housing units with ASCII and typographic apostrophes", () => {
    for (const apostrophe of ["'", "’"]) {
      const piia = node(`piia-unites-${apostrophe.codePointAt(0)}`, "piia", { category: "piia" });
      piia.label = `PIIA — projet de 12 unités d${apostrophe}habitation`;
      expect(hasResidentialProjectProof(piia)).toBe(true);
      expect(isHiddenByVivierBExclusions(piia, DEFAULT_VIVIER_B_EXCLUSIONS)).toBe(false);
    }
  });

  it("badge « PIIA lié » uniquement sur un PIIA à preuve, jamais sur un rezonage", () => {
    expect(isPiiaLie(AUSTIN_PIIA)).toBe(true);
    expect(isPiiaLie(BEDFORD_PIIA)).toBe(true);
    expect(isPiiaLie(PIIA_SANS_PROJET)).toBe(false);
    expect(isPiiaLie(REZONAGE)).toBe(false);
  });

  it("masque un PIIA sans preuve de projet, même en zone résidentielle", () => {
    expect(hasResidentialProjectProof(PIIA_SANS_PROJET)).toBe(false);
    expect(isHiddenByVivierBExclusions(PIIA_SANS_PROJET, DEFAULT_VIVIER_B_EXCLUSIONS)).toBe(true);
  });

  it("masque les dérogations mineures quand l'exclusion est cochée", () => {
    expect(isHiddenByVivierBExclusions(DEROGATION, DEFAULT_VIVIER_B_EXCLUSIONS)).toBe(true);
  });

  it("ne touche jamais aux instruments hors PIIA/dérogation", () => {
    expect(isHiddenByVivierBExclusions(REZONAGE, DEFAULT_VIVIER_B_EXCLUSIONS)).toBe(false);
  });

  it("décocher une exclusion réaffiche exactement sa cohorte", () => {
    const nodes = [AUSTIN_PIIA, BEDFORD_PIIA, PIIA_SANS_PROJET, DEROGATION, REZONAGE];

    expect(applyVivierBExclusions(nodes, DEFAULT_VIVIER_B_EXCLUSIONS).map((n) => n.id)).toEqual([
      AUSTIN_PIIA.id,
      BEDFORD_PIIA.id,
      REZONAGE.id,
    ]);

    const piiaOff: VivierBExclusions = {
      piiaSansProjetResidentiel: false,
      derogationsMineures: true,
    };
    expect(applyVivierBExclusions(nodes, piiaOff).map((n) => n.id)).toContain(PIIA_SANS_PROJET.id);
    expect(applyVivierBExclusions(nodes, piiaOff).map((n) => n.id)).not.toContain(DEROGATION.id);

    const derogationOff: VivierBExclusions = {
      piiaSansProjetResidentiel: true,
      derogationsMineures: false,
    };
    expect(applyVivierBExclusions(nodes, derogationOff).map((n) => n.id)).toContain(DEROGATION.id);

    // Tout décocher = B brut, aucun signal masqué.
    expect(
      applyVivierBExclusions(nodes, {
        piiaSansProjetResidentiel: false,
        derogationsMineures: false,
      }),
    ).toHaveLength(nodes.length);
  });

  it("accepte la preuve annotée residentiel=oui et nb_unites_max en chaîne", () => {
    expect(
      hasResidentialProjectProof(node("s-annote", "piia", { residentiel: "oui" })),
    ).toBe(true);
    expect(
      hasResidentialProjectProof(node("s-string", "piia", { nb_unites_max: "6" })),
    ).toBe(true);
    // Une valeur non numérique n'est pas une preuve.
    expect(
      hasResidentialProjectProof(node("s-junk", "piia", { nb_unites_max: "n/d" })),
    ).toBe(false);
  });
});
