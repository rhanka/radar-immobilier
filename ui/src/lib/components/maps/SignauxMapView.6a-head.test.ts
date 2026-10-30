import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import {
  CITY_SLUG,
  NODES,
  OTHER_CITY_SLUG,
  cityRoute,
  deferred,
  mockDetailByCity,
  openFirstSignalCard,
  detailOf,
} from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
import { fetchCityFacets, postFacetCommand, SignalFacetError } from "$lib/signals/signal-facets-client.js";

describe("SignauxMapView — 6A expected heads", () => {
  it("sends the confirmed discard head on undo so an intervening change conflicts", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    vi.mocked(postFacetCommand).mockResolvedValueOnce({ id: "archive-1" });
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [{
      id: "archive-intervening", target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-1" },
      facet: "archive", basket: null, state: "active", reasonCode: "N-ADMIN",
      verdict: "non_pertinent", createdAt: "2026-10-20T12:00:00.000Z",
      targetAvailable: true, changedSinceArchive: false,
    }] });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    await fireEvent.click([...screen.getByTestId("discarded-notice").querySelectorAll("button")]
      .find((button) => button.textContent === "Annuler")!);
    await waitFor(() => expect(vi.mocked(postFacetCommand).mock.calls
      .filter((call) => call[1] === "restore")).not.toHaveLength(0));
    const restores = vi.mocked(postFacetCommand).mock.calls.filter((call) => call[1] === "restore");
    expect(restores[0]![2]).toMatchObject({ expectedHeadId: "archive-1" });
  });

  it("reloads heads after a 409 head conflict and shows the stale copy", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    vi.mocked(postFacetCommand).mockRejectedValueOnce(
      new SignalFacetError(409, "facet_head_conflict", undefined, { version: null, heads: [] }));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    const conflict = await screen.findByTestId("facet-conflict-notice");
    expect(conflict.textContent).toMatch(/Données périmées/);
    expect(conflict.textContent).toContain("sig-1");
    expect(screen.getByTestId("signal-facet-controls")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls));
  });

  it("keeps the refusal visible after the reload removes the signal", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    vi.mocked(postFacetCommand).mockRejectedValueOnce(
      new SignalFacetError(409, "facet_head_conflict", undefined, { version: null, heads: [] }));
    // Another tab archived sig-1: the post-409 reload drops it from detail.
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue(detailOf(CITY_SLUG, NODES.filter((node) => node.id !== "sig-1")));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    const conflict = await screen.findByTestId("facet-conflict-notice");
    expect(conflict.textContent).toContain("Signal sig-1");
    expect(conflict.textContent).toContain(CITY_SLUG);
    expect(conflict.textContent).toMatch(/Données périmées/);
    expect(within(conflict).getByRole("alert")).toBeTruthy();
    // The card (with its local message) is gone, the parent refusal stays.
    await waitFor(() => expect(screen.queryByTestId("signal-facet-controls")).toBeNull());
    expect(screen.getByTestId("facet-conflict-notice").textContent).toMatch(/Données périmées/);
  });

  it("ignores a late conflict from city A once city B is open", async () => {
    mockDetailByCity();
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    let rejectCommand!: (err: unknown) => void;
    const pending = new Promise<unknown>((_, reject) => {
      rejectCommand = reject;
    });
    pending.catch(() => {});
    vi.mocked(postFacetCommand).mockImplementationOnce(() => pending);
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await view.rerender({ geoRoute: cityRoute("?filter.period=all", OTHER_CITY_SLUG) });
    await screen.findByRole("button", { name: /B first signal/ });
    await fireEvent.click(screen.getByRole("button", { name: /B first signal/ }));
    await screen.findByTestId("signal-facet-controls");
    const detailCalls = vi.mocked(fetchGraphSignalDetail).mock.calls.length;
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    const bulkCalls = vi.mocked(fetchGraphSignalsByCity).mock.calls.length;
    rejectCommand(
      new SignalFacetError(409, "facet_head_conflict", undefined, { version: null, heads: [] }));
    // The stale handler only refreshes the by-city counters.
    await waitFor(() =>
      expect(vi.mocked(fetchGraphSignalsByCity).mock.calls.length).toBeGreaterThan(bulkCalls),
    );
    await tick();
    await tick();
    expect(vi.mocked(fetchGraphSignalDetail).mock.calls.length).toBe(detailCalls);
    expect(vi.mocked(fetchCityFacets).mock.calls.length).toBe(headsCalls);
    expect(screen.queryByTestId("facet-conflict-notice")).toBeNull();
    expect(screen.queryByTestId("facet-reload-error")).toBeNull();
    expect(screen.queryByTestId("discarded-notice")).toBeNull();
    expect(screen.getByTestId("signal-facet-controls")).toBeTruthy();
    expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /B first signal/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /First zonage signal/ })).toBeNull();
  });

  it("can undo with the receipt head before a pending reload completes", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    vi.mocked(postFacetCommand).mockResolvedValueOnce({ id: "confirmed-archive" });
    const reload = deferred<Awaited<ReturnType<typeof fetchCityFacets>>>();
    vi.mocked(fetchCityFacets).mockImplementationOnce(() => reload.promise);
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    const notice = await screen.findByTestId("discarded-notice");
    await fireEvent.click([...notice.querySelectorAll("button")].find((button) => button.textContent === "Annuler")!);
    await waitFor(() => expect(vi.mocked(postFacetCommand).mock.calls[1]?.[2])
      .toMatchObject({ expectedHeadId: "confirmed-archive" }));
    reload.resolve({ heads: [] });
  });

  it("reloads after refused undo and never substitutes a new archive head", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    const notice = await screen.findByTestId("discarded-notice");
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    vi.mocked(postFacetCommand).mockRejectedValueOnce(new SignalFacetError(409, "facet_head_conflict"));
    await fireEvent.click([...notice.querySelectorAll("button")].find((button) => button.textContent === "Annuler")!);
    await screen.findByText(/Données périmées/);
    await waitFor(() => expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls));
    expect(postFacetCommand).toHaveBeenCalledTimes(2);
    expect(vi.mocked(postFacetCommand).mock.calls[1]?.[2]).toMatchObject({ expectedHeadId: "event-1" });
  });
});
