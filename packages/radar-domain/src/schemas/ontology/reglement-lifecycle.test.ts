import { describe, expect, it } from "vitest";
import {
  RegulatoryStageKind,
  EnVigueurProvenance,
  OntoRelation,
  KNOWN_RELATION_TYPES,
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
