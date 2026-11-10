import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import SignalClassementMenu from "./SignalClassementMenu.svelte";
import { DEFAULT_CLASSEMENT_FILTER } from "$lib/signals/signal-classement.js";

afterEach(() => cleanup());

// No `label` here: the API table (facet_reason_codes) carries none, so the
// UI dictionary (signal-reason-labels) must supply the human-readable text.
const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" as const },
  { code: "S-PLANIFIE", verdict: "a_surveiller" as const },
  { code: "N-NON-RES", verdict: "non_pertinent" as const },
  { code: "N-ACCESSOIRE", verdict: "non_pertinent" as const },
];

// Full À surveiller catalogue (profile immo-steve-2026-09, 8 codes).
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

describe("SignalClassementMenu — acceptance criteria", () => {
  it("criterion 2: card shows its class icon; click opens class first, then the Steve reason", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "pertinent" as const, reasonCodes: CODES, onApply },
    });
    const button = view.getByTestId("signal-classement-button");
    expect(button.getAttribute("aria-label")).toContain("Pertinent");
    await fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    expect(screen.getByRole("menuitem", { name: "Non résidentiel" })).toBeTruthy();
    // Reason step shows the human Steve label, never the technical code.
    expect(screen.getByRole("menuitem", { name: "Accessoire sans unités" }).textContent).not.toContain("N-ACCESSOIRE");
    await fireEvent.click(screen.getByRole("menuitem", { name: "Non résidentiel" }));
    expect(onApply).toHaveBeenCalledWith("ecarte", "N-NON-RES");
  });

  it("À surveiller: reason step shows its 8 labels plus Sans motif, then applies", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: SURVEILLER_CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    // Real-mouse sequence (mousedown + click): the class click must not
    // be misread as an outside click when the Menu re-renders.
    const item = screen.getByRole("menuitem", { name: "À surveiller" });
    await fireEvent.mouseDown(item);
    await fireEvent.click(item);
    for (const label of [
      "Mandat d'urbaniste amont",
      "Changement planifié",
      "Portée floue",
      "Contrainte à vérifier",
      "Resserrement à surveiller",
      "Information manquante",
      "PPCMOI répétés",
      "Droit de préemption",
      "Sans motif",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    expect(screen.queryByTestId("classement-reasons-empty")).toBeNull();
    await fireEvent.click(screen.getByRole("menuitem", { name: "Changement planifié" }));
    expect(onApply).toHaveBeenCalledWith("a_surveiller", "S-PLANIFIE");
  });

  it("menu popover is portaled out of the card (fixed, not clipped by panel overflow)", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    const pop = view.container.querySelector(".classement-pop")
      ?? document.querySelector(".classement-pop");
    expect(pop).toBeTruthy();
    // Portaled: the popover is no longer inside the component root span.
    expect(view.container.contains(pop)).toBe(false);
    expect(document.body.contains(pop)).toBe(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((pop as HTMLElement).style.position).toBe("fixed");
  });

  it("popover carries the DS popover elevation and stays in the viewport near the bottom edge", async () => {
    const onApply = vi.fn();
    // jsdom has no layout: pin the trigger near the bottom of a 300px
    // viewport so the reason step must flip up and cap its height.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-testid") === "signal-classement-button") {
          return { top: 260, bottom: 280, left: 90, right: 110, width: 20, height: 20, x: 90, y: 260, toJSON: () => ({}) } as DOMRect;
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
      const pop = document.querySelector(".classement-pop") as HTMLElement;
      expect(pop).toBeTruthy();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const top = Number.parseFloat(pop.style.top);
      const maxHeight = Number.parseFloat(pop.style.maxHeight);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(maxHeight).toBeLessThanOrEqual(300 - 16);
      expect(pop.style.getPropertyValue("--st-menu-maxHeight")).toBe(pop.style.maxHeight);
    } finally {
      rectSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("F10: Escape and outside click close the menu; back returns to class step", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    expect(screen.getByRole("menuitem", { name: "Sans motif" })).toBeTruthy();
    await fireEvent.click(screen.getByRole("menuitem", { name: "← Retour" }));
    expect(screen.getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Écarté" })).toBeNull();
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    expect(screen.getByRole("menuitem", { name: "Écarté" })).toBeTruthy();
    await fireEvent.click(document.body);
    expect(screen.queryByRole("menuitem", { name: "Écarté" })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("F5/F7: disabled menu cannot open; empty reasons are shown, not silent", async () => {
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
  });

  it("criterion 3: Écarté offers no reason-free validation; Pertinent can validate without a reason", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    expect(screen.queryByRole("menuitem", { name: "Sans motif" })).toBeNull();
    cleanup();
    const second = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(second.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Sans motif" }));
    expect(onApply).toHaveBeenCalledWith("pertinent", null);
    expect(DEFAULT_CLASSEMENT_FILTER.ecarte).toBe(false);
  });
});
