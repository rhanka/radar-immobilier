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

  it("m1.4 — unchecking the Résidentiel axis broadens the visible list", async () => {
    const detailNodes = [
      node("qualifie", "rezonage", { residentiel: "oui" }),
      node("a-confirmer", "rezonage", { residentiel: "indetermine" }),
    ];
    const { container, getByTestId } = render(Harness, {
      props: { detailNodes, initialSubsetKey: "vivier-v2" },
    });
    // Défaut : seul le qualifié (résidentiel oui) est montré.
    expect(getByTestId("visible-count").textContent).toBe("1");
    // Décocher « Résidentiel » (2e axe) → le « à confirmer » entre dans la liste.
    await fireEvent.click(axisBoxes(container)[1]!);
    expect(getByTestId("visible-count").textContent).toBe("2");
  });
});
