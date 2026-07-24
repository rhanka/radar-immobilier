import { describe, expect, it } from "vitest";
import {
  publicProvenanceFromEvidence,
  publicProvenanceFromProperties,
  sanitizeFeatureProvenance,
} from "./provenance.js";

const proofV1 = {
  schema_version: "1.0",
  status: "complete",
  sources: {
    geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
    regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
  },
  zone: null,
  gaps: ["regulation_source_unavailable"],
};

const provenanceV1 = {
  contract: "immo-zone-lot-provenance/v1",
  zone_geometry_provenance: {
    status: "historical-verified",
    public_source: { url: "https://ville.example/zonage.geojson" },
  },
};

describe("publicProvenanceFromProperties", () => {
  it("keeps safe v1 and v2 envelopes verbatim", () => {
    const proofV2 = {
      schema_version: "2.0",
      geometry_source: { url: "https://ville.example/zonage.geojson", sha256: "sha256:abc" },
    };
    expect(publicProvenanceFromProperties({ proof: proofV1, immo_zone_lot_provenance: provenanceV1 }))
      .toEqual({ proof: proofV1, immo_zone_lot_provenance: provenanceV1 });
    expect(publicProvenanceFromProperties({ proof: proofV2 })).toEqual({ proof: proofV2 });
  });

  it("never exposes storage, local, or signed references", () => {
    for (const proof of [
      { ...proofV1, sources: { ...proofV1.sources, geometry: { ...proofV1.sources.geometry, artifact_uri: "s3://private/a" } } },
      { ...proofV1, sources: { ...proofV1.sources, geometry: { ...proofV1.sources.geometry, artifact_uri: "/tmp/a" } } },
      { ...proofV1, sources: { ...proofV1.sources, geometry: { ...proofV1.sources.geometry, artifact_uri: "https://geo.example/a?X-Amz-Signature=x" } } },
    ]) {
      const sanitized = sanitizeFeatureProvenance({ code_zone: "H-12", proof });
      expect(sanitized).toEqual({ code_zone: "H-12" });
    }
  });

  it("recovers a stored safe envelope without changing it", () => {
    expect(publicProvenanceFromEvidence([{ source: "ogc-api", proof: proofV1 }]))
      .toEqual({ proof: proofV1 });
  });
});
