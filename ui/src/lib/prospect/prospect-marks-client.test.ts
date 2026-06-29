import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeMarketMark,
  activePipelineMark,
  computeProspectCounters,
  createProspectMark,
  createProspectNote,
  prospectStatusLabel,
  type ProspectMark,
} from "./prospect-marks-client.js";

function mark(input: Partial<ProspectMark> & Pick<ProspectMark, "noLot" | "citySlug" | "dimension" | "statut" | "createdAt">): ProspectMark {
  return {
    id: input.id ?? `${input.noLot}-${input.statut}`,
    lotVersionId: input.lotVersionId ?? null,
    noLot: input.noLot,
    citySlug: input.citySlug,
    dimension: input.dimension,
    statut: input.statut,
    mode: input.mode ?? "real",
    authorId: input.authorId ?? null,
    supersedes: input.supersedes ?? null,
    createdAt: input.createdAt,
  };
}

describe("prospect marks client helpers — CS-L3", () => {
  it("expose les libellés des 5 marques Steve", () => {
    expect(prospectStatusLabel("favori")).toBe("Favori");
    expect(prospectStatusLabel("ecarte")).toBe("Non retenu");
    expect(prospectStatusLabel("sollicite")).toBe("Sollicité");
    expect(prospectStatusLabel("lettre_envoyee")).toBe("Lettre envoyée");
    expect(prospectStatusLabel("en_vente")).toBe("En vente");
  });

  it("retient le dernier marquage actif par dimension", () => {
    const marks = [
      mark({ noLot: "1", citySlug: "delson", dimension: "pipeline", statut: "favori", createdAt: "2026-01-01T00:00:00Z" }),
      mark({ noLot: "1", citySlug: "delson", dimension: "pipeline", statut: "sollicite", createdAt: "2026-01-02T00:00:00Z" }),
      mark({ noLot: "1", citySlug: "delson", dimension: "marche", statut: "en_vente", createdAt: "2026-01-01T12:00:00Z" }),
    ];

    expect(activePipelineMark(marks)?.statut).toBe("sollicite");
    expect(activeMarketMark(marks)?.statut).toBe("en_vente");
  });

  it("calcule les compteurs par marque sans compter les PII", () => {
    const lots = [
      { noLot: "1", citySlug: "delson" },
      { noLot: "2", citySlug: "delson" },
      { noLot: "3", citySlug: "delson" },
    ];
    const marks = [
      mark({ noLot: "1", citySlug: "delson", dimension: "pipeline", statut: "favori", createdAt: "2026-01-01T00:00:00Z" }),
      mark({ noLot: "2", citySlug: "delson", dimension: "pipeline", statut: "lettre_envoyee", createdAt: "2026-01-01T00:00:00Z" }),
      mark({ noLot: "2", citySlug: "delson", dimension: "marche", statut: "en_vente", createdAt: "2026-01-01T00:00:00Z" }),
    ];

    expect(computeProspectCounters(lots, marks)).toEqual({
      all: 3,
      favori: 1,
      ecarte: 0,
      sollicite: 0,
      lettre_envoyee: 1,
      en_vente: 1,
      unmarked: 1,
    });
  });
});

describe("prospect marks client — écriture (POST)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOnce(status: number, payload: unknown): ReturnType<typeof vi.fn> {
    const f = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", f);
    return f;
  }

  it("createProspectMark POST le payload liste-blanche (pipeline) et retourne le mark", async () => {
    const created: ProspectMark = {
      id: "m1", lotVersionId: "lv-1", noLot: "42", citySlug: "delson",
      dimension: "pipeline", statut: "favori", mode: "real", createdAt: "2026-06-29T00:00:00Z",
    };
    const f = mockFetchOnce(201, { ok: true, mark: created });
    const res = await createProspectMark({ lotVersionId: "lv-1", noLot: "42", citySlug: "delson", dimension: "pipeline", statut: "favori" });
    expect(res).toEqual(created);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("/api/v1/prospects/marks");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ lotVersionId: "lv-1", noLot: "42", citySlug: "delson", dimension: "pipeline", statut: "favori", mode: "real" });
    // anti-PII : aucune propriété étrangère
    expect(Object.keys(body).sort()).toEqual(["citySlug", "dimension", "lotVersionId", "mode", "noLot", "statut"]);
  });

  it("createProspectMark (marché) inclut prixDemande/lienAnnonce", async () => {
    const f = mockFetchOnce(201, { ok: true, mark: { id: "m2", noLot: "7", citySlug: "candiac", dimension: "marche", statut: "en_vente", mode: "real", createdAt: "2026-06-29T00:00:00Z" } });
    await createProspectMark({ noLot: "7", citySlug: "candiac", dimension: "marche", statut: "en_vente", prixDemande: 450000, lienAnnonce: "https://x" });
    const body = JSON.parse(f.mock.calls[0][1].body as string);
    expect(body.prixDemande).toBe(450000);
    expect(body.lienAnnonce).toBe("https://x");
  });

  it("createProspectNote POST la note et retourne la note", async () => {
    const note = { id: "n1", noLot: "42", citySlug: "delson", body: "à rappeler", mode: "real" as const, createdAt: "2026-06-29T00:00:00Z" };
    const f = mockFetchOnce(201, { ok: true, note });
    const res = await createProspectNote({ noLot: "42", citySlug: "delson", body: "à rappeler" });
    expect(res).toEqual(note);
    expect(String(f.mock.calls[0][0])).toContain("/api/v1/prospects/notes");
  });

  it("lève quand l'API renvoie une erreur HTTP", async () => {
    mockFetchOnce(400, { error: "Invalid request" });
    await expect(createProspectMark({ noLot: "1", citySlug: "delson", dimension: "pipeline", statut: "favori" })).rejects.toThrow();
  });
});
