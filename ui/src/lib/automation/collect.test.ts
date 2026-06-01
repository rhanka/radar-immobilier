import { describe, expect, it } from "vitest";
import {
  avisTypeLabel,
  collectErrorLabel,
  mapCollectPayload,
  resolveCollectUrl,
  type CollectFailure,
  type CollectSuccess,
} from "./collect";

describe("resolveCollectUrl", () => {
  it("builds a same-origin path when no base URL is configured", () => {
    expect(resolveCollectUrl("avis-publics-valleyfield", "")).toBe(
      "/api/automation/collect/avis-publics-valleyfield",
    );
  });

  it("prefixes the configured base URL without double slashes", () => {
    expect(resolveCollectUrl("avis-publics-valleyfield", "http://localhost:8801/")).toBe(
      "http://localhost:8801/api/automation/collect/avis-publics-valleyfield",
    );
  });
});

describe("mapCollectPayload", () => {
  it("maps a success payload to a success view", () => {
    const payload: CollectSuccess = {
      ok: true,
      source: "avis-publics-valleyfield",
      sourceUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
      fetchedAt: "2026-06-01T12:00:00.000Z",
      count: 1,
      items: [
        {
          title: "Dérogations mineures du 20 mai 2026",
          dateLabel: "20 mai 2026",
          dateIso: "2026-05-20",
          url: "https://example.com/a.pdf",
          type: "derogation-mineure",
          bylaws: [],
        },
      ],
    };
    expect(mapCollectPayload(payload)).toEqual({ kind: "success", result: payload });
  });

  it("maps a failure payload to a localized error view", () => {
    const payload: CollectFailure = {
      ok: false,
      error: "network",
      detail: "ENOTFOUND",
    };
    expect(mapCollectPayload(payload)).toEqual({
      kind: "error",
      label: "Source injoignable (réseau)",
      detail: "ENOTFOUND",
    });
  });
});

describe("labels", () => {
  it("localizes notice types", () => {
    expect(avisTypeLabel("ppcmoi")).toBe("PPCMOI");
    expect(avisTypeLabel("unknown-kind")).toBe("unknown-kind");
  });

  it("localizes error codes", () => {
    expect(collectErrorLabel("timeout")).toBe("Source injoignable (délai dépassé)");
    expect(collectErrorLabel("whatever")).toBe("Échec de la collecte");
  });
});
