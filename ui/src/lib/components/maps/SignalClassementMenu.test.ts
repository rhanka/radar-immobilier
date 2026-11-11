import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import SignalClassementMenu from "./SignalClassementMenu.svelte";
import { DEFAULT_CLASSEMENT_FILTER } from "$lib/signals/signal-classement.js";

afterEach(() => cleanup());

const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" as const },
  { code: "S-PLANIFIE", verdict: "a_surveiller" as const },
  { code: "N-NON-RES", verdict: "non_pertinent" as const },
  { code: "N-ACCESSOIRE", verdict: "non_pertinent" as const },
];

const SURVEILLER_CODES = [
  { code: "S-MANDAT-AMONT", verdict: "a_surveiller" as const },
  { code: "S-PLANIFIE", verdict: "a_surveiller" as const },
  { code: "S-PORTEE-FLOUE", verdict: "a_surveiller" as const },
  { code: "S-CONTRAINTE", verdict: "a_surveiller" as const },
  { code: "S-RESTRICTIF", verdict: "a_surveiller" as const },
  { code: "S-INFO-MANQUANTE", verdict: "a_surveiller" as const },
  { code: "S-PPCMOI-SERIE", verdict: "a_surveiller" as const },
  { code: "S-PREEMPTION", verdict: "a_surveiller" as const },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function reasonMenu(): HTMLElement {
  return screen.getByTestId("classement-reason-menu");
}
function classMenu(): HTMLElement {
  return screen.getByTestId("classement-class-menu");
}
function reasonItems(): string[] {
  return within(reasonMenu()).getAllByRole("menuitem").map((el) => el.textContent?.trim() ?? "");
}

describe("SignalClassementMenu — cascade sub-menu", () => {
  it("fixed chevron slots on every line + DS ghost IconButton trigger (no text shift)", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "pertinent" as const, reasonCodes: CODES, onApply },
    });
    const button = view.getByTestId("signal-classement-button");
    // Standard DS icon button: ghost variant, sm size (same as Zones/Lots warning).
    expect(button.classList.contains("st-iconButton")).toBe(true);
    expect(button.classList.contains("st-iconButton--ghost")).toBe(true);
    expect(button.classList.contains("st-iconButton--sm")).toBe(true);
    await fireEvent.click(button);
    const items = within(classMenu()).getAllByRole("menuitem");
    expect(items.length).toBe(4);
    for (const item of items) {
      // Every line reserves one fixed chevron slot, empty until selected.
      expect(item.querySelector(".classement-chevron")).toBeTruthy();
      expect(item.querySelector(".classement-chevron")?.textContent).toBe("");
    }
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    const chosen = within(classMenu()).getByRole("menuitem", { name: "Écarté" });
    expect(chosen.querySelector(".classement-chevron")?.textContent).toBe("‹");
    // Non-selected lines keep their empty fixed slot (labels do not move).
    const other = within(classMenu()).getByRole("menuitem", { name: "Pertinent" });
    expect(other.querySelector(".classement-chevron")?.textContent).toBe("");
  });

  it("click: class menu stays open, chosen line highlighted with chevron, reason applies (Écarté)", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "pertinent" as const, reasonCodes: CODES, onApply },
    });
    const button = view.getByTestId("signal-classement-button");
    expect(button.getAttribute("aria-label")).toContain("Pertinent");
    await fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    // Cascade: class menu STAYS open next to the reason sub-menu.
    expect(within(classMenu()).getByRole("menuitem", { name: "Pertinent" })).toBeTruthy();
    expect(within(classMenu()).getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    expect(screen.getByText("Écarté — motif")).toBeTruthy();
    const chosen = within(classMenu()).getByRole("menuitem", { name: "Écarté" });
    expect(chosen.classList.contains("classement-item--selected")).toBe(true);
    expect(chosen.querySelector(".classement-chevron")?.textContent).toBe("‹");
    expect(reasonItems()).toContain("Non résidentiel");
    expect(screen.queryByRole("menuitem", { name: "Sans motif" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Non résidentiel" }).textContent).not.toContain("N-ACCESSOIRE");
    await fireEvent.click(screen.getByRole("menuitem", { name: "Non résidentiel" }));
    expect(onApply).toHaveBeenCalledWith("ecarte", "N-NON-RES");
    expect(screen.queryByTestId("classement-reason-menu")).toBeNull();
  });

  it("Pertinent: Sans motif first, then reasons; Sans motif applies with null", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    expect(screen.getByText("Pertinent — motif")).toBeTruthy();
    expect(reasonItems()[0]).toBe("Sans motif");
    expect(reasonItems()).toContain("Hausse de densité");
    await fireEvent.click(screen.getByRole("menuitem", { name: "Sans motif" }));
    expect(onApply).toHaveBeenCalledWith("pertinent", null);
    expect(DEFAULT_CLASSEMENT_FILTER.ecarte).toBe(false);
  });

  it("À surveiller: 8 labels with Sans motif first, then applies", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: SURVEILLER_CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    const item = screen.getByRole("menuitem", { name: "À surveiller" });
    await fireEvent.mouseDown(item);
    await fireEvent.click(item);
    expect(screen.getByText("À surveiller — motif")).toBeTruthy();
    expect(reasonItems()).toEqual([
      "Sans motif",
      "Mandat d'urbaniste amont",
      "Changement planifié",
      "Portée floue",
      "Contrainte à vérifier",
      "Resserrement à surveiller",
      "Information manquante",
      "PPCMOI répétés",
      "Droit de préemption",
    ]);
    expect(screen.queryByTestId("classement-reasons-empty")).toBeNull();
    await fireEvent.click(screen.getByRole("menuitem", { name: "Changement planifié" }));
    expect(onApply).toHaveBeenCalledWith("a_surveiller", "S-PLANIFIE");
  });

  it("Non classé applies directly and closes everything", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "pertinent" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Non classé" }));
    expect(onApply).toHaveBeenCalledWith("non_classe", null);
    expect(screen.queryByTestId("classement-class-menu")).toBeNull();
  });

  it("hover with intent delay opens the sub-menu for the hovered class", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.mouseOver(screen.getByRole("menuitem", { name: "Pertinent" }));
    expect(screen.queryByTestId("classement-reason-menu")).toBeNull();
    await sleep(220);
    expect(screen.getByText("Pertinent — motif")).toBeTruthy();
    expect(within(classMenu()).getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
  });

  it("keyboard: arrows navigate, Enter/ArrowLeft open, Esc closes sub-menu then menu, focus returns to icon", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    const trigger = view.getByTestId("signal-classement-button");
    await fireEvent.click(trigger);
    const pertinent = screen.getByRole("menuitem", { name: "Pertinent" });
    pertinent.focus();
    await fireEvent.keyDown(pertinent, { key: "ArrowDown" });
    const surveiller = screen.getByRole("menuitem", { name: "À surveiller" });
    expect(document.activeElement).toBe(surveiller);
    await fireEvent.keyDown(surveiller, { key: "ArrowUp" });
    expect(document.activeElement).toBe(pertinent);
    // Enter opens the sub-menu (side=left in the default viewport).
    await fireEvent.keyDown(pertinent, { key: "Enter" });
    expect(screen.getByText("Pertinent — motif")).toBeTruthy();
    expect(within(classMenu()).getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    // Esc closes only the sub-menu, focus back on the chosen class line.
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("classement-reason-menu")).toBeNull();
    expect(within(classMenu()).getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    // ArrowLeft (opening side) reopens; ArrowRight (toward parent) closes.
    const pertinentAgain = screen.getByRole("menuitem", { name: "Pertinent" });
    pertinentAgain.focus();
    await fireEvent.keyDown(pertinentAgain, { key: "ArrowLeft" });
    expect(screen.getByText("Pertinent — motif")).toBeTruthy();
    const sansMotif = screen.getByRole("menuitem", { name: "Sans motif" });
    sansMotif.focus();
    await fireEvent.keyDown(sansMotif, { key: "ArrowRight" });
    expect(screen.queryByTestId("classement-reason-menu")).toBeNull();
    // Final Esc closes the menu and returns focus to the card icon.
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("classement-class-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("outside click closes everything", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    expect(screen.getByText("Pertinent — motif")).toBeTruthy();
    await fireEvent.click(document.body);
    expect(screen.queryByTestId("classement-class-menu")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("sub-menu opens on the left when there is room (default)", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    expect(reasonMenu().getAttribute("data-side")).toBe("left");
    const chosen = within(classMenu()).getByRole("menuitem", { name: "Pertinent" });
    expect(chosen.querySelector(".classement-chevron")?.textContent).toBe("‹");
  });

  it("should drill down in place when space left of the class menu is smaller than the reason menu", async () => {
    const onApply = vi.fn();
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-testid") === "signal-classement-button") {
          return { top: 100, bottom: 120, left: 350, right: 370, width: 20, height: 20, x: 350, y: 100, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    const widthSpy = vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    const heightSpy = vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    try {
      const view = render(SignalClassementMenu, {
        props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
      });
      await fireEvent.click(view.getByTestId("signal-classement-button"));
      // Tap (click, no hover) opens the reason step.
      await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
      await sleep(50);
      expect(screen.queryByTestId("classement-class-menu")).toBeNull();
      expect(reasonMenu().getAttribute("data-mode")).toBe("drill");
      expect(screen.getByTestId("classement-pop").getAttribute("data-mode")).toBe("drill");
      const back = screen.getByTestId("classement-reason-back");
      expect(back.textContent).toContain("Écarté");
      expect(document.activeElement).toBe(back);
      expect(screen.getByRole("menuitem", { name: "Non résidentiel" })).toBeTruthy();
      // Back header returns to the class step.
      await fireEvent.click(back);
      expect(screen.queryByTestId("classement-reason-menu")).toBeNull();
      expect(within(classMenu()).getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("should keep the left cascade when space left can hold the reason menu", async () => {
    const onApply = vi.fn();
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-testid") === "signal-classement-button") {
          return { top: 100, bottom: 120, left: 880, right: 900, width: 20, height: 20, x: 880, y: 100, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    const widthSpy = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    try {
      const view = render(SignalClassementMenu, {
        props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
      });
      await fireEvent.click(view.getByTestId("signal-classement-button"));
      await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
      await sleep(50);
      expect(reasonMenu().getAttribute("data-mode")).toBe("cascade");
      expect(reasonMenu().getAttribute("data-side")).toBe("left");
      expect(screen.queryByTestId("classement-reason-back")).toBeNull();
      expect(within(classMenu()).getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });

  it("should Escape back to class then close in drill-down, and ArrowDown reaches the reason list", async () => {
    const onApply = vi.fn();
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-testid") === "signal-classement-button") {
          return { top: 100, bottom: 120, left: 350, right: 370, width: 20, height: 20, x: 350, y: 100, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    const widthSpy = vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    const heightSpy = vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    try {
      const view = render(SignalClassementMenu, {
        props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
      });
      const trigger = view.getByTestId("signal-classement-button");
      await fireEvent.click(trigger);
      await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
      await sleep(50);
      const back = screen.getByTestId("classement-reason-back");
      expect(document.activeElement).toBe(back);
      await fireEvent.keyDown(back, { key: "ArrowDown" });
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sans motif" }));
      await fireEvent.keyDown(window, { key: "Escape" });
      await sleep(50);
      expect(screen.queryByTestId("classement-reason-menu")).toBeNull();
      expect(within(classMenu()).getByRole("menuitem", { name: "Pertinent" })).toBeTruthy();
      await fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("classement-class-menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("menu popover is portaled out of the card (fixed, not clipped by panel overflow)", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    const pop = view.container.querySelector(".classement-pop") ?? document.querySelector(".classement-pop");
    expect(pop).toBeTruthy();
    expect(view.container.contains(pop)).toBe(false);
    expect(document.body.contains(pop)).toBe(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((pop as HTMLElement).style.position).toBe("fixed");
  });

  it("both menus carry the DS popover shadow and stay in the viewport near the bottom edge", async () => {
    const onApply = vi.fn();
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-testid") === "signal-classement-button") {
          return { top: 260, bottom: 280, left: 580, right: 600, width: 20, height: 20, x: 580, y: 260, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    const heightSpy = vi.spyOn(window, "innerHeight", "get").mockReturnValue(300);
    try {
      const view = render(SignalClassementMenu, {
        props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
      });
      await fireEvent.click(view.getByTestId("signal-classement-button"));
      await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
      expect(screen.getByRole("menuitem", { name: "Non résidentiel" })).toBeTruthy();
      expect(within(classMenu()).getByRole("menuitem", { name: "Pertinent" })).toBeTruthy();
      const pop = document.querySelector(".classement-pop") as HTMLElement;
      expect(pop).toBeTruthy();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const top = Number.parseFloat(pop.style.top);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top).toBeLessThanOrEqual(300 - 8);
    } finally {
      rectSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("disabled menu cannot open; empty reasons are shown, not silent", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: [], disabled: true, onApply },
    });
    const button = view.getByTestId("signal-classement-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(screen.queryByRole("menuitem", { name: "Écarté" })).toBeNull();
    cleanup();
    const second = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: [], onApply },
    });
    await fireEvent.click(second.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    expect(screen.getByTestId("classement-reasons-empty")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Sans motif" })).toBeNull();
    expect(within(classMenu()).getByRole("menuitem", { name: "Pertinent" })).toBeTruthy();
  });
});
