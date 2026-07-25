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

const SHA256_HEX = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * `legacy-traceable` + `ready` HONNÊTE : la trace historique est incomplète
 * (axe géométrie), mais l'acquisition v2 porte réellement les 4 prérequis §5
 * (identité de zone, source publique canonique, instant d'acquisition, sha256).
 */
function readyProvenance(): Record<string, unknown> {
  const provenance = cloneProvenanceV1();
  const geometry = provenance.zone_geometry_provenance as Record<string, unknown>;
  geometry.status = "legacy-traceable";
  geometry.verified_at = null;
  geometry.reason_codes = ["historical-verification-unavailable"];
  (geometry.public_source as Record<string, unknown>).sha256 = SHA256_HEX;
  provenance.acquisition_v2_readiness = {
    state: "ready",
    checked_at: "2026-07-22T14:00:00Z",
    unmet_requirement_codes: [],
  };
  return provenance;
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

  it("accepts a legacy-traceable + ready provenance when §5's prerequisites are really carried", () => {
    // Axes indépendants : une trace legacy PEUT coexister avec une acquisition
    // v2 complète — mais `ready` doit alors porter ses 4 prérequis (§5).
    const legacyReady = readyProvenance();
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
    // Un nom d'hôte interne SANS point (service docker, hôte de cluster).
    expect(isPublicCanonicalUrl("http://api/zonage.geojson")).toBe(false);
    expect(isPublicCanonicalUrl("http://geo-internal.internal/z.geojson")).toBe(false);
  });
});

// ─── Contre-tests IPv6 : toute IP non globale est refusée ────────────────────

describe("anti-leak IPv6: only global-unicast addresses are public", () => {
  const NON_GLOBAL_IPV6 = [
    "http://[::1]/secret.geojson", // loopback
    "http://[::]/secret.geojson", // unspecified
    "http://[fd00::1]/secret.geojson", // ULA fd00::/8
    "http://[fc00::42]/secret.geojson", // ULA fc00::/7
    "http://[fe80::1]/secret.geojson", // link-local
    "http://[fe80::1%25eth0]/secret.geojson", // link-local zoné
    "http://[febf::1]/secret.geojson", // haut de fe80::/10
    "http://[ff02::1]/secret.geojson", // multicast
    "http://[::ffff:10.0.0.1]/secret.geojson", // IPv4-mappée (privée)
    "http://[::ffff:127.0.0.1]/secret.geojson", // IPv4-mappée (loopback)
    "http://[::ffff:0a00:0001]/secret.geojson", // IPv4-mappée, écriture hexa
    "http://[::127.0.0.1]/secret.geojson", // IPv4-compatible
    "http://[2001:db8::1]/secret.geojson", // documentation
    "http://[2002:7f00:1::1]/secret.geojson", // 6to4 (IPv4 encapsulée)
    "http://[0:0:0:0:0:0:0:1]/secret.geojson", // loopback non compressé
  ];

  it("rejects every non-global IPv6 host on artifact_uri, geometry_source.url and public_source.url", () => {
    for (const bad of NON_GLOBAL_IPV6) {
      expect(isPublicCanonicalUrl(bad)).toBe(false);

      const proofV1 = cloneProofV1();
      (proofV1.sources as { geometry: { artifact_uri: string } }).geometry.artifact_uri = bad;
      expect(validateFeatureProof(proofV1)).toBeUndefined();
      expect(sanitizeFeatureProvenance({ code_zone: "H-12", proof: proofV1 })).toEqual({ code_zone: "H-12" });

      const proofV2 = JSON.parse(JSON.stringify(PROOF_V2));
      proofV2.geometry_source.url = bad;
      expect(validateFeatureProof(proofV2)).toBeUndefined();

      const provenance = cloneProvenanceV1();
      (provenance.zone_geometry_provenance as { public_source: { url: string } }).public_source.url = bad;
      expect(validateZoneLotProvenance(provenance)).toBeUndefined();
    }
  });

  it("still accepts a global-unicast IPv6 literal (no blanket IPv6 ban)", () => {
    expect(isPublicCanonicalUrl("https://[2606:4700:4700::1111]/zonage.geojson")).toBe(true);
    expect(isPublicCanonicalUrl("https://[2a01:4f8:c17:b8f::1]/zonage.geojson")).toBe(true);
  });

  it("rejects the IPv4 blocks the first pass missed (CGNAT, link-local, TEST-NET, multicast)", () => {
    for (const bad of [
      "http://100.64.0.1/z.geojson",
      "http://169.254.169.254/z.geojson", // metadata service
      "http://192.0.2.10/z.geojson",
      "http://198.51.100.10/z.geojson",
      "http://203.0.113.10/z.geojson",
      "http://224.0.0.1/z.geojson",
      "http://255.255.255.255/z.geojson",
      "http://0.0.0.0/z.geojson",
    ]) {
      expect(isPublicCanonicalUrl(bad)).toBe(false);
    }
  });
});

// ─── Contre-tests « secret dans une chaîne libre » ───────────────────────────

describe("anti-leak: a secret hidden in an ALLOWED key fails positive formats", () => {
  /** Fuites structurelles : log, URL, chemin, clé S3, DSN, paire clé=valeur. */
  const SECRETS = [
    "raw_log: token=SECRET s3://bucket/x",
    "token=ghp_deadbeefdeadbeefdeadbeef",
    "https://user:pass@internal.host/dump.log",
    "s3://radar-private/raw/job-42.log",
    "/var/log/radar/geo-job.log",
    "postgres://radar:pwd@postgres:5432/radar",
  ];
  /** Les codes obéissent EN PLUS à la forme « token minuscule sans espace ». */
  const SECRET_CODES = [...SECRETS, "AWS_SECRET_ACCESS_KEY", "Job 42 a échoué"];

  it("rejects a secret smuggled into proof.gaps", () => {
    for (const secret of SECRET_CODES) {
      const proof = cloneProofV1();
      proof.gaps = [secret];
      expect(validateFeatureProof(proof)).toBeUndefined();
      expect(sanitizeFeatureProvenance({ code_zone: "H-12", proof })).toEqual({ code_zone: "H-12" });
    }
  });

  it("rejects a secret smuggled into reason_codes (lot evidence AND geometry provenance)", () => {
    for (const secret of SECRET_CODES) {
      const onEvidence = cloneProvenanceV1();
      (onEvidence.lot_assignment_evidence as Record<string, unknown>).reason_codes = [secret];
      expect(validateZoneLotProvenance(onEvidence)).toBeUndefined();

      const onGeometry = cloneProvenanceV1();
      (onGeometry.zone_geometry_provenance as Record<string, unknown>).reason_codes = [secret];
      expect(validateZoneLotProvenance(onGeometry)).toBeUndefined();
    }
  });

  it("rejects a secret smuggled into unmet_requirement_codes", () => {
    for (const secret of SECRET_CODES) {
      const provenance = cloneProvenanceV1();
      (provenance.acquisition_v2_readiness as Record<string, unknown>).unmet_requirement_codes = [secret];
      expect(validateZoneLotProvenance(provenance)).toBeUndefined();
    }
  });

  it("rejects a secret smuggled into feature_ref, evidence_id, collection, zone code or snapshot", () => {
    const cases: Array<[string, (p: Record<string, unknown>, v: string) => void]> = [
      ["feature_ref", (p, v) => { ((p.lot_assignment_evidence as Record<string, unknown>).selected_zone as Record<string, unknown>).feature_ref = v; }],
      ["zgp.feature_ref", (p, v) => { ((p.zone_geometry_provenance as Record<string, unknown>).zone as Record<string, unknown>).feature_ref = v; }],
      ["evidence_id", (p, v) => { (p.lot_assignment_evidence as Record<string, unknown>).evidence_id = v; }],
      ["zgp.evidence_id", (p, v) => { (p.zone_geometry_provenance as Record<string, unknown>).evidence_id = v; }],
      ["collection", (p, v) => { ((p.lot_assignment_evidence as Record<string, unknown>).selected_zone as Record<string, unknown>).collection = v; }],
      ["code", (p, v) => { ((p.lot_assignment_evidence as Record<string, unknown>).selected_zone as Record<string, unknown>).code = v; }],
      ["zone_codes", (p, v) => { (p.lot_assignment_evidence as Record<string, unknown>).zone_codes = [v]; }],
      ["evidence_snapshot", (p, v) => { (p.lot_assignment_evidence as Record<string, unknown>).evidence_snapshot = v; }],
    ];
    for (const [, inject] of cases) {
      for (const secret of SECRETS) {
        const provenance = cloneProvenanceV1();
        inject(provenance, secret);
        expect(validateZoneLotProvenance(provenance)).toBeUndefined();
      }
    }
  });

  it("rejects a non-ISO date and a malformed sha256 (no free-form string left)", () => {
    for (const badDate of ["hier", "2026-06-21 09:00 (job 42)", "s3://bucket/2026-06-21", "2026-13-45T00:00:00Z"]) {
      const onAssessed = cloneProvenanceV1();
      onAssessed.assessed_at = badDate;
      expect(validateZoneLotProvenance(onAssessed)).toBeUndefined();

      const onRetrieved = cloneProvenanceV1();
      ((onRetrieved.zone_geometry_provenance as Record<string, unknown>).public_source as Record<string, unknown>).retrieved_at = badDate;
      expect(validateZoneLotProvenance(onRetrieved)).toBeUndefined();

      const onVerified = cloneProvenanceV1();
      (onVerified.zone_geometry_provenance as Record<string, unknown>).verified_at = badDate;
      expect(validateZoneLotProvenance(onVerified)).toBeUndefined();
    }

    const badSha = cloneProvenanceV1();
    ((badSha.zone_geometry_provenance as Record<string, unknown>).public_source as Record<string, unknown>).sha256 = "sha256:not-a-hash";
    expect(validateZoneLotProvenance(badSha)).toBeUndefined();
  });

  it("keeps the real audit codes served by geo (no over-blocking)", () => {
    const provenance = cloneProvenanceV1();
    (provenance.zone_geometry_provenance as Record<string, unknown>).reason_codes = [
      "source-identity-unlinked",
      "needs-human-confirmation",
      "historical-verification-unavailable",
      "regulation_source_unavailable",
    ];
    expect(validateZoneLotProvenance(provenance)).toEqual(provenance);
  });
});

// ─── Contre-tests « ready » honnête (contrat §5) ─────────────────────────────

describe("acquisition_v2_readiness: `ready` requires its four real prerequisites", () => {
  it("rejects a `ready` that only shows an empty unmet list (no source, no date, no hash)", () => {
    const bare = cloneProvenanceV1();
    (bare.zone_geometry_provenance as Record<string, unknown>).status = "legacy-traceable";
    (bare.zone_geometry_provenance as Record<string, unknown>).verified_at = null;
    (bare.zone_geometry_provenance as Record<string, unknown>).reason_codes = ["historical-verification-unavailable"];
    (bare.acquisition_v2_readiness as Record<string, unknown>).state = "ready";
    (bare.acquisition_v2_readiness as Record<string, unknown>).unmet_requirement_codes = [];
    // public_source.sha256 est null dans le fixture → prérequis (4) absent.
    expect(validateZoneLotProvenance(bare)).toBeUndefined();
  });

  it("rejects a `ready` missing each prerequisite taken one at a time", () => {
    const breakers: Array<(p: Record<string, unknown>) => void> = [
      // (1) identité de zone
      (p) => { (p.zone_geometry_provenance as Record<string, unknown>).zone = null; },
      // (2) source publique canonique
      (p) => { (p.zone_geometry_provenance as Record<string, unknown>).public_source = null; },
      // (3) instant d'acquisition
      (p) => { ((p.zone_geometry_provenance as Record<string, unknown>).public_source as Record<string, unknown>).retrieved_at = null; },
      // (4) hash de contenu
      (p) => { ((p.zone_geometry_provenance as Record<string, unknown>).public_source as Record<string, unknown>).sha256 = null; },
      // axe géométrie entièrement absent
      (p) => { p.zone_geometry_provenance = null; },
      // contrôle explicite absent
      (p) => { (p.acquisition_v2_readiness as Record<string, unknown>).checked_at = null; },
    ];
    for (const breaker of breakers) {
      const provenance = readyProvenance();
      breaker(provenance);
      expect(validateZoneLotProvenance(provenance)).toBeUndefined();
    }
  });

  it("keeps `not-ready` / `not-assessed` untouched, prerequisites or not (non-blackout)", () => {
    const notReady = cloneProvenanceV1();
    expect(validateZoneLotProvenance(notReady)).toEqual(notReady);

    const notAssessed = cloneProvenanceV1();
    (notAssessed.acquisition_v2_readiness as Record<string, unknown>).state = "not-assessed";
    (notAssessed.acquisition_v2_readiness as Record<string, unknown>).checked_at = null;
    (notAssessed.acquisition_v2_readiness as Record<string, unknown>).unmet_requirement_codes = ["not-assessed"];
    expect(validateZoneLotProvenance(notAssessed)).toEqual(notAssessed);
  });

  it("refuses a `ready` whose public source is private, even with every other prerequisite", () => {
    const provenance = readyProvenance();
    ((provenance.zone_geometry_provenance as Record<string, unknown>).public_source as Record<string, unknown>).url =
      "http://[fd00::1]/zonage.geojson";
    expect(validateZoneLotProvenance(provenance)).toBeUndefined();
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
