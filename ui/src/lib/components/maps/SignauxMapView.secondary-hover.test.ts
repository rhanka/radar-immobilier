import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import SignalPdfOverlay from "./SignalPdfOverlay.svelte";
import type { HoverCardData, OverlaySignal } from "$lib/signals/pdf-overlay-signals.js";

const TEXT = "Signal target text for residential densification project";
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve({
    numPages: 1,
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale],
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: async () => ({ items: [{ str: TEXT, transform: [1, 0, 0, 12, 40, 700], width: 120, height: 12 }] }),
    }),
    destroy: vi.fn(),
  }) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/worker.mjs" }));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const signal = (id: string, current: boolean): OverlaySignal => ({
  id, label: id, excerpt: TEXT, page: 1, color: "#112233", current, inFilter: current,
});
const card: HoverCardData = {
  id: "B", title: "Co-signal B details", typeLabel: "Signal", color: "#112233",
  reglement: null, zoneRef: null, publishedAt: null, documentDate: null,
  page: 1, citation: "Old citation", completeness: [],
};

async function openHover() {
  const view = render(SignalPdfOverlay, { props: {
    rawRef: "raw/6d/hover.pdf", signals: [signal("A", true), signal("B", false)],
    resolveHoverCard: () => card,
  } });
  const badge = await waitFor(() => {
    const found = view.container.querySelector<HTMLElement>('.pdf-hl-badge[data-signal-id="B"]');
    expect(found).toBeTruthy();
    return found!;
  });
  await fireEvent.mouseEnter(badge);
  expect(view.getByText(card.title)).toBeTruthy();
  return view;
}

it("should remove an open co-signal hover card when its archived signal disappears", async () => {
  const view = await openHover();
  await view.rerender({ signals: [signal("A", true)] });
  expect(view.queryByText(card.title)).toBeNull();
});

it("should refresh an open hover card from the current authorized node", async () => {
  const view = await openHover();
  await view.rerender({
    signals: [signal("A", true), signal("B", false)],
    resolveHoverCard: () => ({ ...card, title: "Current B details", citation: "Current citation" }),
  });
  expect(view.queryByText(card.title)).toBeNull();
  expect(view.getByText("Current B details")).toBeTruthy();
  expect(view.getByText("Current citation")).toBeTruthy();
});
