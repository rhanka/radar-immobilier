import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { CITY_SLUG, NODES, cityRoute, deferred, openFirstSignalCard, setAuth } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
import { fetchCityFacets, fetchReasonCodes, type FacetHead } from "$lib/signals/signal-facets-client.js";

const archiveHead: FacetHead = {
  id: "archive-1", target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-1" },
  facet: "archive", basket: null, state: "active", reasonCode: "N-ADMIN",
  verdict: "non_pertinent", createdAt: "2026-10-19T12:00:00.000Z",
  targetAvailable: true, changedSinceArchive: false,
};

describe("SignauxMapView — facet regression paths", () => {
  it("should finish loading codes after closing and reopening a city", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchReasonCodes>>>();
    vi.mocked(fetchReasonCodes).mockReturnValueOnce(pending.promise);
    const route = cityRoute("?filter.period=all");
    const view = render(SignauxMapView, { props: { geoRoute: route } });
    await openFirstSignalCard();
    await view.rerender({ geoRoute: { level: "region", region: "quebec", state: route.state } });
    pending.resolve({ profileId: "test", codes: [{ code: "P-DENSITE", verdict: "pertinent" }] });
    await tick();
    await view.rerender({ geoRoute: route });
    await openFirstSignalCard();
    await waitFor(() => expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(false));
  });

  it("should disable unknown heads and recover through the heads retry", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchCityFacets>>>();
    vi.mocked(fetchCityFacets).mockImplementation(async () => {
      await pending.promise;
      throw new Error("heads unavailable");
    });
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await screen.findByTestId("facet-heads-loading");
    expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [] });
    pending.resolve({ heads: [] });
    const error = await screen.findByTestId("facet-heads-error");
    await fireEvent.click(error.querySelector("button")!);
    await waitFor(() => expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("facet-heads-error")).toBeNull();
  });

  it("should reload a failed codebook through the controls retry", async () => {
    vi.mocked(fetchReasonCodes).mockRejectedValueOnce(new Error("codes unavailable"));
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.click(await screen.findByRole("button", { name: "Relire les codes" }));
    await waitFor(() => expect((screen.getByTestId("facet-toggle-pertinent") as HTMLButtonElement).disabled).toBe(false));
    expect(vi.mocked(fetchReasonCodes)).toHaveBeenCalledTimes(2);
  });

  it("should offer reveal after detail 404 only when heads prove active archives", async () => {
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue({
      ok: false, citySlug: CITY_SLUG, legacyProjection: null, nodes: [],
    });
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [archiveHead] });
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    expect(await screen.findByTestId("facet-all-archived")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Montrer les écartés" }));
    await waitFor(() => expect(window.location.search).toContain("filter.showDiscarded=1"));
  });

  it("should retain the ordinary empty message without active archive heads", async () => {
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue({
      ok: false, citySlug: CITY_SLUG, legacyProjection: null, nodes: [],
    });
    vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [{ ...archiveHead, state: "inactive" }] });
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    expect(await screen.findByText("Aucun signal indexé pour cette ville.")).toBeTruthy();
    expect(screen.queryByTestId("facet-all-archived")).toBeNull();
  });

  it("should prioritize the disabled-auth note over the anonymous note", async () => {
    setAuth(null, "approved", true);
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    const note = await screen.findByTestId("facets-unavailable-note");
    expect(note.textContent).toContain("authentification est désactivée");
    expect(note.textContent).not.toContain("Connexion requise");
  });

  it("should keep the focused card mounted while a select silently reloads", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    const pending = deferred<Awaited<ReturnType<typeof fetchGraphSignalDetail>>>();
    vi.mocked(fetchGraphSignalDetail).mockReturnValueOnce(pending.promise);
    const controls = screen.getByTestId("signal-facet-controls");
    const button = screen.getByTestId("facet-toggle-pertinent");
    button.focus();
    await fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail).mock.results.at(-1)?.value).toBe(pending.promise));
    expect(screen.getByTestId("signal-facet-controls")).toBe(controls);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    pending.resolve({ ok: true, citySlug: CITY_SLUG, legacyProjection: null, nodes: NODES });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("signal-facet-controls")).toBe(controls);
    expect(controls.contains(document.activeElement)).toBe(true);
  });

  it("should ignore a superseded reload without displaying a failure banner", async () => {
    const view = render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    const pending = deferred<Awaited<ReturnType<typeof fetchGraphSignalDetail>>>();
    vi.mocked(fetchGraphSignalDetail).mockReturnValueOnce(pending.promise);
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail).mock.results.at(-1)?.value).toBe(pending.promise));
    await view.rerender({ geoRoute: cityRoute("?filter.period=all&filter.showDiscarded=1") });
    await waitFor(() => expect(vi.mocked(fetchGraphSignalDetail).mock.results.at(-1)?.value).not.toBe(pending.promise));
    pending.resolve({ ok: false, citySlug: CITY_SLUG, legacyProjection: null, nodes: [] });
    await tick();
    await tick();
    expect(screen.queryByTestId("facet-reload-error")).toBeNull();
  });
});
