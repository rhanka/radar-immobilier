import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import SignauxGeoEngineCanvas from "./SignauxGeoEngineCanvas.svelte";
import { GEO3D_ENGINE_ENABLED } from "$lib/maps/geo-engine-flag.js";
import { createMockGeoMap } from "$lib/maps/geo-engine-mock.js";

afterEach(() => cleanup());

const basemap = { kind: "blank", background: "semantic-surface-muted" } as const;
const viewport = {
  center: [-73.5, 45.7],
  zoom: 7,
  bearing: 0,
  pitch: 0,
} as const;

describe("SignauxGeoEngineCanvas — Porte 1", () => {
  it("garde le moteur geo3d désactivé", () => {
    expect(GEO3D_ENGINE_ENABLED).toBe(false);
  });

  it("monte le moteur injecté puis détruit son handle à l'unmount", () => {
    const { mount, state } = createMockGeoMap();
    const view = render(SignauxGeoEngineCanvas, {
      props: {
        mount,
        basemap,
        layers: [],
        viewport,
        tokenRoles: [],
      },
    });

    expect(state.mounted).toBe(true);
    expect(state.calls).toEqual(["mount"]);

    view.unmount();

    expect(state.mounted).toBe(false);
    expect(state.calls).toEqual(["mount", "destroy"]);
  });
});
