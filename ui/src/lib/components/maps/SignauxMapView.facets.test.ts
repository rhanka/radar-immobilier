import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { CITY_SLUG, detailOf, NODES, NODE_FINGERPRINT, OTHER_CITY_SLUG, setAuth, deferred, cityRoute, mockDetailByCity, openFirstSignalCard } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";
import { fetchGraphSignalDetail, fetchRevealedSignal, GraphSignalsHttpError } from "$lib/signals/graph-signal-detail-client.js";
import { readyWorkspaceState, setTestWorkspaceState, TEST_WORKSPACE_ID } from "./test-stubs/workspace-context-ready.js";
import { fetchCityFacets, fetchReasonCodes, postFacetCommand, SignalFacetError, type FacetHead } from "$lib/signals/signal-facets-client.js";

describe("SignauxMapView — scoped reveal of archived targets", () => {
  it("reads the city in the explicit workspace and reveals archived targets only on demand", async () => {
    const archivedHead = { target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-archived" },
      personal: { id: "head-archived", state: "active", reasonCode: "N-ADMIN" }, workspace: null,
      effectiveDiscarded: true };
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue({ ...detailOf(CITY_SLUG, NODES), heads: [archivedHead] });
    vi.mocked(fetchRevealedSignal).mockResolvedValue({
      node: { ...NODES[0]!, id: "sig-archived", label: "Archived zonage signal", facetFingerprint: "c".repeat(64) },
      displayedFingerprint: "c".repeat(64), heads: { personal: archivedHead.personal, workspace: null },
      effectiveDiscarded: true });
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all&filter.showDiscarded=1") } });
    await waitFor(() => expect(vi.mocked(fetchRevealedSignal)).toHaveBeenCalled());
    expect(vi.mocked(fetchGraphSignalDetail).mock.calls[0]![0]).toEqual({ workspaceId: TEST_WORKSPACE_ID });
    expect(vi.mocked(fetchGraphSignalDetail).mock.calls[0]![1]).toBe(CITY_SLUG);
    expect(vi.mocked(fetchRevealedSignal)).toHaveBeenCalledWith({ workspaceId: TEST_WORKSPACE_ID },
      archivedHead.target, expect.anything());

    vi.mocked(fetchGraphSignalDetail).mockClear();
    vi.mocked(fetchRevealedSignal).mockClear();
    await view.rerender({ geoRoute: cityRoute("?filter.period=all") });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalled());
    expect(vi.mocked(fetchRevealedSignal)).not.toHaveBeenCalled();
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
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue(detailOf(CITY_SLUG, NODES.slice(1)));
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

  it("shows the undo notice even when a re-read fails after a recorded write", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    vi.mocked(fetchGraphSignalsByCity).mockRejectedValueOnce(new Error("bulk down"));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    // The write is confirmed in the default view: the notice shows whatever
    // the re-reads report, next to the distinct reload message.
    expect(await screen.findByTestId("discarded-notice")).toBeTruthy();
    expect(await screen.findByTestId("facet-reload-error")).toBeTruthy();
    expect(screen.getByTestId("facet-reload-error").textContent).toContain("Classement enregistré");
    expect(screen.getByTestId("facet-reload-error").textContent).toContain("rechargement impossible");
    await fireEvent.click(within(screen.getByTestId("facet-reload-error")).getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.queryByTestId("facet-reload-error")).toBeNull());
    expect(vi.mocked(postFacetCommand)).toHaveBeenCalledTimes(1);
  });

  it("shows the discard notice at once while the post-write re-read hangs", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    const detailPending = deferred<Awaited<ReturnType<typeof fetchGraphSignalDetail>>>();
    const headsPending = deferred<Awaited<ReturnType<typeof fetchCityFacets>>>();
    const bulkPending = deferred<Awaited<ReturnType<typeof fetchGraphSignalsByCity>>>();
    vi.mocked(fetchGraphSignalDetail).mockReturnValueOnce(detailPending.promise);
    vi.mocked(fetchCityFacets).mockReturnValueOnce(headsPending.promise);
    vi.mocked(fetchGraphSignalsByCity).mockReturnValueOnce(bulkPending.promise);
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() => expect(vi.mocked(postFacetCommand)).toHaveBeenCalled());
    const notice = await screen.findByTestId("discarded-notice");
    expect(notice.textContent).toContain("First zonage signal");
    const annuler = [...notice.querySelectorAll("button")].find(
      (button) => button.textContent === "Annuler",
    ) as HTMLButtonElement;
    expect(annuler.disabled).toBe(false);
    const bulkOptions = vi.mocked(fetchGraphSignalsByCity).mock.calls.at(-1)?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(bulkOptions).toMatchObject({});
    expect("signal" in (bulkOptions ?? {})).toBe(true);
    detailPending.resolve(detailOf(CITY_SLUG, NODES));
    headsPending.resolve({ heads: [] });
    bulkPending.resolve({ ok: true, totalCount: 2, cities: [] });
    await waitFor(() =>
      expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("shows a reload error and re-enables the controls when the by-city body stalls", async () => {
    const actual =
      await vi.importActual<typeof import("$lib/signals/graph-signals-by-city-client.js")>(
        "$lib/signals/graph-signals-by-city-client.js",
      );
    vi.stubGlobal(
      "fetch",
      async (_url: string, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.mocked(fetchGraphSignalsByCity).mockImplementation((baseUrl, opts) =>
      actual.fetchGraphSignalsByCity(baseUrl, { ...opts, timeoutMs: 20 }),
    );
    try {
      render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
      await openFirstSignalCard();
      await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
        target: { value: "N-ADMIN" },
      });
      await fireEvent.click(screen.getByTestId("facet-discard-submit"));
      // The write is confirmed: the notice shows at once, then the stalled
      // by-city body times out and the reload error appears.
      expect(await screen.findByTestId("discarded-notice")).toBeTruthy();
      expect(await screen.findByTestId("facet-reload-error")).toBeTruthy();
      await waitFor(() =>
        expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(false),
      );
    } finally {
      vi.unstubAllGlobals();
    }
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
  it("ignores the previous viewer heads when switching to another approved sub", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchCityFacets>>>();
    vi.mocked(fetchCityFacets).mockReturnValueOnce(pending.promise);
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    // Switch to ANOTHER approved viewer before the old heads resolve.
    setAuth("tester-2");
    await waitFor(() =>
      expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls),
    );
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
    vi.mocked(fetchGraphSignalDetail).mockRejectedValue(
      new GraphSignalsHttpError("graph-signals/x: 503", 503, "discarded_signals_unavailable"),
    );
    vi.mocked(fetchGraphSignalsByCity).mockRejectedValue(
      new GraphSignalsHttpError("graph-signals/by-city: 503", 503, "discarded_signals_unavailable"),
    );
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(screen.getAllByText(/discarded_signals_unavailable/)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /First zonage signal/ })).toBeNull();
  });

  it("names the scoped 503 code, never an empty list", async () => {
    vi.mocked(fetchGraphSignalDetail).mockRejectedValue(
      new GraphSignalsHttpError("coherent-city/x: 503", 503, "scoped_facet_scope_unavailable"),
    );
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(screen.getByText(/Signaux indisponibles \(scoped_facet_scope_unavailable\)/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /First zonage signal/ })).toBeNull();
  });

  it("shows the session state for a refused scoped read", async () => {
    vi.mocked(fetchGraphSignalDetail).mockRejectedValue(
      new GraphSignalsHttpError("coherent-city/x: 401", 401, "unauthenticated"),
    );
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(screen.getByText(/Session expirée/)).toBeTruthy());
  });
});

describe("SignauxMapView — city switches during facet writes", () => {
  it("keeps city B's list when undoing a discard after selecting B", async () => {
    mockDetailByCity();
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    const restore = deferred<unknown>();
    vi.mocked(postFacetCommand).mockImplementationOnce(() => restore.promise);
    const annuler = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Annuler",
      )!;
    await fireEvent.click(annuler());
    // Select city B while the restore POST is still in flight.
    await view.rerender({ geoRoute: cityRoute("?filter.period=all", OTHER_CITY_SLUG) });
    await screen.findByRole("button", { name: /B first signal/ });
    const detailCallsAfterSwitch = vi.mocked(fetchGraphSignalDetail).mock.calls.length;
    const bulkCallsAfterSwitch = vi.mocked(fetchGraphSignalsByCity).mock.calls.length;
    restore.resolve(null);
    await waitFor(() => expect(vi.mocked(fetchGraphSignalsByCity).mock.calls.length).toBeGreaterThan(bulkCallsAfterSwitch));
    await waitFor(() => expect(screen.queryByTestId("discarded-notice")).toBeNull());
    // The late restore of city A never paints city B: stale, not an error.
    expect(screen.queryByTestId("facet-reload-error")).toBeNull();
    expect(screen.getByRole("button", { name: /B first signal/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /First zonage signal/ })).toBeNull();
    for (const call of vi.mocked(fetchGraphSignalDetail).mock.calls.slice(detailCallsAfterSwitch)) {
      expect(call[0]).not.toBe(CITY_SLUG);
    }
  });

  it("shows no notice and no banner when the city changes during the discard POST", async () => {
    mockDetailByCity();
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    const confirmed = deferred<unknown>();
    vi.mocked(postFacetCommand).mockImplementationOnce(() => confirmed.promise);
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await view.rerender({ geoRoute: cityRoute("?filter.period=all", OTHER_CITY_SLUG) });
    await screen.findByRole("button", { name: /B first signal/ });
    const bulkCalls = vi.mocked(fetchGraphSignalsByCity).mock.calls.length;
    confirmed.resolve({ id: "event-1" });
    // Wait until the post-write reload has settled before asserting silence.
    await waitFor(() =>
      expect(vi.mocked(fetchGraphSignalsByCity).mock.calls.length).toBeGreaterThan(bulkCalls),
    );
    // Confirmed for city A while city B is selected: no notice, no banner.
    expect(screen.queryByTestId("discarded-notice")).toBeNull();
    expect(screen.queryByTestId("facet-reload-error")).toBeNull();
    expect(screen.getByRole("button", { name: /B first signal/ })).toBeTruthy();
  });

  it.each([false, true])("keeps city B notice and reload error (failed read: %s) when a late restore of city A succeeds", async (readFails) => {
    mockDetailByCity();
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    const restore = deferred<unknown>();
    vi.mocked(postFacetCommand).mockImplementationOnce(() => restore.promise);
    const annulerA = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Annuler",
      )!;
    await fireEvent.click(annulerA());
    await view.rerender({ geoRoute: cityRoute("?filter.period=all", OTHER_CITY_SLUG) });
    await screen.findByRole("button", { name: /B first signal/ });
    await fireEvent.click(screen.getByRole("button", { name: /B first signal/ }));
    await screen.findByTestId("signal-facet-controls");
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    if (readFails) vi.mocked(fetchGraphSignalsByCity).mockRejectedValueOnce(new Error("city B read failed"));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("discarded-notice").textContent).toContain("B first signal"),
    );
    if (readFails) await screen.findByTestId("facet-reload-error");
    const bulkCalls = vi.mocked(fetchGraphSignalsByCity).mock.calls.length;
    restore.resolve(null);
    await waitFor(() =>
      expect(vi.mocked(fetchGraphSignalsByCity).mock.calls.length).toBeGreaterThan(bulkCalls),
    );
    await tick();
    await tick();
    expect(screen.getByTestId("discarded-notice").textContent).toContain("B first signal");
    expect(screen.queryByTestId("discarded-action-error")).toBeNull();
    expect(Boolean(screen.queryByTestId("facet-reload-error"))).toBe(readFails);
  });

  it("leaves city B notice clean when a late restore of city A fails", async () => {
    mockDetailByCity();
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    let rejectRestore!: (err: unknown) => void;
    const restorePromise = new Promise<unknown>((_, reject) => {
      rejectRestore = reject;
    });
    restorePromise.catch(() => {});
    vi.mocked(postFacetCommand).mockImplementationOnce(() => restorePromise);
    const annulerA = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Annuler",
      )!;
    await fireEvent.click(annulerA());
    await view.rerender({ geoRoute: cityRoute("?filter.period=all", OTHER_CITY_SLUG) });
    await screen.findByRole("button", { name: /B first signal/ });
    await fireEvent.click(screen.getByRole("button", { name: /B first signal/ }));
    await screen.findByTestId("signal-facet-controls");
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("discarded-notice").textContent).toContain("B first signal"),
    );
    rejectRestore(new SignalFacetError(null, null));
    await tick();
    await tick();
    await waitFor(() =>
      expect(screen.getByTestId("discarded-notice").textContent).toContain("B first signal"),
    );
    expect(screen.queryByTestId("discarded-action-error")).toBeNull();
  });
});

describe("SignauxMapView — account isolation of late facet writes", () => {
  async function switchAccount(sub: string) {
    const calls = vi.mocked(fetchReasonCodes).mock.calls.length;
    setAuth(sub);
    await waitFor(() => expect(vi.mocked(fetchReasonCodes).mock.calls.length).toBeGreaterThan(calls));
    await tick();
  }

  const cases = [false, true].flatMap((switchBack) => [false, true].map((fails) => ({ switchBack, fails })));

  it.each(cases)("drops a late discard (switch back: $switchBack, failure: $fails)", async ({ switchBack, fails }) => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    const confirmed = deferred<unknown>();
    vi.mocked(postFacetCommand).mockImplementationOnce(async () => {
      await confirmed.promise;
      if (fails) throw new SignalFacetError(null, null);
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    // Another approved account takes over while the discard POST is in flight.
    await switchAccount("tester-2");
    if (switchBack) await switchAccount("tester-1");
    const reads = [fetchGraphSignalDetail, fetchCityFacets, fetchGraphSignalsByCity].map(
      (read) => vi.mocked(read).mock.calls.length,
    );
    confirmed.resolve({ id: "event-2" });
    await confirmed.promise;
    await tick();
    await tick();
    // The late confirmation belongs to the previous account: no notice, no
    // error and no banner for the new viewer — and no restore POST follows.
    expect(screen.queryByTestId("discarded-notice")).toBeNull();
    expect(screen.queryByTestId("discarded-action-error")).toBeNull();
    expect(screen.queryByTestId("facet-reload-error")).toBeNull();
    expect(vi.mocked(postFacetCommand)).toHaveBeenCalledTimes(1);
    expect([fetchGraphSignalDetail, fetchCityFacets, fetchGraphSignalsByCity].map(
      (read) => vi.mocked(read).mock.calls.length,
    )).toEqual(reads);
  });

  it.each(cases)("drops a late restore (switch back: $switchBack, failure: $fails)", async ({ switchBack, fails }) => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    const restored = deferred<unknown>();
    vi.mocked(postFacetCommand).mockImplementationOnce(async () => {
      await restored.promise;
      if (fails) throw new SignalFacetError(null, null);
    });
    const annuler = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Annuler",
      )!;
    await fireEvent.click(annuler());
    // Another approved account takes over while the restore POST is in flight.
    await switchAccount("tester-2");
    if (switchBack) await switchAccount("tester-1");
    const reads = [fetchGraphSignalDetail, fetchCityFacets, fetchGraphSignalsByCity].map(
      (read) => vi.mocked(read).mock.calls.length,
    );
    // A stale restore must not start any read, even one that would fail.
    vi.mocked(fetchGraphSignalsByCity).mockRejectedValueOnce(new Error("bulk down"));
    restored.resolve(null);
    await restored.promise;
    await tick();
    await tick();
    expect(screen.queryByTestId("discarded-notice")).toBeNull();
    expect(screen.queryByTestId("discarded-action-error")).toBeNull();
    expect(screen.queryByTestId("facet-reload-error")).toBeNull();
    expect(vi.mocked(postFacetCommand)).toHaveBeenCalledTimes(2);
    expect([fetchGraphSignalDetail, fetchCityFacets, fetchGraphSignalsByCity].map(
      (read) => vi.mocked(read).mock.calls.length,
    )).toEqual(reads);
  });
});

describe("SignauxMapView — initial read retry banner", () => {
  it("does not announce a recorded write when an initial read retry fails", async () => {
    vi.mocked(fetchCityFacets).mockRejectedValueOnce(new Error("heads down"));
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    const headsError = await screen.findByTestId("facet-heads-error");
    vi.mocked(fetchCityFacets).mockRejectedValueOnce(new Error("heads still down"));
    await fireEvent.click(within(headsError).getByRole("button", { name: "Réessayer" }));
    const banner = await screen.findByTestId("facet-reload-error");
    expect(banner.textContent).toContain("rechargement impossible");
    expect(banner.textContent).toContain("Classement illisible");
    expect(banner.textContent).not.toContain("enregistré");
    expect(vi.mocked(postFacetCommand)).not.toHaveBeenCalled();
  });
});

describe("SignauxMapView — notice focus", () => {
  it("focuses the restored card after a successful Annuler", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    const annuler = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Annuler",
      )!;
    await fireEvent.click(annuler());
    await waitFor(() =>
      expect(document.activeElement?.closest?.('[data-signal-node="sig-1"]')).toBeTruthy(),
    );
  });

  it("focuses the Signaux bucket summary after Fermer", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    const fermer = () =>
      [...screen.getByTestId("discarded-notice").querySelectorAll("button")].find(
        (button) => button.textContent === "Fermer",
      )!;
    await fireEvent.click(fermer());
    await waitFor(() => expect(screen.queryByTestId("discarded-notice")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("signals-bucket-head")),
    );
  });
});

describe("SignauxMapView — public-format heads", () => {
  const archiveHead: FacetHead = {
    id: "h1",
    target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-1" },
    facet: "archive",
    basket: null,
    state: "active",
    reasonCode: "N-ADMIN",
    verdict: "non_pertinent",
    createdAt: "2026-10-19T12:00:00.000Z",
    targetAvailable: true,
    changedSinceArchive: false,
  };

  it("shows badges, re-reads the badge after a select, and restores in reveal", async () => {
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [archiveHead] });
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all&filter.showDiscarded=1") } });
    // Badge from the public target:{citySlug,type,id} head shape.
    const archived = await screen.findByTestId("facet-badge-archived");
    expect(archived.textContent).toContain("N-ADMIN");
    // A select write re-reads heads: the new badge appears.
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [archiveHead, {
      id: "h2",
      target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-2" },
      facet: "selection",
      basket: "pertinent",
      state: "active",
      reasonCode: "P-DENSITE",
      verdict: "pertinent",
      createdAt: "2026-10-19T12:00:00.000Z",
      targetAvailable: true,
      changedSinceArchive: null,
    }] });
    await fireEvent.click(screen.getByRole("button", { name: /Second zonage signal/ }));
    await fireEvent.click(await screen.findByTestId("facet-toggle-pertinent"));
    expect(await screen.findByTestId("facet-badge-pertinent")).toBeTruthy();
    // Restaurer is offered on the unfolded archived card in reveal.
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [] });
    await fireEvent.click(screen.getByRole("button", { name: /First zonage signal/ }));
    await fireEvent.click(await screen.findByTestId("facet-restore"));
    await waitFor(() => expect(screen.queryByTestId("facet-badge-archived")).toBeNull());
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
      expectedHeadId: "event-1",
      displayedFingerprint: NODE_FINGERPRINT,
    });
    expect(restores[0]![3]).toBe(restores[1]![3]);
  });
});

describe("SignauxMapView — workspace context (6H)", () => {
  it("issues no scoped request without a workspace and shows the unavailable state", async () => {
    setTestWorkspaceState({ ...readyWorkspaceState(), status: "missing", workspaces: [],
      context: { viewerKey: { context: "tester-1" }, workspaceId: null } });
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(screen.getAllByText(/Aucun espace de travail/).length).toBeGreaterThan(0));
    expect(vi.mocked(fetchGraphSignalDetail)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchCityFacets)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchReasonCodes)).not.toHaveBeenCalled();
  });

  it("reloads the current city in the newly selected workspace", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalled());
    vi.mocked(fetchGraphSignalDetail).mockClear();
    const other = "22222222-2222-4222-8222-222222222222";
    setTestWorkspaceState({ ...readyWorkspaceState(),
      context: { viewerKey: { context: "tester-1" }, workspaceId: other } });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail)).toHaveBeenCalledWith(
      { workspaceId: other }, CITY_SLUG, expect.anything()));
  });
});
