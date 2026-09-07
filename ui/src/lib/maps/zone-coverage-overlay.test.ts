import { describe, it, expect } from "vitest";
import {
  ZONE_COVERAGE_LAYER_ENABLED,
  zoneCoverageState,
  zoneCoverageLegend,
} from "./zone-coverage-overlay.js";

/** Preuve `immo-feature-proof` v1 conforme (telle que geo la sert). */
const validProof = {
  schema_version: "1.0",
  status: "partial",
  sources: {
    geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
    regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
  },
  zone: null,
  gaps: [],
};

/** Preuve qui FUIT (artefact S3) — écartée en bloc par geo-provenance. */
const leakyProof = {
  ...validProof,
  sources: {
    geometry: { status: "available", artifact_uri: "s3://radar-immobilier-raw/x.geojson", upstream_uri: null },
    regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
  },
};

describe("zone-coverage-overlay — squelette couverture de preuve", () => {
  it("drapeau OFF par défaut : zéro changement visuel en production", () => {
    expect(ZONE_COVERAGE_LAYER_ENABLED).toBe(false);
  });

  it("zone avec preuve valide → « covered »", () => {
    expect(zoneCoverageState({ proof: validProof })).toBe("covered");
  });

  it("zone sans preuve → « uncovered » (aucune sonde ; absent = Non couvert)", () => {
    expect(zoneCoverageState({ zone_code: "H-431" })).toBe("uncovered");
    expect(zoneCoverageState(null)).toBe("uncovered");
    expect(zoneCoverageState(undefined)).toBe("uncovered");
  });

  it("preuve invalide (fuite S3) écartée par geo-provenance → « uncovered »", () => {
    expect(zoneCoverageState({ proof: leakyProof })).toBe("uncovered");
  });

  it("légende : copy produit NEUTRE (Servi / Non couvert), aucun jargon interne", () => {
    const legend = zoneCoverageLegend();
    expect(legend.title).toBe("Couverture de preuve");
    const labels = legend.items.map((i) => i.label);
    expect(labels).toContain("Servi");
    expect(labels).toContain("Non couvert");
    expect(JSON.stringify(legend)).not.toMatch(/honnête|bucket/i);
  });
});
