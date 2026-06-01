import { describe, expect, it } from "vitest";
import {
  collectAvisPublicsValleyfield,
  extractBylaws,
  frenchDateToIso,
  inferAvisType,
  NON_DISPONIBLE,
  parseAvisPublics,
  type FetchLike,
} from "./avis-publics-valleyfield.js";
import { AVIS_PUBLICS_FIXTURE_HTML } from "./avis-publics-valleyfield.fixture.js";

describe("frenchDateToIso", () => {
  it("parses a French date label to ISO", () => {
    expect(frenchDateToIso("20 mai 2026")).toBe("2026-05-20");
    expect(frenchDateToIso("22 avril 2026")).toBe("2026-04-22");
    expect(frenchDateToIso("1 février 2025")).toBe("2025-02-01");
  });

  it("returns non-disponible for unparseable labels", () => {
    expect(frenchDateToIso("bientôt")).toBe(NON_DISPONIBLE);
    expect(frenchDateToIso("20 foo 2026")).toBe(NON_DISPONIBLE);
  });
});

describe("inferAvisType", () => {
  it("classifies common Québec municipal notice kinds", () => {
    expect(inferAvisType("Dérogations mineures du 20 mai 2026")).toBe("derogation-mineure");
    expect(inferAvisType("demande PPCMOI2026-0066")).toBe("ppcmoi");
    expect(inferAvisType("scrutin référendaire pour le Règlement 150-49-1")).toBe(
      "registre-referendaire",
    );
    expect(inferAvisType("entrée en vigueur des règlements 209-47")).toBe("entree-en-vigueur");
  });
});

describe("extractBylaws", () => {
  it("extracts bylaw references", () => {
    expect(extractBylaws("des règlements 209-47 et 216-34")).toEqual(["209-47", "216-34"]);
    expect(extractBylaws("Dérogations mineures du 20 mai 2026")).toEqual([]);
  });
});

describe("parseAvisPublics (recorded real fixture)", () => {
  const items = parseAvisPublics(AVIS_PUBLICS_FIXTURE_HTML);

  it("parses every notice anchor", () => {
    expect(items).toHaveLength(4);
  });

  it("extracts verbatim title, date, and absolute PDF url", () => {
    const first = items[0];
    expect(first?.title).toBe("Dérogations mineures du 20 mai 2026");
    expect(first?.dateLabel).toBe("20 mai 2026");
    expect(first?.dateIso).toBe("2026-05-20");
    expect(first?.url).toBe(
      "https://dua3m7xvptjbw.cloudfront.net/documents/avis/2026-05-20-Avis-de-derogation-mineure.pdf",
    );
    expect(first?.type).toBe("derogation-mineure");
  });

  it("decodes HTML entities in titles", () => {
    const eev = items.find((i) => i.type === "entree-en-vigueur");
    expect(eev?.title).toBe("Avis public d'entrée en vigueur des règlements 209-47 et 216-34");
    expect(eev?.bylaws).toEqual(["209-47", "216-34"]);
  });

  it("classifies the referendum register notice and its bylaw", () => {
    const reg = items.find((i) => i.type === "registre-referendaire");
    expect(reg?.bylaws).toContain("150-49");
  });
});

describe("collectAvisPublicsValleyfield (typed failure handling)", () => {
  it("returns a success outcome with parsed items on a 200 response", async () => {
    const fakeFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => AVIS_PUBLICS_FIXTURE_HTML,
    });
    const out = await collectAvisPublicsValleyfield({ fetchImpl: fakeFetch });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.count).toBe(4);
      expect(out.source).toBe("avis-publics-valleyfield");
      expect(out.items[0]?.title).toBe("Dérogations mineures du 20 mai 2026");
    }
  });

  it("returns a typed http error (never throws) on a non-200 response", async () => {
    const fakeFetch: FetchLike = async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    });
    const out = await collectAvisPublicsValleyfield({ fetchImpl: fakeFetch });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("http");
      expect(out.detail).toContain("503");
    }
  });

  it("returns a typed network error when fetch rejects", async () => {
    const fakeFetch: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const out = await collectAvisPublicsValleyfield({ fetchImpl: fakeFetch });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("network");
    }
  });

  it("respects the limit option", async () => {
    const fakeFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => AVIS_PUBLICS_FIXTURE_HTML,
    });
    const out = await collectAvisPublicsValleyfield({ fetchImpl: fakeFetch, limit: 2 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.count).toBe(2);
  });
});
