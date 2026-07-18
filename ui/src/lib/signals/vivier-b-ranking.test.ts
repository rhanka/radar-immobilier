/**
 * Tri déterministe + raison de rang de la vue B (affichage).
 *
 * On vérifie que le client CONSOMME `compareVivier`/`rankVivier` du domaine
 * (même ordre, aucun tri maison), que la raison est en copy NEUTRE lisible, et
 * que l'abstention D10 tient : `effet_densifiant === "inconnu"` → « à qualifier ».
 */
import { describe, expect, it } from "vitest";
import { rankVivier, type VivierV2 } from "@radar/domain";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  isEffetDensifiantUnknown,
  rankVivierBNodes,
  toVivierSortable,
  vivierEffetDensifiantLabel,
  vivierRankReasonLabel,
} from "./vivier-b-ranking.js";

function classification(
  overrides: Partial<VivierV2> = {},
): VivierV2 {
  return {
    zonage: { valeur: "oui", source: "test", confiance: 0.95 },
    residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
    effet_densifiant: "inconnu",
    instrument: "rezonage",
    etape: "avis_motion",
    etapes_historique: ["avis_motion"],
    exclusion_reason: null,
    provenance: { extrait: "" },
    confiance: 0.9,
    ...overrides,
  } as VivierV2;
}

function node(
  id: string,
  cls: VivierV2,
  extra: Partial<GraphSignalNode> = {},
): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "delson",
    sourceRef: null,
    createdAt: null,
    publishedAt: null,
    props: {},
    classification: cls,
    ...extra,
  };
}

describe("rankVivierBNodes — ordre déterministe du domaine", () => {
  it("ordonne les signaux comme rankVivier (le comparateur mergé), pas un tri maison", () => {
    // Trois signaux qualifiés qui ne se départagent que par l'ÉTAPE (précocité) :
    // avis de motion < projet de règlement < adoption. Volontairement fournis en
    // désordre pour prouver que le tri les remet dans l'ordre du domaine.
    const tardif = node("c-adoption", classification({ etape: "adoption" }));
    const precoce = node("a-avis", classification({ etape: "avis_motion" }));
    const median = node("b-projet", classification({ etape: "projet_reglement" }));

    const sorted = rankVivierBNodes([tardif, precoce, median]);
    expect(sorted.map((n) => n.id)).toEqual(["a-avis", "b-projet", "c-adoption"]);

    // Parité exacte avec le domaine : même ordre que rankVivier sur les sortables.
    const domainOrder = rankVivier(
      [tardif, precoce, median].map((n) => toVivierSortable(n)!),
    ).map((s) => s.id);
    expect(sorted.map((n) => n.id)).toEqual(domainOrder);
  });

  it("classe un effet densifiant CONNU au-dessus d'un « inconnu » (abstention non favorable)", () => {
    // Deux signaux par ailleurs identiques : celui dont l'effet est mesuré
    // « densifie » passe devant celui dont l'effet reste « inconnu ».
    const inconnu = node("z-inconnu", classification({ effet_densifiant: "inconnu" }));
    const densifie = node("a-densifie", classification({ effet_densifiant: "densifie" }));
    const sorted = rankVivierBNodes([inconnu, densifie]);
    expect(sorted.map((n) => n.id)).toEqual(["a-densifie", "z-inconnu"]);
  });

  it("ne mute pas le tableau d'entrée (copie triée)", () => {
    const input = [
      node("c-adoption", classification({ etape: "adoption" })),
      node("a-avis", classification({ etape: "avis_motion" })),
    ];
    const before = input.map((n) => n.id);
    rankVivierBNodes(input);
    expect(input.map((n) => n.id)).toEqual(before);
  });
});

describe("vivierRankReasonLabel — raison NEUTRE lisible", () => {
  it("traduit instrument + étape en copy métier (aucun jeton interne)", () => {
    expect(vivierRankReasonLabel(classification({ instrument: "refonte", etape: "projet_reglement" }))).toBe(
      "Refonte, projet de règlement",
    );
    expect(vivierRankReasonLabel(classification({ instrument: "ppcmoi", etape: "avis_motion" }))).toBe(
      "PPCMOI, avis de motion",
    );
    expect(vivierRankReasonLabel(classification({ instrument: "derogation", etape: "entree_vigueur" }))).toBe(
      "Dérogation, entrée en vigueur",
    );
  });

  it("n'expose aucun jeton technique de rankReason (bucket / stableKey / enum souligné)", () => {
    const reason = vivierRankReasonLabel(
      classification({ instrument: "rezonage", etape: "avis_motion" }),
    );
    // Les jetons bruts de `rankReason` (technique) ne doivent JAMAIS fuiter.
    for (const jargon of ["bucket", "stablekey", "effectconfidence", "avis_motion", ";", "="]) {
      expect(reason.toLowerCase()).not.toContain(jargon);
    }
  });
});

describe("vivierEffetDensifiantLabel — abstention honnête D10", () => {
  it("« inconnu » → « à qualifier », jamais une valeur inventée ni favorable", () => {
    const cls = classification({ effet_densifiant: "inconnu" });
    expect(isEffetDensifiantUnknown(cls)).toBe(true);
    expect(vivierEffetDensifiantLabel(cls)).toBe("à qualifier");
  });

  it("rend les effets MESURÉS en copy neutre (densifiant / réduction / sans effet)", () => {
    expect(vivierEffetDensifiantLabel(classification({ effet_densifiant: "densifie" }))).toBe("densifiant");
    expect(vivierEffetDensifiantLabel(classification({ effet_densifiant: "reduit" }))).toBe("réduction de densité");
    expect(vivierEffetDensifiantLabel(classification({ effet_densifiant: "stable" }))).toBe("sans effet sur la densité");
  });
});
