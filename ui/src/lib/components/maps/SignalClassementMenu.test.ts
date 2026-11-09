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
