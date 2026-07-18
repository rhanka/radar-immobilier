/**
 * m2 — the DateRangeFilter must (1) default to 6 months, (2) really reduce the
 * displayed list when narrowed 6 → 3, (3) appear IDENTICALLY in both A and B
 * panels (parity).
 *
 * Drives the real SignauxRail UI through a harness that mirrors the parent's
 * displayed-list pipeline (projection → date lens → B exclusions).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import Harness from "./SignauxRailDateFilterHarness.svelte";
import SignauxRail from "./SignauxRail.svelte";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";

afterEach(() => cleanup());

/** A rezonage node QUALIFIED in B, dated `monthsAgo` months before now. */
function datedNode(id: string, monthsAgo: number): GraphSignalNode {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(15); // mid-month → clear of the exact preset boundary day
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "austin",
    sourceRef: null,
    createdAt: null,
    props: { properties: { etape_date: d.toISOString().slice(0, 10) } },
    classification: {
      zonage: { valeur: "oui", source: "t", confiance: 0.9 },
      residentiel: { valeur: "oui", source: "t", confiance: 0.9 },
      effet_densifiant: "inconnu",
      instrument: "rezonage",
      etape: "avis_motion",
      etapes_historique: ["avis_motion"],
      exclusion_reason: null,
      provenance: { extrait: "" },
      confiance: 0.9,
    } as unknown as GraphSignalNode["classification"],
  };
}

/**
 * Preset buttons of the (single) active-panel DateRangeFilter. Only the presets
 * carry `aria-pressed`; the DatePicker trigger button does not — so this scopes
 * cleanly to the segmented presets.
 */
function presetButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      ".date-range-filter button[aria-pressed]",
    ),
  );
}
function presetByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = presetButtons(container).find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (!btn) throw new Error(`preset "${label}" not found`);
  return btn;
}

describe("m2 — DateRangeFilter reduces the displayed list", () => {
  it("defaults to 6 months (6-months preset pressed) and drops >6-months signals", () => {
    const detailNodes = [
      datedNode("il-y-a-1-mois", 1),
      datedNode("il-y-a-4-mois", 4),
      datedNode("il-y-a-9-mois", 9), // hors 6 mois
    ];
    const { container, getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });
    // Défaut : le preset « 6 mois » est le preset actif (aria-pressed).
    expect(presetByLabel(container, "6 mois").getAttribute("aria-pressed")).toBe("true");
    expect(presetByLabel(container, "3 mois").getAttribute("aria-pressed")).toBe("false");
    expect(presetByLabel(container, "12 mois").getAttribute("aria-pressed")).toBe("false");
    // 6 mois : les signaux à 1 et 4 mois sont visibles, celui à 9 mois est exclu.
    expect(getByTestId("visible-count").textContent).toBe("2");
  });

  it("narrowing 6 → 3 months really reduces the visible count", async () => {
    const detailNodes = [
      datedNode("il-y-a-1-mois", 1),
      datedNode("il-y-a-4-mois", 4), // dans 6 mois, hors 3 mois
      datedNode("il-y-a-9-mois", 9),
    ];
    const { container, getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });
    expect(getByTestId("visible-count").textContent).toBe("2");

    await fireEvent.click(presetByLabel(container, "3 mois"));

    // Le signal à 4 mois tombe → la liste se réduit.
    expect(getByTestId("visible-count").textContent).toBe("1");
    expect(presetByLabel(container, "3 mois").getAttribute("aria-pressed")).toBe("true");
    expect(presetByLabel(container, "6 mois").getAttribute("aria-pressed")).toBe("false");
  });

  it("widening 3 → 12 months brings signals back", async () => {
    const detailNodes = [
      datedNode("il-y-a-1-mois", 1),
      datedNode("il-y-a-4-mois", 4),
      datedNode("il-y-a-9-mois", 9),
    ];
    const { container, getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });
    await fireEvent.click(presetByLabel(container, "3 mois"));
    expect(getByTestId("visible-count").textContent).toBe("1");
    await fireEvent.click(presetByLabel(container, "12 mois"));
    expect(getByTestId("visible-count").textContent).toBe("3");
  });
});

describe("m2 — DateRangeFilter parity across A and B panels", () => {
  it("renders the same 3/6/12 presets in panel A", () => {
    const { container } = render(SignauxRail, {
      props: { entries: [], initialSubsetKey: "z|m|p" },
    });
    const labels = presetButtons(container).map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["3 mois", "6 mois", "12 mois"]);
    // Au-DESSUS des axes : le filtre de dates précède la ligne des toggles.
    const panel = container.querySelector(".vivier-panel")!;
    const dateFilter = panel.querySelector(".date-range-filter")!;
    const toggles = panel.querySelector(".vivier-toggles")!;
    expect(
      dateFilter.compareDocumentPosition(toggles) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the same 3/6/12 presets in panel B", () => {
    const { container } = render(SignauxRail, {
      props: { entries: [], initialSubsetKey: "vivier-v2" },
    });
    const labels = presetButtons(container).map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["3 mois", "6 mois", "12 mois"]);
    // Même défaut (6 mois pressé) qu'en A → parité stricte.
    expect(presetByLabel(container, "6 mois").getAttribute("aria-pressed")).toBe("true");
  });
});
