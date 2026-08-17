/**
 * Tri déterministe + raison de rang de la vue B (affichage).
 *
 * On vérifie que le client CONSOMME `compareVivier`/`rankVivier` du domaine
 * (même ordre, aucun tri maison), que la raison est en copy NEUTRE lisible, et
 * que la bulle d'étape (`signalStageLabel`) marche en TOUT mode avec un repli
 * honnête (aucune étape inventée quand l'annotation est absente).
 */
import { describe, expect, it } from "vitest";
import { rankVivier, type VivierV2 } from "@radar/domain";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  rankVivierBNodes,
  signalStageLabel,
  toVivierSortable,
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

describe("signalStageLabel — bulle « instrument, étape » en TOUT mode", () => {
  function bareNode(
    id: string,
    props: Record<string, unknown>,
  ): GraphSignalNode {
    return {
      id,
      type: "DesignationEvent",
      label: id,
      citySlug: "delson",
      sourceRef: null,
      createdAt: null,
      publishedAt: null,
      props,
    };
  }

  it("classification posée → forme validée « Instrument, étape »", () => {
    expect(
      signalStageLabel(node("s", classification({ instrument: "rezonage", etape: "avis_motion" }))),
    ).toBe("Rezonage, avis de motion");
  });

  it("étape inconnue (classification) → repli honnête : AUCUNE bulle", () => {
    expect(signalStageLabel(node("s", classification({ etape: "inconnu" })))).toBeNull();
  });

  it("hors vivier v2 → reconstruite depuis props.etape + props.instrument (même forme)", () => {
    expect(
      signalStageLabel(bareNode("s", { etape: "avis_motion", instrument: "rezonage" })),
    ).toBe("Rezonage, avis de motion");
  });

  it("hors vivier v2, vocabulaire graphify élargi (consultation → consultation publique)", () => {
    expect(
      signalStageLabel(bareNode("s", { etape: "consultation", instrument: "ppcmoi" })),
    ).toBe("PPCMOI, consultation publique");
  });

  it("instrument absent/`autre` → étape seule, capitalisée (jamais « Instrument à préciser »)", () => {
    expect(signalStageLabel(bareNode("s", { etape: "adoption" }))).toBe("Adoption");
    expect(signalStageLabel(bareNode("s", { etape: "adoption", instrument: "autre" }))).toBe(
      "Adoption",
    );
  });

  it("étape absente OU inconnue (hors vivier v2) → repli honnête : AUCUNE bulle", () => {
    expect(signalStageLabel(bareNode("s", {}))).toBeNull();
    expect(signalStageLabel(bareNode("s", { etape: "inconnu", instrument: "rezonage" }))).toBeNull();
  });
});
