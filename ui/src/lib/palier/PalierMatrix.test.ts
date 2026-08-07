import { afterEach, describe, expect, it } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import PalierMatrix from "./PalierMatrix.svelte";
import {
  PALIER_KPIS_20,
  type PalierCityRow,
  type PalierMatrix as PalierMatrixType,
  type RecencyBand,
} from "./palier-matrix-client.js";

afterEach(() => cleanup());

function row(
  slug: string,
  name: string,
  recency: RecencyBand,
  isPriority: boolean,
): PalierCityRow {
  return {
    citySlug: slug,
    cityName: name,
    recency,
    isPriority,
    cells: PALIER_KPIS_20.map((kpi) => ({
      kpiId: kpi.id,
      status: kpi.id === "kpi04" ? "complete" : "unknown",
      source: kpi.id === "kpi04" ? "réf. hors-ligne" : null,
    })),
  };
}

function cannedMatrix(): PalierMatrixType {
  return {
    contract: "palier-matrix/v1",
    subset: "B",
    label: "dénominateur B live · KPI immo réf. hors-ligne",
    kpis: PALIER_KPIS_20,
    cities: [
      row("westmount", "Westmount", "lt3mo", true),
      row("beloeil", "Beloeil", "lt6mo", false),
      row("vieille-ville", "Vieille-Ville", "older", false),
    ],
    denominator: 3,
    recencyCounts: { lt3mo: 1, lt6mo: 2, all: 3 },
    priorityCount: 1,
    generatedAtIso: "2026-08-07T00:00:00.000Z",
  };
}

describe("PalierMatrix — vue matrice live", () => {
  it("rend le dénominateur B LIVE + comptes de récence (pas de hardcode)", async () => {
    const { findByTestId, getByTestId } = render(PalierMatrix, {
      props: { matrixLoader: async () => cannedMatrix() },
    });
    expect((await findByTestId("palier-denominator")).textContent).toContain("3");
    expect(getByTestId("palier-recency-lt3mo").textContent).toContain("1");
    expect(getByTestId("palier-recency-lt6mo").textContent).toContain("2");
    expect(getByTestId("palier-priority-count").textContent).toContain("1");
  });

  it("priorité en TÊTE + copy de statut NEUTRE (aucun jargon 'unknown')", async () => {
    const { findByTestId } = render(PalierMatrix, {
      props: { matrixLoader: async () => cannedMatrix() },
    });
    const grid = await findByTestId("palier-grid");
    // Première ligne de données = la ville priorité (westmount).
    const firstRow = grid.querySelector("tbody tr");
    expect(firstRow?.getAttribute("data-testid")).toBe("palier-row-westmount");
    const txt = grid.textContent ?? "";
    expect(txt).toContain("Complet");
    expect(txt).toContain("À qualifier");
    expect(txt.toLowerCase()).not.toContain("unknown");
  });

  it("toggle récence : « < 3 mois » ne montre que la cohorte lt3mo", async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(PalierMatrix, {
      props: { matrixLoader: async () => cannedMatrix() },
    });
    await findByTestId("palier-grid");
    // Défaut « Toutes » : les 3 villes visibles.
    expect(getByTestId("palier-row-westmount")).toBeTruthy();
    expect(getByTestId("palier-row-beloeil")).toBeTruthy();
    expect(getByTestId("palier-row-vieille-ville")).toBeTruthy();

    await fireEvent.click(getByTestId("palier-recency-btn-lt3mo"));
    // Seule westmount (lt3mo) reste.
    expect(getByTestId("palier-row-westmount")).toBeTruthy();
    expect(queryByTestId("palier-row-beloeil")).toBeNull();
    expect(queryByTestId("palier-row-vieille-ville")).toBeNull();

    await fireEvent.click(getByTestId("palier-recency-btn-lt6mo"));
    // < 6 mois cumulatif : westmount + beloeil, pas la vieille ville.
    expect(getByTestId("palier-row-westmount")).toBeTruthy();
    expect(getByTestId("palier-row-beloeil")).toBeTruthy();
    expect(queryByTestId("palier-row-vieille-ville")).toBeNull();
  });

  it("état d'erreur : couverture live indisponible → message + réessayer", async () => {
    const { findByTestId } = render(PalierMatrix, {
      props: {
        matrixLoader: async () => {
          throw new Error("401");
        },
      },
    });
    const err = await findByTestId("palier-error");
    expect(err.textContent).toContain("indisponible");
    expect(err.querySelector("button")).toBeTruthy();
  });
});
