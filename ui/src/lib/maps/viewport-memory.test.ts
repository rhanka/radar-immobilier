/**
 * viewport-memory — C9 : le retour Province / la désélection restaurent le
 * cadrage EXACT du primo-chargement.
 */
import { describe, expect, it } from "vitest";
import { createViewportMemory } from "./viewport-memory.js";

describe("createViewportMemory", () => {
  it("retourne null avant toute capture", () => {
    const memory = createViewportMemory();
    expect(memory.initial()).toBeNull();
  });

  it("capture le PREMIER viewport et ignore les suivants", () => {
    const memory = createViewportMemory();
    memory.captureOnce({ center: [-73.5, 45.7], zoom: 7 });
    memory.captureOnce({ center: [-74.1, 45.2], zoom: 12 });
    expect(memory.initial()).toEqual({ center: [-73.5, 45.7], zoom: 7 });
  });

  it("restitue une COPIE : muter le retour ne corrompt pas la mémoire", () => {
    const memory = createViewportMemory();
    memory.captureOnce({ center: [-73.5, 45.7], zoom: 7 });
    const first = memory.initial();
    first!.center[0] = 0;
    first!.zoom = 1;
    expect(memory.initial()).toEqual({ center: [-73.5, 45.7], zoom: 7 });
  });

  it("ne mémorise pas le viewport passé par référence (copie défensive à la capture)", () => {
    const memory = createViewportMemory();
    const viewport = { center: [-73.5, 45.7] as [number, number], zoom: 7 };
    memory.captureOnce(viewport);
    viewport.center[0] = 0;
    viewport.zoom = 99;
    expect(memory.initial()).toEqual({ center: [-73.5, 45.7], zoom: 7 });
  });

  it("refuse un viewport invalide (NaN) — aucune capture", () => {
    const memory = createViewportMemory();
    memory.captureOnce({ center: [Number.NaN, 45.7], zoom: 7 });
    expect(memory.initial()).toBeNull();
    // Une capture valide ultérieure fonctionne toujours.
    memory.captureOnce({ center: [-73.5, 45.7], zoom: 7 });
    expect(memory.initial()).not.toBeNull();
  });
});
