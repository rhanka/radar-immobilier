import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { CITY_SLUG, NODES, cityRoute, openFirstSignalCard } from "./SignauxMapView.facets.fixtures.js";
import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
import { rebuildSignalEvidence } from "$lib/signals/pdf-overlay-signals.js";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: new Promise(() => {}) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/worker.mjs" }));
vi.mock("$lib/signals/pdf-overlay-signals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/signals/pdf-overlay-signals.js")>();
  return { ...actual, rebuildSignalEvidence: vi.fn(actual.rebuildSignalEvidence) };
});

describe("6D MapView evidence reconciliation", () => {
  it("should mark newly served visible co-signals in filter on the first reload", async () => {
    const served = NODES.map((node) => ({ ...node, props: { ...node.props, rawRef: "raw/6d/shared.pdf" } }));
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue({
      ok: true, citySlug: CITY_SLUG, legacyProjection: null, nodes: served,
    });
    render(SignauxMapView, { props: { geoRoute: cityRoute("?filter.period=all") } });
    await openFirstSignalCard();
    await fireEvent.click(screen.getByRole("button", { name: /Voir la preuve/ }));
    await screen.findByRole("dialog", { name: "Preuve documentaire" });
    const incoming = { ...served[1]!, id: "new-signal", label: "New zonage signal" };
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue({
      ok: true, citySlug: CITY_SLUG, legacyProjection: null, nodes: [...served, incoming],
    });
    vi.mocked(rebuildSignalEvidence).mockClear();
    // A selection write causes a silent detail reload while evidence stays open.
    await fireEvent.click(screen.getByTestId("facet-toggle-pertinent"));
    await waitFor(() => expect(rebuildSignalEvidence).toHaveBeenCalled());
    const rebuilt = vi.mocked(rebuildSignalEvidence).mock.results.at(-1)!.value;
    expect(rebuilt.signals.find((signal: { id: string }) => signal.id === incoming.id))
      .toMatchObject({ inFilter: true, current: false });
  });
});
