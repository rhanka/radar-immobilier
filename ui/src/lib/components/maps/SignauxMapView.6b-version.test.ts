import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { CITY_SLUG, detailOf, NODES, NODE_FINGERPRINT, cityRoute, openFirstSignalCard } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchCityFacets, postFacetCommand, SignalFacetError } from "$lib/signals/signal-facets-client.js";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";

describe("SignauxMapView — 6B displayed fingerprint", () => {
  it("sends the displayed fingerprint on undo so a changed signal conflicts", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue(detailOf(CITY_SLUG, NODES.filter((node) => node.id !== "sig-1")));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    await screen.findByTestId("discarded-notice");
    await waitFor(() => expect(screen.queryByTestId("signal-facet-controls")).toBeNull());
    await fireEvent.click([...screen.getByTestId("discarded-notice").querySelectorAll("button")]
      .find((button) => button.textContent === "Annuler")!);
    await waitFor(() => expect(vi.mocked(postFacetCommand).mock.calls
      .filter((call) => call[1] === "restore")).not.toHaveLength(0));
    const restores = vi.mocked(postFacetCommand).mock.calls.filter((call) => call[1] === "restore");
    expect(restores[0]![2]).toEqual({
      target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-1" },
      expectedHeadId: "event-1",
      displayedFingerprint: NODE_FINGERPRINT,
    });
  });

  it("reloads after a version conflict and shows the version copy", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    vi.mocked(postFacetCommand).mockRejectedValueOnce(
      new SignalFacetError(409, "target_version_conflict", undefined,
        { version: { fingerprint: "f".repeat(64) }, heads: [] }));
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue(detailOf(CITY_SLUG, NODES.filter((node) => node.id !== "sig-1")));
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    const conflict = await screen.findByTestId("facet-conflict-notice");
    expect(conflict.textContent).toMatch(/Contenu modifié/);
    await waitFor(() => expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls));
    await waitFor(() => expect(screen.queryByTestId("signal-facet-controls")).toBeNull());
    expect(screen.getByTestId("facet-conflict-notice").textContent).toMatch(/Contenu modifié/);
  });

  it("reloads after a refused undo without substituting a new fingerprint", async () => {
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.change(screen.getByLabelText("Code de motif (requis) — Écarter"), {
      target: { value: "N-ADMIN" },
    });
    await fireEvent.click(screen.getByTestId("facet-discard-submit"));
    const notice = await screen.findByTestId("discarded-notice");
    const headsCalls = vi.mocked(fetchCityFacets).mock.calls.length;
    vi.mocked(postFacetCommand).mockRejectedValueOnce(
      new SignalFacetError(409, "target_version_conflict"));
    await fireEvent.click([...notice.querySelectorAll("button")].find((button) => button.textContent === "Annuler")!);
    await screen.findByText(/Contenu modifié/);
    await waitFor(() => expect(vi.mocked(fetchCityFacets).mock.calls.length).toBeGreaterThan(headsCalls));
    expect(postFacetCommand).toHaveBeenCalledTimes(2);
  });
});
