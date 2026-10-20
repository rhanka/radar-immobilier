import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { CITY_SLUG, NODES, setAuth, deferred, cityRoute, openFirstSignalCard } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";
import { fetchGraphSignalDetail, GraphSignalsHttpError } from "$lib/signals/graph-signal-detail-client.js";
import { fetchCityFacets, fetchReasonCodes, postFacetCommand, SignalFacetError } from "$lib/signals/signal-facets-client.js";

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
    const identities: string[][] = [];
    const counters: string[] = [];
    for (const search of ["?filter.period=all", "?filter.period=all&filter.showDiscarded=1"]) {
      const view = render(SignauxMapView, { props: { geoRoute: cityRoute(search) } });
      await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalled());
      await screen.findByRole("button", { name: /Second zonage signal/ });
      orders.push(
        [...view.container.querySelectorAll(".sel-entity-label")].map((el) => el.textContent ?? ""),
      );
      identities.push([...view.container.querySelectorAll("[data-signal-node]")].map(
        (el) => el.getAttribute("data-signal-node") ?? "",
      ));
      counters.push(view.container.querySelector(".rail-count-strong")?.textContent ?? "");
      cleanup();
    }
    // Server order is preserved on both paths: same ids, same order, same
    // counters (the mocked populations answer identically).
    expect(orders[0]).toHaveLength(2);
    expect(new Set(orders[0])).toEqual(new Set(["First zonage signal", "Second zonage signal"]));
    expect(orders[1]).toEqual(orders[0]);
    expect(identities).toEqual([["sig-1", "sig-2"], ["sig-1", "sig-2"]]);
    expect(counters).toEqual(["2", "2"]);
  });
});

describe("SignauxMapView — viewer isolation", () => {
  it("ignores heads still in flight when the viewer logs out", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchCityFacets>>>();
    vi.mocked(fetchCityFacets).mockReturnValue(pending.promise);
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    setAuth(null);
    await screen.findByTestId("facets-unavailable-note");
    pending.resolve({ heads: [{
      id: "old-head", target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-1" },
      facet: "selection", basket: "pertinent", state: "active", reasonCode: null,
      verdict: "pertinent", createdAt: "2026-10-19T12:00:00.000Z",
      targetAvailable: true, changedSinceArchive: null,
    }] });
    await tick();
    await tick();
    expect(screen.queryByTestId("facet-badge-pertinent")).toBeNull();
  });

  it("refreshes detail and counters when the viewer logs out", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    const detailCalls = vi.mocked(fetchGraphSignalDetail).mock.calls.length;
    const bulkCalls = vi.mocked(fetchGraphSignalsByCity).mock.calls.length;
    setAuth(null);
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail).mock.calls.length).toBeGreaterThan(detailCalls));
    expect(vi.mocked(fetchGraphSignalsByCity).mock.calls.length).toBeGreaterThan(bulkCalls);
  });

  it("loads codes after approval without a change of sub", async () => {
    setAuth("tester-1", "pending");
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await screen.findByTestId("facets-unavailable-note");
    expect(vi.mocked(fetchReasonCodes)).not.toHaveBeenCalled();
    setAuth("tester-1");
    await waitFor(() => expect(vi.mocked(fetchReasonCodes)).toHaveBeenCalled());
  });

  it("ignores a previous viewer's delayed codebook", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchReasonCodes>>>();
    vi.mocked(fetchReasonCodes).mockReturnValueOnce(pending.promise);
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(vi.mocked(fetchReasonCodes)).toHaveBeenCalled());
    setAuth("tester-2");
    await waitFor(() => expect(vi.mocked(fetchReasonCodes).mock.calls.length).toBeGreaterThan(1));
    await openFirstSignalCard();
    pending.resolve({ profileId: "old-profile", codes: [{ code: "P-OLD", verdict: "pertinent" }] });
    await tick();
    await tick();
    expect(screen.queryByRole("option", { name: "P-OLD" })).toBeNull();
    expect(screen.getByRole("option", { name: "P-DENSITE" })).toBeTruthy();
  });
});

describe("SignauxMapView — unavailable archive reads", () => {
  it("shows an explicit 503 error for detail and counters", async () => {
    vi.mocked(fetchGraphSignalDetail).mockRejectedValue(new GraphSignalsHttpError("discarded_signals_unavailable", 503));
    vi.mocked(fetchGraphSignalsByCity).mockRejectedValue(new GraphSignalsHttpError("discarded_signals_unavailable", 503));
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(screen.getAllByText(/discarded_signals_unavailable/)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /First zonage signal/ })).toBeNull();
  });
});

describe("SignauxMapView — Annuler restores with one key per retry", () => {
  it("restores on Annuler and reuses the key when retrying", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    const restore = deferred<unknown>();
    vi.mocked(postFacetCommand).mockImplementationOnce(async () => {
      await restore.promise;
      throw new SignalFacetError(null, null);
    });
    const annuler = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Annuler",
      )!;
    await fireEvent.click(annuler());
    expect(annuler().disabled).toBe(true);
    restore.resolve(null);
    await waitFor(() => expect(screen.getByTestId("discarded-action-error")).toBeTruthy());
    expect(screen.getByTestId("discarded-action-error").textContent).toContain("Écriture non confirmée");
    await fireEvent.click(annuler());
    await waitFor(() =>
      expect(vi.mocked(postFacetCommand).mock.calls.filter((call) => call[1] === "restore")).toHaveLength(2),
    );
    const restores = vi.mocked(postFacetCommand).mock.calls.filter((call) => call[1] === "restore");
    expect(restores[0]![2]).toEqual({
      target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-1" },
    });
    expect(restores[0]![3]).toBe(restores[1]![3]);
  });
});
