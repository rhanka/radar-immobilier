import { describe, expect, it } from "vitest";
import {
  OntoMunicipality,
  OntoZone,
  OntoBylaw,
  OntoDesignationEvent,
  OntoConstraint,
  OntoLot,
  OntoAdresse,
  OntoValuation,
  OntoSource,
  OntoSignal,
} from "./entities.js";
import { GeoLocated } from "./geo.js";
import type { ReconBridgeT } from "../provenance.js";
import type { EvidenceItemT } from "../opportunity.js";

/**
 * Parse/reject tests for the V1 canonical node set (SPEC_ONTOLOGY §1.1 D4).
 *
 * REAL-DATA NOTE: the MAMH code "70052", the lot numbers ("4193751",
 * "5559304") and the matricule components (RL0104A/B/C → "5114-86-8189") below
 * are REAL values from the MAMH role sample
 * `packages/radar-sources/src/sources/_spikes/roles-evaluation-fonciere-mamh/samples/RL70052_2026.first-record.xml`
 * (Salaberry-de-Valleyfield). UUIDs, S3 raw refs, canonical ids and zone/bylaw
 * codes are ILLUSTRATIVE placeholders to exercise the schemas, not asserted facts.
 */

const recon: ReconBridgeT = {
  canonicalId: "zone::salaberry::2026::H-609-4",
  reconStatus: "validated",
  reconPatchId: "patch-20260607-0001",
  knownFrom: "2026-06-07T10:00:00.000Z",
  knownTo: null,
};

const evidence: EvidenceItemT[] = [
  {
    phase: "signal",
    sourceId: "src-avis-150-49",
    label: "Avis public 150-49 p.3",
    url: "https://example.test/avis-150-49.pdf",
    date: "2026-05-12",
    obtentionMode: "download",
    confidence: "high",
    verification: "fait",
  },
];

const RAW = "raw/avis/salaberry/2026/05/12/abc123.pdf.sha";
const UUID = "11111111-1111-4111-8111-111111111111";

describe("OntoMunicipality (registry, not reconciled)", () => {
  it("parses with the real MAMH code and defaults geom to null/none", () => {
    const m = OntoMunicipality.parse({
      id: UUID,
      slug: "salaberry-de-valleyfield",
      nomOfficiel: "Salaberry-de-Valleyfield",
      codeMamh: "70052", // REAL
      mrcSlug: "beauharnois-salaberry",
    });
    expect(m.dguidStatcan).toBeNull();
    expect(m.geom).toBeNull();
    expect(m.geomSource).toBe("none");
  });
  it("rejects an empty codeMamh", () => {
    expect(() =>
      OntoMunicipality.parse({
        id: UUID,
        slug: "x",
        nomOfficiel: "X",
        codeMamh: "",
        mrcSlug: "y",
      }),
    ).toThrow();
  });
});

describe("OntoZone (reconciled + geo)", () => {
  it("parses a zone with a recon bridge and geometry", () => {
    const z = OntoZone.parse({
      id: UUID,
      citySlug: "salaberry-de-valleyfield",
      codeAffiche: "H-609-4",
      kind: "H",
      rawRef: RAW,
      recon,
      evidence,
      geom: "POLYGON((0 0,0 1,1 1,1 0,0 0))",
      geomSource: "open-data-ckan",
    });
    expect(z.recon.canonicalId).toContain("H-609-4");
    expect(z.geomSource).toBe("open-data-ckan");
  });
  it("rejects an unknown zone kind", () => {
    expect(() =>
      OntoZone.parse({ id: UUID, citySlug: "x", codeAffiche: "H-1", kind: "Z", rawRef: RAW, recon }),
    ).toThrow();
  });
});

describe("OntoBylaw", () => {
  it("parses a bylaw; amendsBylawId defaults null (derived from AMENDS)", () => {
    const b = OntoBylaw.parse({
      id: UUID,
      citySlug: "salaberry-de-valleyfield",
      numero: "150-49",
      rawRef: RAW,
      recon: { ...recon, canonicalId: "bylaw::salaberry::150-49" },
    });
    expect(b.amendsBylawId).toBeNull();
    expect(b.titre).toBeNull();
  });
});

describe("OntoDesignationEvent (subtypes incl. intention/precedent)", () => {
  it("parses an intention subtype (D6 weak signal)", () => {
    const e = OntoDesignationEvent.parse({
      id: UUID,
      citySlug: "salaberry-de-valleyfield",
      subtype: "intention",
      rawRef: RAW,
      recon: { ...recon, canonicalId: "event::salaberry::2026::intention-secteur-est" },
    });
    expect(e.subtype).toBe("intention");
    expect(e.occurredOn).toBeNull();
  });
  it("rejects an unknown subtype", () => {
    expect(() =>
      OntoDesignationEvent.parse({ id: UUID, citySlug: "x", subtype: "demolition", rawRef: RAW, recon }),
    ).toThrow();
  });
});

describe("OntoConstraint (source-backed, citation mandatory)", () => {
  it("parses a CPTAQ constraint with ≥1 evidence ref", () => {
    const c = OntoConstraint.parse({
      id: UUID,
      citySlug: "salaberry-de-valleyfield",
      kind: "cptaq-zone-agricole",
      source: "CPTAQ",
      confidence: "high",
      rawRef: RAW,
      evidence,
    });
    expect(c.kind).toBe("cptaq-zone-agricole");
  });
  it("REJECTS a constraint with no evidence (evidence_policy requires ≥1)", () => {
    expect(() =>
      OntoConstraint.parse({
        id: UUID,
        citySlug: "x",
        kind: "bdzi-inondable",
        source: "BDZI",
        rawRef: RAW,
        evidence: [],
      }),
    ).toThrow();
  });
});

describe("OntoLot (cadastre registry, real NO_LOT)", () => {
  it("parses a lot using a real cadastre number", () => {
    const l = OntoLot.parse({
      id: UUID,
      noLot: "4193751", // REAL (RL0103Ax in the role sample)
      citySlug: "salaberry-de-valleyfield",
      rawRef: RAW,
      recon: { ...recon, canonicalId: "lot::4193751" },
    });
    expect(l.noLot).toBe("4193751");
    expect(l.geom).toBeNull();
  });
});

describe("OntoAdresse (provincial key, LOCATED_AT)", () => {
  it("parses an address with lot links", () => {
    const a = OntoAdresse.parse({
      id: UUID,
      idAdresse: "adr-qc-123",
      adresseComplete: "100 rue Principale, Salaberry-de-Valleyfield",
      citySlug: "salaberry-de-valleyfield",
      lotIds: [UUID],
      rawRef: RAW,
      recon: { ...recon, canonicalId: "adresse::adr-qc-123" },
    });
    expect(a.lotIds).toHaveLength(1);
  });
});

describe("OntoValuation (per-lot, owner is PII-excluded)", () => {
  it("parses a role valuation; owner defaults to non-disponible (§7.4)", () => {
    const v = OntoValuation.parse({
      id: UUID,
      matricule: "5114-86-8189", // REAL (RL0104A/B/C in the role sample)
      lotId: UUID,
      citySlug: "salaberry-de-valleyfield",
      sourceKind: "role",
      rawRef: RAW,
      recon: { ...recon, canonicalId: "valuation::5114-86-8189::2026" },
    });
    expect(v.owner).toBe("non-disponible");
    expect(v.valeur).toBeNull();
  });
});

describe("OntoSource (document carrier)", () => {
  it("parses a role-evaluation source for the cross-city corpus (citySlug null allowed)", () => {
    const s = OntoSource.parse({
      id: UUID,
      kind: "role-evaluation",
      rawRef: "raw/role/salaberry/2026/RL70052_2026.xml.sha",
    });
    expect(s.citySlug).toBeNull();
  });
});

describe("OntoSignal (incl. intention/precedent cap)", () => {
  it("parses a rezoning signal", () => {
    const s = OntoSignal.parse({
      id: UUID,
      citySlug: "salaberry-de-valleyfield",
      kind: "residential-rezoning",
      summary: "Rezoning H-609-4 increases residential density.",
      rawRef: RAW,
      evidence,
    });
    expect(s.cappedAtSurveillance).toBe(false);
  });
  it("REJECTS an intention signal that is not capped at surveillance (D6)", () => {
    expect(() =>
      OntoSignal.parse({
        id: UUID,
        citySlug: "x",
        kind: "intention",
        summary: "City open to densifying east sector.",
        rawRef: RAW,
        cappedAtSurveillance: false,
      }),
    ).toThrow();
  });
  it("accepts an intention signal when capped", () => {
    const s = OntoSignal.parse({
      id: UUID,
      citySlug: "x",
      kind: "intention",
      summary: "City open to densifying east sector.",
      rawRef: RAW,
      cappedAtSurveillance: true,
    });
    expect(s.kind).toBe("intention");
  });
});

describe("GeoLocated invariant", () => {
  it("rejects geom present with geomSource none", () => {
    expect(() => GeoLocated.parse({ geom: "POINT(0 0)", geomSource: "none" })).toThrow();
  });
  it("rejects geom null with a non-none geomSource", () => {
    expect(() => GeoLocated.parse({ geom: null, geomSource: "open-data-ckan" })).toThrow();
  });
  it("accepts the consistent null/none pair", () => {
    expect(GeoLocated.parse({}).geomSource).toBe("none");
  });
});
