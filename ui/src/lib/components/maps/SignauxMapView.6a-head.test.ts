import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { CITY_SLUG, cityRoute, deferred, openFirstSignalCard } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
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
    await screen.findByText(/Données périmées/);
    await waitFor(() => expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls));
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
