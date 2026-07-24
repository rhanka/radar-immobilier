import { describe, expect, it } from "vitest";
import {
  isPublicCanonicalUrl,
  publicProvenanceFromEvidence,
  publicProvenanceFromProperties,
  sanitizeFeatureProvenance,
  validateFeatureProof,
  validateZoneLotProvenance,
} from "./provenance.js";

// ─── Contract-valid fixtures (immo-feature-proof v1/v2, provenance v1) ────────

const PROOF_V1 = {
  schema_version: "1.0",
  status: "complete",
  sources: {
    geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
    regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
  },
  zone: null,
  gaps: ["regulation_source_unavailable"],
} as const;

const PROOF_V2 = {
  schema_version: "2.0",
  geometry_source: {
    url: "https://donnees.example.org/zonage.geojson",
    type: "geojson-officiel",
    method: "natif",
    reliability: "directe",
    retrieved_at: "2026-06-21T09:00:00Z",
    sha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
} as const;

const PROVENANCE_V1 = {
  contract: "immo-zone-lot-provenance/v1",
  assessed_at: "2026-07-22T14:00:00Z",
  lot_assignment_evidence: {
    state: "recorded",
    selected_zone: { collection: "qc-zonage-delson", feature_ref: "qc-zonage-delson#zone_code=H-12", code: "H-12" },
    assignment_method: "area-majority",
    dominant_fraction: 0.94,
    multi_zone: false,
    zone_codes: ["H-12"],
    evidence_snapshot: "2026-06-21",
    evidence_id: "lot-zone-ev-7d21",
    reason_codes: [],
  },
  zone_geometry_provenance: {
    status: "historical-verified",
    zone: { collection: "qc-zonage-delson", feature_ref: "qc-zonage-delson#zone_code=H-12", code: "H-12" },
    public_source: {
      url: "https://donnees.example.org/zonage.geojson",
      type: "geojson-officiel",
      method: "natif",
      retrieved_at: "2026-06-21T09:00:00Z",
      sha256: null,
    },
    verified_at: "2026-07-22T13:50:00Z",
    evidence_id: "geom-ev-a02e",
    reason_codes: [],
  },
  acquisition_v2_readiness: {
    state: "not-ready",
    checked_at: "2026-07-22T14:00:00Z",
    unmet_requirement_codes: ["missing-content-sha256"],
  },
} as const;

// A deep clone that can carry an injected leak without mutating the constant.
function cloneProofV1(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(PROOF_V1));
}
function cloneProvenanceV1(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(PROVENANCE_V1));
}

describe("positive, versioned validation keeps only conforming envelopes", () => {
  it("keeps contract-valid v1 / v2 proof and provenance verbatim", () => {
    expect(validateFeatureProof(PROOF_V1)).toEqual(PROOF_V1);
    expect(validateFeatureProof(PROOF_V2)).toEqual(PROOF_V2);
    expect(validateZoneLotProvenance(PROVENANCE_V1)).toEqual(PROVENANCE_V1);
    expect(
      publicProvenanceFromProperties({ code_zone: "H-12", proof: PROOF_V1, immo_zone_lot_provenance: PROVENANCE_V1 }),
    ).toEqual({ proof: PROOF_V1, immo_zone_lot_provenance: PROVENANCE_V1 });
  });

  it("accepts a legacy-traceable + ready provenance (independent axes)", () => {
    const legacyReady = cloneProvenanceV1();
    (legacyReady.zone_geometry_provenance as Record<string, unknown>).status = "legacy-traceable";
    (legacyReady.zone_geometry_provenance as Record<string, unknown>).verified_at = null;
    (legacyReady.zone_geometry_provenance as Record<string, unknown>).reason_codes = ["historical-verification-unavailable"];
    (legacyReady.acquisition_v2_readiness as Record<string, unknown>).state = "ready";
    (legacyReady.acquisition_v2_readiness as Record<string, unknown>).unmet_requirement_codes = [];
    expect(validateZoneLotProvenance(legacyReady)).toEqual(legacyReady);
  });
});

describe("anti-leak: unknown keys, jobs, logs, secrets are rejected as a whole", () => {
  it("rejects a proof carrying an unknown/internal key (job_id, run_id, raw_log, error, token, password)", () => {
    for (const leakKey of ["job_id", "run_id", "raw_log", "error", "token", "password"]) {
      const leaky = { ...cloneProofV1(), [leakKey]: "secret-value" };
      expect(validateFeatureProof(leaky)).toBeUndefined();
      expect(sanitizeFeatureProvenance({ code_zone: "H-12", proof: leaky })).toEqual({ code_zone: "H-12" });
    }
  });

  it("rejects a provenance carrying an unknown/internal key", () => {
    for (const leakKey of ["job_id", "run_id", "raw_log", "error", "token", "password"]) {
      const leaky = { ...cloneProvenanceV1(), [leakKey]: "secret-value" };
      expect(validateZoneLotProvenance(leaky)).toBeUndefined();
    }
  });

  it("rejects a leak buried in a nested object (unknown key on public_source)", () => {
    const leaky = cloneProvenanceV1();
    (leaky.zone_geometry_provenance as { public_source: Record<string, unknown> }).public_source["raw_log"] = "…";
    expect(validateZoneLotProvenance(leaky)).toBeUndefined();
  });
});

describe("anti-leak: storage keys, local paths and non-public URLs are rejected", () => {
  it("rejects S3 keys, local paths, signed, localhost, private-IP and minio URLs in proof", () => {
    for (const bad of [
      "s3://private/a",
      "/tmp/a",
      "file:///etc/passwd",
      "https://geo.example/a?X-Amz-Signature=x",
      "https://geo.example/a#frag",
      "http://127.0.0.1/zonage.geojson",
      "http://localhost:9000/zonage.geojson",
      "http://10.0.0.5/zonage.geojson",
      "http://192.168.1.4/zonage.geojson",
      "https://radar-minio.internal/zonage.geojson",
      "https://bucket.s3.amazonaws.com/zonage.geojson",
    ]) {
      const proof = cloneProofV1();
      (proof.sources as { geometry: { artifact_uri: string } }).geometry.artifact_uri = bad;
      expect(validateFeatureProof(proof)).toBeUndefined();
      expect(sanitizeFeatureProvenance({ code_zone: "H-12", proof })).toEqual({ code_zone: "H-12" });
    }
  });

  it("rejects a v2 geometry_source or provenance public_source on a private/minio host", () => {
    for (const bad of [
      "http://127.0.0.1/zonage.geojson",
      "http://localhost/zonage.geojson",
      "https://minio.local/zonage.geojson",
      "https://a.s3-eu-west-3.amazonaws.com/zonage.geojson",
    ]) {
      const proof = JSON.parse(JSON.stringify(PROOF_V2));
      proof.geometry_source.url = bad;
      expect(validateFeatureProof(proof)).toBeUndefined();

      const provenance = cloneProvenanceV1();
      (provenance.zone_geometry_provenance as { public_source: { url: string } }).public_source.url = bad;
      expect(validateZoneLotProvenance(provenance)).toBeUndefined();
    }
  });

  it("isPublicCanonicalUrl accepts only canonical public HTTP(S) URLs", () => {
    expect(isPublicCanonicalUrl("https://donnees.example.org/zonage.geojson")).toBe(true);
    expect(isPublicCanonicalUrl("http://ville.qc.ca/grille.pdf")).toBe(true);
    expect(isPublicCanonicalUrl("https://user:pass@ville.qc.ca/x")).toBe(false);
    expect(isPublicCanonicalUrl("https://ville.qc.ca/x?a=1")).toBe(false);
    expect(isPublicCanonicalUrl("http://localhost/x")).toBe(false);
    expect(isPublicCanonicalUrl("ftp://ville.qc.ca/x")).toBe(false);
  });
});

describe("truncated / malformed envelopes are rejected, not repaired", () => {
  it("rejects a proof missing a mandatory field (sources / gaps)", () => {
    expect(validateFeatureProof({ schema_version: "1.0", status: "complete", zone: null, gaps: [] })).toBeUndefined();
    expect(validateFeatureProof({ schema_version: "1.0", status: "complete", sources: {}, zone: null, gaps: [] })).toBeUndefined();
    expect(validateFeatureProof({ schema_version: "2.0", geometry_source: { url: "https://ville.qc.ca/z.geojson" } })).toBeUndefined();
  });

  it("rejects a provenance missing one of the three mandatory axes", () => {
    const noReadiness = cloneProvenanceV1();
    delete (noReadiness as Record<string, unknown>).acquisition_v2_readiness;
    expect(validateZoneLotProvenance(noReadiness)).toBeUndefined();

    const noEvidence = cloneProvenanceV1();
    delete (noEvidence as Record<string, unknown>).lot_assignment_evidence;
    expect(validateZoneLotProvenance(noEvidence)).toBeUndefined();
  });

  it("rejects bad enums and broken nullity/readiness constraints", () => {
    const badStatus = cloneProvenanceV1();
    (badStatus.zone_geometry_provenance as Record<string, unknown>).status = "verified";
    expect(validateZoneLotProvenance(badStatus)).toBeUndefined();

    // ready MUST carry an empty unmet list.
    const readyWithUnmet = cloneProvenanceV1();
    (readyWithUnmet.acquisition_v2_readiness as Record<string, unknown>).state = "ready";
    (readyWithUnmet.acquisition_v2_readiness as Record<string, unknown>).unmet_requirement_codes = ["missing-content-sha256"];
    expect(validateZoneLotProvenance(readyWithUnmet)).toBeUndefined();

    // historical-verified MUST carry verified_at + evidence_id.
    const brokenHistorical = cloneProvenanceV1();
    (brokenHistorical.zone_geometry_provenance as Record<string, unknown>).verified_at = null;
    expect(validateZoneLotProvenance(brokenHistorical)).toBeUndefined();

    // orphan MUST carry a non-empty reason_codes.
    const orphanNoReason = cloneProvenanceV1();
    (orphanNoReason.zone_geometry_provenance as Record<string, unknown>).status = "orphan";
    (orphanNoReason.zone_geometry_provenance as Record<string, unknown>).verified_at = null;
    (orphanNoReason.zone_geometry_provenance as Record<string, unknown>).evidence_id = null;
    (orphanNoReason.zone_geometry_provenance as Record<string, unknown>).public_source = null;
    (orphanNoReason.zone_geometry_provenance as Record<string, unknown>).reason_codes = [];
    expect(validateZoneLotProvenance(orphanNoReason)).toBeUndefined();
  });
});

describe("sanitizeFeatureProvenance never drops a preexisting conforming proof", () => {
  it("keeps a valid proof even when the provenance envelope is invalid", () => {
    const leakyProvenance = { ...cloneProvenanceV1(), token: "leak" };
    const sanitized = sanitizeFeatureProvenance({
      code_zone: "H-12",
      zone_code: "H-12",
      proof: PROOF_V1,
      immo_zone_lot_provenance: leakyProvenance,
    });
    expect(sanitized).toEqual({ code_zone: "H-12", zone_code: "H-12", proof: PROOF_V1 });
  });

  it("leaves every non-provenance property untouched", () => {
    const props = { code_zone: "H-12", zone_codes: ["H-12"], dominant_fraction: null, multi_zone: false };
    expect(sanitizeFeatureProvenance(props)).toEqual(props);
  });
});

describe("publicProvenanceFromEvidence", () => {
  it("recovers a stored conforming envelope and ignores a leaky sibling entry", () => {
    expect(
      publicProvenanceFromEvidence([
        { source: "internal-job", token: "x", raw_log: "y" },
        { source: "ogc-api", proof: PROOF_V1, immo_zone_lot_provenance: PROVENANCE_V1 },
      ]),
    ).toEqual({ proof: PROOF_V1, immo_zone_lot_provenance: PROVENANCE_V1 });
  });

  it("returns nothing when the only stored envelope is non-conforming", () => {
    expect(publicProvenanceFromEvidence([{ source: "ogc-api", proof: { schema_version: "1.0", status: "complete", sources: {}, zone: null, gaps: [] } }])).toEqual({});
  });
});
