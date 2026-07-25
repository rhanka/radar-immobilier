/**
 * m1.7 / m1.4 — the Vivier B checkboxes must REALLY filter the displayed list.
 *
 * Drives the real SignauxRail UI through a harness that mirrors the parent's
 * B pipeline (projection of the live key, then display exclusions). Asserts the
 * visible signal COUNT moves when the user toggles a box — the behaviour the
 * conductor reported as inert.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import Harness from "./SignauxRailFilterHarness.svelte";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import type { VivierV2Counts } from "@radar/domain";

afterEach(() => cleanup());

type TriState = "oui" | "non" | "indetermine";

function node(
  id: string,
  instrument: string,
  opts: { residentiel?: TriState; props?: Record<string, unknown> } = {},
): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "austin",
    sourceRef: null,
    createdAt: null,
    props: { properties: opts.props ?? {} },
    classification: {
      zonage: { valeur: "oui", source: "t", confiance: 0.9 },
      residentiel: { valeur: opts.residentiel ?? "oui", source: "t", confiance: 0.9 },
      effet_densifiant: "inconnu",
      instrument,
      etape: "avis_motion",
      etapes_historique: ["avis_motion"],
      exclusion_reason: null,
      provenance: { extrait: "" },
      confiance: 0.9,
    } as unknown as GraphSignalNode["classification"],
  };
}

function exclusionBoxes(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(".vivier-b-exclusions input[type=checkbox]"),
  );
}
function axisBoxes(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(".vivier-toggles input[type=checkbox]"),
  );
}

describe("Vivier B filter pipeline — rail toggles change the visible count", () => {
  it("keeps old and undated signals when the other B filters admit them", () => {
    const detailNodes = [
      node("old", "rezonage", { props: { etape_date: "2020-01-01" } }),
      node("recent", "rezonage", { props: { etape_date: "2026-07-20" } }),
      node("undated", "rezonage"),
    ];
    const { getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });

    expect(getByTestId("visible-count").textContent).toBe("3");
  });

  it("m1.7 — unchecking each exclusion re-reveals the hidden signals", async () => {
    const detailNodes = [
      node("rezonage-qualifie", "rezonage"),
      node("piia-sans-projet", "piia"), // masqué par défaut (exclusion PIIA)
      node("derogation-mineure", "derogation"), // masqué par défaut (exclusion dérogations)
    ];
    const { container, getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });
    // Défaut B : les deux exclusions actives → seul le rezonage reste visible.
    expect(getByTestId("visible-count").textContent).toBe("1");

    const boxes = exclusionBoxes(container);
    expect(boxes).toHaveLength(2);
    // Décocher « Exclure PIIA sans projet résidentiel » → le PIIA réapparaît.
    await fireEvent.click(boxes[0]!);
    expect(getByTestId("visible-count").textContent).toBe("2");
    // Décocher « Exclure dérogations mineures » → la dérogation réapparaît.
    await fireEvent.click(boxes[1]!);
    expect(getByTestId("visible-count").textContent).toBe("3");
  });

  it("m1.4 — r axis filters indéterminé when checked and reveals it when unchecked", async () => {
    const detailNodes = [
      node("qualifie", "rezonage", { residentiel: "oui" }),
      node("a-confirmer", "rezonage", { residentiel: "indetermine" }),
    ];
    const { container, getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });
    // Default (r=true): only residential=oui shown.
    expect(getByTestId("visible-count").textContent).toBe("1");
    // Uncheck r: indéterminé reappears.
    await fireEvent.click(axisBoxes(container)[1]!);
    expect(getByTestId("visible-count").textContent).toBe("2");
  });
});

/** Comptes v2 bulk serveur : total = qualified + residentialUnknown + Σ exclusions. */
function bulkVivierCounts(qualified: number): VivierV2Counts {
  return {
    qualified,
    residentialUnknown: 0,
    excludedByReason: {
      non_residentiel_franc: 0,
      piia_non_pertinent: 0,
      hors_zonage: 0,
      derogation_hors_sujet: 0,
    },
    stageCounts: {
      avis_motion: qualified,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    stageCountsHorsZonage: {
      avis_motion: 0,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    stageCountsResOui: {
      avis_motion: qualified,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    stageCountsResOuiHorsZonage: {
      avis_motion: 0,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    total: qualified,
  };
}

function westmountEntry(qualifiedBulk: number): CityMapEntry {
  return {
    municipality: {
      slug: "westmount",
      name: "Westmount",
      mrc: "Montréal",
    } as CityMapEntry["municipality"],
    signalCount6m: qualifiedBulk,
    subsetCounts: {},
    vivierV2Counts: bulkVivierCounts(qualifiedBulk),
  };
}

describe("m1.7 — the rail BADGE of the SELECTED city must track the visible list, not the stale bulk count", () => {
  it("badge starts at the exclusion-filtered count and rises as exclusions are unchecked, never the static bulk", async () => {
    // Bulk serveur (vivierV2Counts.qualified) = 3 : les 3 nœuds SONT qualifiés
    // côté serveur (zonage oui ∩ résidentiel oui ∩ pas d'exclusion serveur).
    // C'est la lentille d'AFFICHAGE cliente (exclusions PIIA/dérogation) qui,
    // par défaut, n'en montre qu'1 — exactement le cas Westmount « 5 » du bug.
    const detailNodes = [
      node("rezonage-qualifie", "rezonage"),
      node("piia-sans-projet", "piia"), // masqué par défaut (exclusion PIIA)
      node("derogation-mineure", "derogation"), // masqué par défaut (exclusion dérogations)
    ];
    const { container, getByTestId } = render(Harness, {
      props: {
        entries: [westmountEntry(3)],
        detailNodes,
        initialSubsetKey: "vivier-v2",
        selectedSlug: "westmount",
      },
    });

    function badgeText(): string {
      const row = Array.from(container.querySelectorAll("button.rail-city-row")).find((r) =>
        r.textContent?.includes("Westmount"),
      );
      expect(row).toBeDefined();
      const badge = (row as HTMLElement).querySelector(".st-badge");
      expect(badge).not.toBeNull();
      return badge!.textContent?.trim() ?? "";
    }

    // Défaut : 2 exclusions actives → seul le rezonage est visible (1), PAS le
    // bulk serveur (3) affiché seul. Le badge HONNÊTE montre « affiché/bulk »
    // (1/3) : ni « 3 » figé, ni « 1 » inexpliqué.
    expect(getByTestId("visible-count").textContent).toBe("1");
    expect(badgeText()).toBe("1/3");

    const boxes = exclusionBoxes(container);
    // Décocher « Exclure PIIA sans projet résidentiel » → 2/3, le badge SUIT.
    await fireEvent.click(boxes[0]!);
    expect(getByTestId("visible-count").textContent).toBe("2");
    expect(badgeText()).toBe("2/3");

    // Décocher « Exclure dérogations mineures » → 3, badge = bulk (convergence
    // attendue : sans exclusion, le vivier v2 qualifié EST les 3 nœuds — plus
    // de dénominateur quand rien n'est masqué).
    await fireEvent.click(boxes[1]!);
    expect(getByTestId("visible-count").textContent).toBe("3");
    expect(badgeText()).toBe("3");
  });
});
