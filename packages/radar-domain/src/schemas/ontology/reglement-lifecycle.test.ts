import { describe, expect, it } from "vitest";
import {
  RegulatoryStageKind,
  EnVigueurProvenance,
  OntoRelation,
  KNOWN_RELATION_TYPES,
  KNOWN_TYPE_INSTRUMENTS,
  RegulatoryStatus,
  deriveRegulatoryStatus,
  readRegulatoryStatus,
  aggregateRegulatoryStatus,
  isReglementAvisOnly,
  REGLEMENT_STAGES_FERMES,
} from "./reglement-lifecycle.js";
import { OntoRelationType } from "./relations-generated.js";
import { OntoDesignationEvent, OntoBylaw } from "./entities.js";
import type { ReconBridgeT } from "../provenance.js";

/**
 * LOT 1 — cycle de vie règlement (contrat gelé geo↔immo `5f7ca0a9`).
 * Vérifie : réutilisation RegulatoryStageKind (pas de nouvel enum), en_vigueur
 * 3-états, relation α discriminée avec relationType TOLÉRANT (§9), wiring
 * TemporalSpan sur les nœuds, et la propriété single-source KNOWN_RELATION_TYPES.
 */

const recon: ReconBridgeT = {
  canonicalId: "event::x",
  reconStatus: "validated",
  reconPatchId: "patch-1",
  knownFrom: "2026-03-01T10:00:00.000Z",
  knownTo: null,
};
const RAW = "raw/avis/x/2026/03/01/abc.pdf.sha";
const UUID = "11111111-1111-4111-8111-111111111111";
const TEMPORAL = {
  validFrom: "2026-03-01",
  validTo: null,
  knownFrom: "2026-03-01T10:00:00.000Z",
  knownTo: null,
};

describe("RegulatoryStageKind (réutilisé comme statut, PAS un nouvel enum)", () => {
  it("porte les 8 étapes légales (le 3-étapes owner en est un sous-ensemble)", () => {
    expect(RegulatoryStageKind.options).toHaveLength(8);
    expect(RegulatoryStageKind.options).toContain("avis-motion");
    expect(RegulatoryStageKind.options).toContain("adopte");
    expect(RegulatoryStageKind.options).toContain("entree-vigueur");
  });
  it("est LA MÊME référence que celle ré-exportée par relations.ts (single-source)", async () => {
    const fromRelations = await import("./relations.js");
    expect(fromRelations.RegulatoryStageKind).toBe(RegulatoryStageKind);
  });
});

describe("EnVigueurProvenance (3 états, anti-invention §2.1)", () => {
  it("accepte verbatim / derived / unknown", () => {
    expect(EnVigueurProvenance.parse("verbatim")).toBe("verbatim");
    expect(EnVigueurProvenance.parse("derived")).toBe("derived");
    expect(EnVigueurProvenance.parse("unknown")).toBe("unknown");
  });
  it("rejette un 4e état (pas de date fabriquée déguisée)", () => {
    expect(() => EnVigueurProvenance.parse("guessed")).toThrow();
  });
});

describe("KNOWN_RELATION_TYPES (dérivé du YAML généré, DETTE #54)", () => {
  it("est exactement OntoRelationType.options (single-source, pas une liste à la main)", () => {
    expect(KNOWN_RELATION_TYPES).toEqual(OntoRelationType.options);
  });
  it("inclut les 2 types LOT 1 + conserve amends/supersedes", () => {
    expect(KNOWN_RELATION_TYPES).toContain("lifecycle_predecessor");
    expect(KNOWN_RELATION_TYPES).toContain("replaces");
    expect(KNOWN_RELATION_TYPES).toContain("amends");
    expect(KNOWN_RELATION_TYPES).toContain("supersedes");
  });
});

describe("OntoRelation (α discriminée, relationType TOLÉRANT §9)", () => {
  it("parse une relation typée-connue vers un n° de règlement (target = cible, A1-safe)", () => {
    const r = OntoRelation.parse({
      relationType: "replaces",
      target: { reglementNumero: "765" },
      fromLibelle: "abroge et remplace le règlement 764",
    });
    expect(r.target).toEqual({ reglementNumero: "765" });
    expect(r.typingConfidence).toBe("certain"); // défaut
    expect(r.flagged).toBe(false); // défaut
  });
  it("TOLÈRE un relationType INCONNU (§9 : ignoré/passé, jamais un crash)", () => {
    const r = OntoRelation.parse({
      relationType: "some_future_type_not_in_yaml",
      target: { nodeId: UUID },
    });
    expect(r.relationType).toBe("some_future_type_not_in_yaml");
    expect(KNOWN_RELATION_TYPES).not.toContain(r.relationType); // le consommateur l'ignorera
  });
  it("lifecycle_predecessor peut porter fromLibelle=null (dérivé n°+ordre-stages, pas un libellé geo)", () => {
    const r = OntoRelation.parse({ relationType: "lifecycle_predecessor", target: { nodeId: UUID } });
    expect(r.fromLibelle).toBeNull();
  });
  it("permet de flagger un typage incertain (amends peu clair → revue, jamais deviné)", () => {
    const r = OntoRelation.parse({
      relationType: "amends",
      target: { reglementNumero: "150-49" },
      fromLibelle: "concernant le règlement 150",
      typingConfidence: "uncertain",
      flagged: true,
    });
    expect(r.flagged).toBe(true);
  });
  it("rejette une relation sans relationType et sans target valide", () => {
    expect(() => OntoRelation.parse({ relationType: "", target: { reglementNumero: "1" } })).toThrow();
    expect(() => OntoRelation.parse({ relationType: "replaces", target: {} })).toThrow();
  });
});

describe("Wiring LOT 1 sur les nœuds (défauts sûrs = rétro-compatible)", () => {
  it("OntoDesignationEvent : subtype avis-motion + statut + cible + temporal + relations", () => {
    const e = OntoDesignationEvent.parse({
      id: UUID,
      citySlug: "la-minerve",
      subtype: "avis-motion",
      statut: "avis-motion",
      cibleReglementNumero: "765",
      temporal: TEMPORAL,
      relations: [{ relationType: "lifecycle_predecessor", target: { nodeId: UUID } }],
      rawRef: RAW,
      recon,
    });
    expect(e.subtype).toBe("avis-motion");
    expect(e.statut).toBe("avis-motion");
    expect(e.cibleReglementNumero).toBe("765");
    expect(e.relations).toHaveLength(1);
  });
  it("OntoDesignationEvent : défauts sûrs quand les champs LOT 1 sont omis (rétro-compat)", () => {
    const e = OntoDesignationEvent.parse({
      id: UUID,
      citySlug: "x",
      subtype: "rezoning",
      rawRef: RAW,
      recon,
    });
    expect(e.statut).toBeNull();
    expect(e.cibleReglementNumero).toBeNull();
    expect(e.temporal).toBeNull();
    expect(e.relations).toEqual([]);
  });
  it("OntoBylaw : temporal + enVigueurProvenance 3-états + relations (amendsBylawId conservé)", () => {
    const b = OntoBylaw.parse({
      id: UUID,
      citySlug: "la-minerve",
      numero: "765",
      temporal: TEMPORAL,
      enVigueurProvenance: "unknown", // délai inconnu → jamais une date fabriquée
      relations: [{ relationType: "replaces", target: { reglementNumero: "764" }, fromLibelle: "abroge 764" }],
      rawRef: RAW,
      recon,
    });
    expect(b.enVigueurProvenance).toBe("unknown");
    expect(b.amendsBylawId).toBeNull(); // vue dérivée back-compat conservée
    expect(b.relations[0]?.relationType).toBe("replaces");
  });
  it("OntoBylaw : défauts sûrs quand les champs LOT 1 sont omis (rétro-compat)", () => {
    const b = OntoBylaw.parse({ id: UUID, citySlug: "x", numero: "1", rawRef: RAW, recon });
    expect(b.temporal).toBeNull();
    expect(b.enVigueurProvenance).toBeNull();
    expect(b.relations).toEqual([]);
  });
});

describe("typeInstrument (contrat §10 — famille d'instrument, §9-tolérant, axe orthogonal au régime)", () => {
  it("KNOWN_TYPE_INSTRUMENTS = le wire geo exact", () => {
    expect([...KNOWN_TYPE_INSTRUMENTS]).toEqual([
      "zonage", "lotissement", "construction", "plan-urbanisme", "piia", "derogation",
    ]);
  });
  it("OntoDesignationEvent : accepte une valeur CONNUE (déclaré-source)", () => {
    const e = OntoDesignationEvent.parse({
      id: UUID, citySlug: "la-minerve", subtype: "avis-motion",
      typeInstrument: "zonage", rawRef: RAW, recon,
    });
    expect(e.typeInstrument).toBe("zonage");
  });
  it("TOLÈRE une valeur INCONNUE (§9 : string quelconque, jamais un crash — le consommateur bucketera)", () => {
    const e = OntoDesignationEvent.parse({
      id: UUID, citySlug: "x", subtype: "rezoning",
      typeInstrument: "amenagement-ecologique-futur", rawRef: RAW, recon,
    });
    expect(e.typeInstrument).toBe("amenagement-ecologique-futur");
    expect([...KNOWN_TYPE_INSTRUMENTS]).not.toContain(e.typeInstrument); // hors set connu → ignoré/bucketé
  });
  it('accepte le littéral "unknown" (titre source absent/ambigu) ET null (legacy/non-peuplé)', () => {
    const a = OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "rezoning", typeInstrument: "unknown", rawRef: RAW, recon });
    expect(a.typeInstrument).toBe("unknown");
    const b = OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "rezoning", typeInstrument: null, rawRef: RAW, recon });
    expect(b.typeInstrument).toBeNull();
  });
  it("défaut = null quand omis (rétro-compat, safe-default)", () => {
    const e = OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "rezoning", rawRef: RAW, recon });
    expect(e.typeInstrument).toBeNull();
  });
  it("REJETTE un non-string (miroir validateZoningEvent : string-ou-null seulement)", () => {
    expect(() =>
      OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "rezoning", typeInstrument: 3, rawRef: RAW, recon }),
    ).toThrow();
  });
  it("OntoBylaw porte AUSSI typeInstrument (axe orthogonal : règlement habilitant = bylaw + type_instrument=derogation)", () => {
    const b = OntoBylaw.parse({
      id: UUID, citySlug: "la-minerve", numero: "R-2024-derog",
      typeInstrument: "derogation", rawRef: RAW, recon,
    });
    // Régime bylaw (numero présent) ET instrument derogation coexistent — type_instrument ne force pas le régime.
    expect(b.typeInstrument).toBe("derogation");
  });
  it("OntoBylaw : défaut null quand omis (rétro-compat)", () => {
    const b = OntoBylaw.parse({ id: UUID, citySlug: "x", numero: "1", rawRef: RAW, recon });
    expect(b.typeInstrument).toBeNull();
  });
});

describe("regulatoryStatus (LOT 1 serving — axe firm/anticipation dérivé-immo, invariant §3)", () => {
  it("enum binaire {firm, anticipation} (pas de 3e bucket, D1)", () => {
    expect(RegulatoryStatus.options).toEqual(["firm", "anticipation"]);
  });
  it("OntoDesignationEvent : accepte firm / anticipation / null", () => {
    const base = { id: UUID, citySlug: "x", subtype: "avis-motion", rawRef: RAW, recon } as const;
    expect(OntoDesignationEvent.parse({ ...base, regulatoryStatus: "anticipation" }).regulatoryStatus).toBe("anticipation");
    expect(OntoDesignationEvent.parse({ ...base, regulatoryStatus: "firm" }).regulatoryStatus).toBe("firm");
    expect(OntoDesignationEvent.parse({ ...base, regulatoryStatus: null }).regulatoryStatus).toBeNull();
  });
  it("défaut = null quand omis (legacy non-dérivé → fallback anticipation à la lecture ; rétro-compat)", () => {
    const e = OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "rezoning", rawRef: RAW, recon });
    expect(e.regulatoryStatus).toBeNull();
  });
  it("REJETTE un 3e état (binaire strict — pas de firm déguisé)", () => {
    expect(() =>
      OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "rezoning", regulatoryStatus: "pending", rawRef: RAW, recon }),
    ).toThrow();
  });
  it("OntoBylaw porte AUSSI regulatoryStatus (firm ; abrogé = firm + temporal.validTo fermé)", () => {
    const b = OntoBylaw.parse({ id: UUID, citySlug: "x", numero: "1", regulatoryStatus: "firm", rawRef: RAW, recon });
    expect(b.regulatoryStatus).toBe("firm");
    expect(OntoBylaw.parse({ id: UUID, citySlug: "x", numero: "2", rawRef: RAW, recon }).regulatoryStatus).toBeNull();
  });
});

describe("deriveRegulatoryStatus (LOT 1 serving — LE classifieur UNIQUE, D1/D2, invariant §3)", () => {
  it("firm iff statut ∈ {adopte, entree-vigueur} (D1)", () => {
    expect(deriveRegulatoryStatus({ statut: "adopte" })).toBe("firm");
    expect(deriveRegulatoryStatus({ statut: "entree-vigueur" })).toBe("firm");
  });
  it("toute autre étape (avis/projet/consultation/registre) = anticipation", () => {
    for (const s of ["avis-motion", "1er-projet", "consultation-publique", "2e-projet", "registre-referendaire"] as const)
      expect(deriveRegulatoryStatus({ statut: s })).toBe("anticipation");
  });
  it("abandonne = anticipation (état terminal, jamais firm)", () => {
    expect(deriveRegulatoryStatus({ statut: "abandonne" })).toBe("anticipation");
  });
  it("D2 fallback legacy : sans statut, dérive de l'etape structuré (adoption/entree_vigueur → firm ; jamais keyword)", () => {
    expect(deriveRegulatoryStatus({ etape: "adoption" })).toBe("firm");
    expect(deriveRegulatoryStatus({ etape: "entree_vigueur" })).toBe("firm");
    expect(deriveRegulatoryStatus({ etape: "avis_motion" })).toBe("anticipation");
  });
  it("statut PRIME sur etape (source autoritative > legacy)", () => {
    expect(deriveRegulatoryStatus({ statut: "avis-motion", etape: "adoption" })).toBe("anticipation");
  });
  // NÉGATIF (anti-invention, LE garde) : aucune preuve → anticipation fail-safe, JAMAIS firm.
  it("aucune preuve (statut ET etape absents/null) → anticipation FAIL-SAFE (jamais firm sans preuve)", () => {
    expect(deriveRegulatoryStatus({})).toBe("anticipation");
    expect(deriveRegulatoryStatus({ statut: null, etape: null })).toBe("anticipation");
  });
});

describe("readRegulatoryStatus (LOT 1 serving — LOCUS DE LECTURE UNIQUE, R5)", () => {
  it("rend le champ PERSISTÉ tel quel quand il est présent (pas de re-dérivation)", () => {
    // Le champ persisté PRIME même si l'etape brut le contredirait : on LIT, on ne re-classifie pas.
    expect(readRegulatoryStatus({ regulatoryStatus: "firm", etape: "avis_motion" })).toBe("firm");
    expect(readRegulatoryStatus({ regulatoryStatus: "anticipation", statut: "adopte" })).toBe("anticipation");
  });
  it("nœud LEGACY sans champ → fallback deriveRegulatoryStatus (MÊME fn, pas un classifieur indépendant)", () => {
    expect(readRegulatoryStatus({ regulatoryStatus: null, statut: "adopte" })).toBe("firm");
    expect(readRegulatoryStatus({ etape: "adoption" })).toBe("firm");
    expect(readRegulatoryStatus({ etape: "avis_motion" })).toBe("anticipation");
  });
  it("champ absent ET aucune preuve → anticipation FAIL-SAFE (jamais firm sans preuve)", () => {
    expect(readRegulatoryStatus({})).toBe("anticipation");
    expect(readRegulatoryStatus({ regulatoryStatus: null, statut: null, etape: null })).toBe("anticipation");
  });
});

describe("aggregateRegulatoryStatus (LOT 1 serving — invariant REVERSE, agrégat PAR cible)", () => {
  it("FERME dès qu'AU MOINS UN nœud est ferme (l'adoption prime sur l'avis frère)", () => {
    expect(aggregateRegulatoryStatus(["anticipation", "firm"])).toBe("firm");
    expect(aggregateRegulatoryStatus(["firm"])).toBe("firm");
  });
  // REVERSE-bug (i-arch) : un règlement adopté dont le nœud-Bylaw n'a pas de stade direct
  // (→ anticipation isolé/null) hérite du ferme de son nœud-adoption via l'agrégat.
  it("nœud-Bylaw sans stade (null) + nœud-adoption ferme → l'agrégat est FERME (pas de reverse-bug)", () => {
    expect(aggregateRegulatoryStatus([null, "firm"])).toBe("firm");
    expect(aggregateRegulatoryStatus([undefined, "firm", "anticipation"])).toBe("firm");
  });
  it("aucun nœud ferme (que des anticipations) → anticipation", () => {
    expect(aggregateRegulatoryStatus(["anticipation", "anticipation"])).toBe("anticipation");
  });
  it("ensemble vide ou tout-null → anticipation FAIL-SAFE (jamais firm sans preuve)", () => {
    expect(aggregateRegulatoryStatus([])).toBe("anticipation");
    expect(aggregateRegulatoryStatus([null, undefined])).toBe("anticipation");
  });
});

describe("isReglementAvisOnly (LOT 1 — axe HIDE avis-only, single-source UI+serving)", () => {
  const set = (...e: string[]) => new Set(e);

  it("avis_motion SEUL → avis-only (candidat HIDE-drawer, owner P4)", () => {
    expect(isReglementAvisOnly(set("avis_motion"))).toBe(true);
  });
  it("un stade réel au-delà de l'avis FERME l'avis-only (montré) : projet/consultation/adoption/en-vigueur", () => {
    expect(isReglementAvisOnly(set("avis_motion", "premier_projet"))).toBe(false);
    expect(isReglementAvisOnly(set("avis_motion", "projet_reglement"))).toBe(false);
    expect(isReglementAvisOnly(set("avis_motion", "second_projet"))).toBe(false);
    expect(isReglementAvisOnly(set("avis_motion", "consultation_publique"))).toBe(false);
    expect(isReglementAvisOnly(set("avis_motion", "adoption"))).toBe(false);
    expect(isReglementAvisOnly(set("avis_motion", "entree_vigueur"))).toBe(false);
  });
  it("`inconnu` présent → PAS avis-only (anti-invention : un stade inconnu interdit de conclure)", () => {
    expect(isReglementAvisOnly(set("avis_motion", "inconnu"))).toBe(false);
  });
  it("sans avis_motion → PAS avis-only (ensemble vide inclus)", () => {
    expect(isReglementAvisOnly(set("projet_reglement"))).toBe(false);
    expect(isReglementAvisOnly(set())).toBe(false);
  });
  it("REGLEMENT_STAGES_FERMES = les 6 stades réels au-delà de l'avis (verbatim vues A.4a)", () => {
    expect([...REGLEMENT_STAGES_FERMES].sort()).toEqual([
      "adoption",
      "consultation_publique",
      "entree_vigueur",
      "premier_projet",
      "projet_reglement",
      "second_projet",
    ]);
  });
  // AXES DISTINCTS (i-arch/i-cond) : le HIDE (avis-only) ≠ le MARQUAGE (regulatoryStatus).
  it("axe HIDE ≠ axe MARQUAGE : projet_reglement n'est PAS avis-only (montré) mais reste anticipation", () => {
    expect(isReglementAvisOnly(set("avis_motion", "projet_reglement"))).toBe(false); // montré
    expect(deriveRegulatoryStatus({ etape: "projet_reglement" })).toBe("anticipation"); // anticipation
    // Réciproque : une adoption est firm (marquage) ET montrée (pas avis-only).
    expect(deriveRegulatoryStatus({ etape: "adoption" })).toBe("firm");
    expect(isReglementAvisOnly(set("avis_motion", "adoption"))).toBe(false);
  });
});
