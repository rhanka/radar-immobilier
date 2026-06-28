import { describe, expect, it } from "vitest";
import {
  activeMarketMark,
  activePipelineMark,
  computeProspectCounters,
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
