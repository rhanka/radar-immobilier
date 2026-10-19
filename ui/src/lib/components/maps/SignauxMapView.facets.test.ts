import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { CITY_SLUG, NODES, cityRoute, openFirstSignalCard } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
import { fetchCityFacets, postFacetCommand } from "$lib/signals/signal-facets-client.js";

describe("SignauxMapView — reveal forwarding", () => {
  it("forwards showDiscarded=1 to detail and by-city, default stays hidden", async () => {
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all&filter.showDiscarded=1") } });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalled());
    expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalledWith(
      CITY_SLUG,
      "",
      expect.anything(),
      expect.objectContaining({ showDiscarded: true }),
    );
    expect(vi.mocked(fetchGraphSignalsByCity)).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ showDiscarded: true }),
    );

    vi.mocked(fetchGraphSignalDetail).mockClear();
    vi.mocked(fetchGraphSignalsByCity).mockClear();
    await view.rerender({ geoRoute: cityRoute("?filter.period=all") });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalled());
    const detailOpts = vi.mocked(fetchGraphSignalDetail).mock.calls[0]![3] as Record<string, unknown>;
    expect(detailOpts.showDiscarded).toBeUndefined();
    const bulkOpts = vi.mocked(fetchGraphSignalsByCity).mock.calls[0]![1] as Record<string, unknown>;
    expect(bulkOpts.showDiscarded).toBeUndefined();
    vi.mocked(fetchGraphSignalDetail).mockClear();
    await view.rerender({ geoRoute: cityRoute("?filter.period=all&filter.showDiscarded=1") });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalledWith(
      CITY_SLUG, "", expect.anything(), expect.objectContaining({ showDiscarded: true }),
    ));
    expect(localStorage.getItem("showDiscarded")).toBeNull();
    expect(localStorage.getItem("filter.showDiscarded")).toBeNull();
  });

  it("writes filter.showDiscarded=1 to the URL when the checkbox is toggled", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    const checkbox = await screen.findByLabelText("Montrer les écartés");
    await fireEvent.click(checkbox);
    await waitFor(() => expect(window.location.search).toContain("filter.showDiscarded=1"));
  });
});

describe("SignauxMapView — write then three re-reads", () => {
  it("re-reads detail, heads and by-city after a successful discard", async () => {
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    const detailCalls = vi.mocked(fetchGraphSignalDetail).mock.calls.length;
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    const bulkCalls = vi.mocked(fetchGraphSignalsByCity).mock.calls.length;
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue({
      ok: true, citySlug: CITY_SLUG, legacyProjection: null, nodes: NODES.slice(1),
    });
    vi.mocked(fetchGraphSignalsByCity).mockResolvedValue({
      ok: true, totalCount: 1,
      cities: [{ citySlug: CITY_SLUG, signalCount: 1, subsetCounts: {} }],
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() => expect(vi.mocked(postFacetCommand)).toHaveBeenCalled());
    expect(vi.mocked(postFacetCommand).mock.calls[0]![1]).toBe("discard");
    await waitFor(() =>
      expect(vi.mocked(fetchGraphSignalDetail).mock.calls.length).toBeGreaterThan(detailCalls),
    );
    await waitFor(() =>
      expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls),
    );
    await waitFor(() =>
      expect(vi.mocked(fetchGraphSignalsByCity).mock.calls.length).toBeGreaterThan(bulkCalls),
    );
    // Discard in the default view: the undo notice appears.
    expect(await screen.findByTestId("discarded-notice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /First zonage signal/ })).toBeNull();
    expect(view.container.querySelector(".rail-count-strong")?.textContent).toBe("1");
  });

  it("shows the distinct message when a re-read fails after a recorded write", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    vi.mocked(fetchGraphSignalsByCity).mockRejectedValueOnce(new Error("bulk down"));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    expect(await screen.findByTestId("facet-reload-error")).toBeTruthy();
    expect(screen.getByTestId("facet-reload-error").textContent).toContain("rechargement impossible");
    expect(screen.queryByTestId("discarded-notice")).toBeNull();
    await fireEvent.click(within(screen.getByTestId("facet-reload-error")).getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.queryByTestId("facet-reload-error")).toBeNull());
    expect(vi.mocked(postFacetCommand)).toHaveBeenCalledTimes(1);
  });

  it("keeps zero-archive ids, order and counters with and without reveal", async () => {
    const orders: string[][] = [];
    const counters: string[] = [];
    for (const search of ["?filter.period=all", "?filter.period=all&filter.showDiscarded=1"]) {
      const view = render(SignauxMapView, { props: { geoRoute: cityRoute(search) } });
      await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalled());
      await screen.findByRole("button", { name: /Second zonage signal/ });
      orders.push(
        [...view.container.querySelectorAll(".sel-entity-label")].map((el) => el.textContent ?? ""),
      );
      counters.push(view.container.querySelector(".rail-count-strong")?.textContent ?? "");
      cleanup();
    }
    // Server order is preserved on both paths: same ids, same order, same
    // counters (the mocked populations answer identically).
    expect(orders[0]).toHaveLength(2);
    expect(new Set(orders[0])).toEqual(new Set(["First zonage signal", "Second zonage signal"]));
    expect(orders[1]).toEqual(orders[0]);
    expect(counters).toEqual(["2", "2"]);
  });
});

