import { describe, it, expect } from "vitest";
import {
  EXTRACTED_DOC_SCHEMA_VERSION,
  safeParseExtractedDocV1,
  SIGNAL_PAYLOAD_SCHEMA_VERSION,
  safeParseSignalPayloadV1,
  OPPORTUNITY_FICHE_SCHEMA_VERSION,
  safeParseOpportunityFicheV1,
} from "../src/schemas/index.js";

describe("extracted-doc.v1", () => {
  it("accepts a minimal valid payload and applies defaults", () => {
    const r = safeParseExtractedDocV1({
      schemaVersion: EXTRACTED_DOC_SCHEMA_VERSION,
      summary: "Règlement 2024-58 augmente la densité de la zone H-113.",
      confidence: 0.8,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.regulationRefs).toEqual([]);
      expect(r.data.zoningMentions).toEqual([]);
      expect(r.data.dates).toEqual({});
    }
  });

  it("rejects a confidence out of range", () => {
    const r = safeParseExtractedDocV1({
      schemaVersion: EXTRACTED_DOC_SCHEMA_VERSION,
      summary: "x",
      confidence: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    const r = safeParseExtractedDocV1({
      schemaVersion: "extracted-doc.v2",
      summary: "x",
      confidence: 0.5,
    });
    expect(r.success).toBe(false);
  });
});

describe("signal-payload.v1", () => {
  it("requires at least one evidence", () => {
    const r = safeParseSignalPayloadV1({
      schemaVersion: SIGNAL_PAYLOAD_SCHEMA_VERSION,
      kind: "zoning-change",
      summary: "Changement de zonage détecté",
      evidence: [],
      confidence: 0.9,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid zoning-change signal", () => {
    const r = safeParseSignalPayloadV1({
      schemaVersion: SIGNAL_PAYLOAD_SCHEMA_VERSION,
      kind: "zoning-change",
      summary: "Densité augmentée zone H-113",
      evidence: [
        {
          s3Key: "raw/avis-publics/salaberry/2024/05/18/abc.pdf",
          page: 3,
          excerpt: "la densité maximale passe de 2 à 4 logements",
          confidence: 0.85,
          capturedAt: "2026-05-24T10:00:00.000Z",
        },
      ],
      confidence: 0.85,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown signal kind", () => {
    const r = safeParseSignalPayloadV1({
      schemaVersion: SIGNAL_PAYLOAD_SCHEMA_VERSION,
      kind: "nonsense",
      summary: "x",
      evidence: [
        {
          s3Key: "k",
          excerpt: "e",
          confidence: 0.5,
          capturedAt: "2026-05-24T10:00:00.000Z",
        },
      ],
      confidence: 0.5,
    });
    expect(r.success).toBe(false);
  });
});

describe("opportunity-fiche.v1", () => {
  it("accepts a minimal valid fiche", () => {
    const r = safeParseOpportunityFicheV1({
      schemaVersion: OPPORTUNITY_FICHE_SCHEMA_VERSION,
      identity: { municipality: "Salaberry-de-Valleyfield" },
      signal: { source: "avis-publics", confidence: 0.7 },
      potential: {},
      constraints: {},
      market: {},
      action: { decision: "watch" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.constraints.cptaq).toBe(false);
      expect(r.data.action.expertRequired).toBe(false);
    }
  });

  it("rejects an invalid decision", () => {
    const r = safeParseOpportunityFicheV1({
      schemaVersion: OPPORTUNITY_FICHE_SCHEMA_VERSION,
      identity: { municipality: "X" },
      signal: { source: "s", confidence: 0.5 },
      potential: {},
      constraints: {},
      market: {},
      action: { decision: "buy_now" },
    });
    expect(r.success).toBe(false);
  });
});
