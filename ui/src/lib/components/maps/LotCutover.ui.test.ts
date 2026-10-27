import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "./LotFichePanel.svelte";
import Evaluation from "./EvaluationMapView.svelte";
import { activePageState } from "$lib/router/router.js";
import { normalizeGeoRouteState } from "$lib/router/geo-route.js";
import type { LotFeature } from "$lib/maps/lots-client.js";

vi.mock("$lib/signals/signals-live.js", () => ({ loadLiveSignals: async () => [] }));
vi.mock("$lib/collab/prospect-notes-stream.js", () => ({
  subscribeNoteFrames: () => () => {}, noteMatchesTarget: () => false,
}));

const lot: LotFeature = { type: "Feature", properties: {
  noLot: "SYN-6K-UI", citySlug: "delson", lotVersionId: "6a000000-0000-4000-8000-0000000000aa",
}, geometry: { type: "Polygon", coordinates: [[[-74, 45], [-73.9, 45], [-73.9, 45.1], [-74, 45]]] } };
const facets = { selectionActive: true, pipelineStatus: "sollicite" as const,
  marketActive: true, archivedActive: true };
let requests: string[];

beforeEach(() => {
  requests = [];
  window.history.replaceState(null, "", "/#/evaluation");
  activePageState.set(normalizeGeoRouteState());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
    const body = url.includes("/marks") ? init?.method === "POST"
      ? { ok: true, mark: { id: "synthetic-mark", noLot: "SYN-6K-UI", citySlug: "delson",
        dimension: "pipeline", statut: "favori", mode: "real", createdAt: "2026-01-01T00:00:00Z" } }
      : { ok: true, marks: [] }
      : url.includes("/notes") ? { ok: true, notes: [], annotations: [] }
      : url.includes("/detail") ? { ok: true, events: [] }
      : { ok: true, citySlug: "delson", source: "synthetic", mode: "carte-steve",
        featureCollection: { type: "FeatureCollection", features: url.includes("zonage") ? [] : [lot] } };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("6K component mode isolation", () => {
  it("should ignore supplied facets until the operator activates the destination", async () => {
    const view = render(Panel, { lot, allowMarquage: true, lotFacetsActive: false, facetState: facets });
    await waitFor(() => expect(view.getByTestId("fiche-prospect-edit")).toBeTruthy());
    expect(requests.some((url) => url.includes("/marks"))).toBe(true);
    expect(view.queryByTestId("fiche-facet-state")).toBeNull();
  });

  it("should preserve legacy reads and controls when activation is false", async () => {
    const view = render(Panel, { lot, allowMarquage: true, lotFacetsActive: false });
    await waitFor(() => expect(view.getByTestId("fiche-prospect-edit")).toBeTruthy());
    expect(requests.some((url) => url.includes("/marks"))).toBe(true);
    expect(view.queryByTestId("fiche-facet-state")).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "Favori" }));
    expect(requests.some((url) => url.startsWith("POST ") && url.includes("/marks"))).toBe(true);
  });

  it("should display independent facets without legacy mark traffic after activation", async () => {
    const view = render(Panel, { lot, allowMarquage: true, lotFacetsActive: true, facetState: facets });
    await tick();
    expect(view.getByTestId("fiche-facet-state").textContent).toContain("Sélection : active");
    expect(view.getByTestId("fiche-facet-state").textContent).toContain("Sollicité");
    expect(view.queryByTestId("fiche-prospect-edit")).toBeNull();
    expect(requests.some((url) => url.includes("/marks"))).toBe(false);
  });

  it("should show unavailable state without reopening legacy readers", async () => {
    const view = render(Panel, { lot, allowMarquage: true, lotFacetsActive: true });
    await tick();
    expect(view.getByText("Facettes indisponibles.")).toBeTruthy();
    expect(requests.some((url) => url.includes("/marks"))).toBe(false);
  });

  it("should keep map and opened panel on facets without legacy mark traffic", async () => {
    const view = render(Evaluation, { lotFacetsActive: true,
      lotFacetStates: [{ key: "delson::SYN-6K-UI", ...facets }] });
    await waitFor(() => expect(view.getByRole("button", { name: "Lot SYN-6K-UI" })).toBeTruthy());
    await fireEvent.click(view.getByRole("button", { name: "Lot SYN-6K-UI" }));
    await waitFor(() => expect(view.getByTestId("fiche-facet-state")).toBeTruthy());
    expect(requests.some((url) => url.includes("/marks"))).toBe(false);
  });
});

// The versioned launcher archives the actual origin/main components and pins
// their hashes. Baselines are absent during ordinary developer UI runs.
const baselines = import.meta.glob("./__6k_baseline__/*.svelte");
describe.skipIf(Object.keys(baselines).length !== 2)("6K UI comparison with main", () => {
  it.each(["LotFichePanel", "EvaluationMapView"])("should preserve %s DOM and requests before activation", async (name) => {
    const loader = baselines[`./__6k_baseline__/${name}.svelte`]!;
    const { default: baseline } = await loader() as { default: typeof Panel };
    const current = name === "LotFichePanel" ? Panel : Evaluation;
    const props = name === "LotFichePanel" ? { lot, allowMarquage: true } : {};
    async function capture(component: typeof Panel) {
      requests = [];
      activePageState.set(normalizeGeoRouteState());
      const view = render(component, props);
      await waitFor(() => expect(name === "LotFichePanel"
        ? view.getByTestId("fiche-prospect-edit")
        : view.getByRole("button", { name: "Lot SYN-6K-UI" })).toBeTruthy());
      await tick();
      const snapshot = () => ({ text: view.container.textContent?.replace(/\s+/g, " ").trim(),
        html: view.container.innerHTML.replace(/svelte-[a-z0-9]+/g, "svelte-scope").replace(/<!--.*?-->/gs, ""),
        requests: [...requests] });
      const initial = snapshot();
      if (name === "EvaluationMapView") {
        await fireEvent.click(view.getByRole("button", { name: "Lot SYN-6K-UI" }));
        await waitFor(() => expect(view.getByTestId("fiche-prospect-edit")).toBeTruthy());
      }
      const favorite = view.getByRole("button", { name: "Favori" }) as HTMLButtonElement;
      await fireEvent.click(favorite);
      if (!favorite.disabled) {
        await waitFor(() => expect(requests.some((request) => request.startsWith("POST "))).toBe(true));
      }
      await tick();
      const result = { initial, afterAction: snapshot() };
      cleanup();
      return result;
    }
    const expected = await capture(baseline);
    expect(await capture(current as typeof Panel)).toEqual(expected);
  });
});
