import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  renderedPages: [] as number[],
  textContentPages: [] as number[],
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: pdfMocks.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.mjs",
}));

import SignalPdfOverlay from "./SignalPdfOverlay.svelte";

const scrollIntoView = vi.fn();
const scrollTo = vi.fn();

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 600,
    width: 600,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function mockFivePageDocument(pageTexts?: string[]) {
  const pages = Array.from({ length: 5 }, (_, index) => {
    const pageNumber = index + 1;
    return {
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        transform: [scale, 0, 0, -scale, 0, 800 * scale],
      }),
      render: vi.fn(() => {
        pdfMocks.renderedPages.push(pageNumber);
        return { promise: Promise.resolve(), cancel: vi.fn() };
      }),
      getTextContent: vi.fn(async () => {
        pdfMocks.textContentPages.push(pageNumber);
        return {
          items: [
            {
              str:
                pageTexts?.[index] ??
                "Signal target text for residential densification project",
            transform: [1, 0, 0, 12, 40, 700],
            width: 120,
            height: 12,
            },
          ],
        };
      }),
    };
  });
  return {
    numPages: 5,
    getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
    destroy: vi.fn(async () => undefined),
  };
}

function setVisiblePage(container: HTMLElement, visiblePage: number): void {
  const scroller = container.querySelector<HTMLElement>(".pdf-canvas-scroll")!;
  scroller.getBoundingClientRect = vi.fn(() => rect(0, 600));
  for (const slot of container.querySelectorAll<HTMLElement>(".pdf-page-slot")) {
    const pageNumber = Number(slot.dataset.pageNumber);
    slot.getBoundingClientRect = vi.fn(() =>
      pageNumber === visiblePage ? rect(20, 580) : rect(700, 1020),
    );
  }
  fireEvent.scroll(scroller);
}

beforeEach(() => {
  pdfMocks.renderedPages.length = 0;
  pdfMocks.textContentPages.length = 0;
  pdfMocks.getDocument.mockImplementation(() => ({
    promise: Promise.resolve(mockFivePageDocument()),
  }));
  scrollIntoView.mockReset();
  scrollTo.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ setTransform: vi.fn() }),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SignalPdfOverlay — attribution carte masquée pendant l'ouverture", () => {
  it("ajoute body.pdf-viewer-open au montage, le retire au démontage", () => {
    expect(document.body.classList.contains("pdf-viewer-open")).toBe(false);
    const view = render(SignalPdfOverlay, { props: { rawRef: "raw/test/attrib.pdf" } });
    expect(document.body.classList.contains("pdf-viewer-open")).toBe(true);
    view.unmount();
    expect(document.body.classList.contains("pdf-viewer-open")).toBe(false);
  });
});

describe("SignalPdfOverlay — Ctrl/Cmd+F route vers la recherche du viewer", () => {
  it("Ctrl+F focus l'input de recherche plein-texte et empêche le find natif", async () => {
    const { container, getByRole } = render(SignalPdfOverlay, {
      props: { rawRef: "raw/test/ctrlf.pdf" },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    const input = getByRole("searchbox", {
      name: /Rechercher dans le document/i,
    }) as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    // preventDefault() → fireEvent renvoie false (find natif du navigateur bloqué).
    const notPrevented = await fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("Cmd+F (metaKey) route aussi vers la cellule de recherche", async () => {
    const { container, getByRole } = render(SignalPdfOverlay, {
      props: { rawRef: "raw/test/cmdf.pdf" },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    const input = getByRole("searchbox", {
      name: /Rechercher dans le document/i,
    }) as HTMLInputElement;
    const notPrevented = await fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});

describe("SignalPdfOverlay continuous page stack", () => {
  it("dimensions five slots while rendering only the page window", async () => {
    const { container } = render(SignalPdfOverlay, {
      props: { rawRef: "raw/test/five-pages-a.pdf" },
    });

    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    for (const slot of container.querySelectorAll<HTMLElement>(".pdf-page-slot")) {
      expect(Number.parseFloat(slot.style.width)).toBeGreaterThan(0);
      expect(Number.parseFloat(slot.style.height)).toBeGreaterThan(0);
    }
    await waitFor(() => {
      const rendered = Array.from(
        container.querySelectorAll<HTMLElement>('.pdf-page-slot[data-rendered="true"]'),
      ).map((slot) => Number(slot.dataset.pageNumber));
      expect(rendered).toEqual([1, 2]);
    });
    expect(container.querySelectorAll(".pdf-page-slot canvas")).toHaveLength(2);
    expect(new Set(pdfMocks.renderedPages)).toEqual(new Set([1, 2]));
  });

  it("advances currentPage and the render window when scrolling", async () => {
    const { container, getByText } = render(SignalPdfOverlay, {
      props: { rawRef: "raw/test/five-pages-b.pdf" },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );

    setVisiblePage(container, 4);

    await waitFor(() => expect(getByText("Page 4/5")).toBeTruthy());
    await waitFor(() => {
      const mounted = Array.from(
        container.querySelectorAll<HTMLElement>(".pdf-page-slot canvas"),
      ).map((canvas) => Number(canvas.closest<HTMLElement>(".pdf-page-slot")!.dataset.pageNumber));
      expect(mounted).toEqual([3, 4, 5]);
    });
  });

  it("scrolls to the initial page and to an externally hovered signal", async () => {
    const { container, getByRole } = render(SignalPdfOverlay, {
      props: {
        rawRef: "raw/test/five-pages-c.pdf",
        page: 3,
        signals: [
          {
            id: "sig-5",
            label: "S5",
            excerpt: "Signal target text for residential densification project",
            page: 5,
            color: "#eab308",
            current: false,
          },
        ],
        hoveredSignalId: "sig-5",
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    await waitFor(() =>
      expect(
        scrollIntoView.mock.instances.some(
          (element) => (element as HTMLElement).dataset.pageNumber === "3",
        ),
      ).toBe(true),
    );

    await fireEvent.click(getByRole("button", { name: /S5 — page 5/ }));
    expect(
      scrollIntoView.mock.instances.some(
        (element) => (element as HTMLElement).dataset.pageNumber === "5",
      ),
    ).toBe(true);
  });

  it("keeps text highlighting guarded by the signal page", async () => {
    const { container } = render(SignalPdfOverlay, {
      props: {
        rawRef: "raw/test/five-pages-d.pdf",
        page: 1,
        signals: [
          {
            id: "sig-3",
            label: "S3",
            excerpt: "Signal target text for residential densification project",
            page: 3,
            color: "#eab308",
            current: true,
          },
        ],
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    await waitFor(() =>
      expect(container.querySelector('.pdf-page-slot[data-page-number="1"] canvas')).toBeTruthy(),
    );
    expect(
      container.querySelectorAll('.pdf-page-slot[data-page-number="1"] .pdf-hl'),
    ).toHaveLength(0);

    setVisiblePage(container, 3);

    await waitFor(() =>
      expect(
        container.querySelectorAll('.pdf-page-slot[data-page-number="3"] .pdf-hl'),
      ).not.toHaveLength(0),
    );
    expect(
      container.querySelectorAll('.pdf-page-slot[data-page-number="1"] .pdf-hl'),
    ).toHaveLength(0);
  });
});

describe("SignalPdfOverlay recherche plein-texte", () => {
  const pageTexts = [
    "Introduction municipale",
    "Citation signal complète pour le projet terme recherché",
    "Délibération sans résultat",
    "Autre terme inscrit au procès-verbal",
    "Fin du document",
  ];

  it("indexe paresseusement toutes les pages puis navigue entre les résultats", async () => {
    pdfMocks.getDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve(mockFivePageDocument(pageTexts)),
    }));
    const { container, getByRole, getByText } = render(SignalPdfOverlay, {
      props: { rawRef: "raw/test/search-navigation.pdf" },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    expect(pdfMocks.textContentPages).toEqual([]);

    const input = getByRole("searchbox", { name: "Rechercher dans le document" });
    await fireEvent.input(input, { target: { value: "terme" } });
    await fireEvent.click(getByRole("button", { name: "Lancer la recherche" }));

    await waitFor(() => expect(getByText("1/2")).toBeTruthy());
    expect(pdfMocks.textContentPages.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(
      scrollIntoView.mock.instances.some(
        (element) => (element as HTMLElement).dataset.pageNumber === "2",
      ),
    ).toBe(true);

    await fireEvent.click(getByRole("button", { name: "Résultat suivant" }));
    await waitFor(() => expect(getByText("2/2")).toBeTruthy());
    expect(pdfMocks.textContentPages).toHaveLength(5);
    expect(
      scrollIntoView.mock.instances.some(
        (element) => (element as HTMLElement).dataset.pageNumber === "4",
      ),
    ).toBe(true);
  });

  it("garde le highlight de recherche distinct puis le retire à l'effacement", async () => {
    pdfMocks.getDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve(mockFivePageDocument(pageTexts)),
    }));
    const { container, getByRole } = render(SignalPdfOverlay, {
      props: {
        rawRef: "raw/test/search-highlight.pdf",
        page: 2,
        signals: [{
          id: "sig-2",
          label: "S2",
          excerpt: "Citation signal complète pour le projet terme recherché",
          page: 2,
          color: "#eab308",
          current: true,
        }],
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".pdf-page-slot")).toHaveLength(5),
    );
    const input = getByRole("searchbox", { name: "Rechercher dans le document" });
    await fireEvent.input(input, { target: { value: "terme" } });
    await fireEvent.click(getByRole("button", { name: "Lancer la recherche" }));

    await waitFor(() => {
      expect(container.querySelector('.pdf-hl[data-signal-id="sig-2"]')).toBeTruthy();
      expect(container.querySelector(".pdf-search-hl")).toBeTruthy();
    });

    await fireEvent.input(input, { target: { value: "" } });
    await waitFor(() => expect(container.querySelector(".pdf-search-hl")).toBeNull());
    expect(container.querySelector('.pdf-hl[data-signal-id="sig-2"]')).toBeTruthy();
  });
});
