import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import SignalClassementMenu from "./SignalClassementMenu.svelte";
import { DEFAULT_CLASSEMENT_FILTER } from "$lib/signals/signal-classement.js";

afterEach(() => cleanup());

const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" as const, label: "densité" },
  { code: "S-PLANIFIE", verdict: "a_surveiller" as const, label: "planifié" },
  { code: "N-NON-RES", verdict: "non_pertinent" as const, label: "non résidentiel" },
  { code: "N-ACCESSOIRE", verdict: "non_pertinent" as const, label: "accessoire" },
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
    expect(screen.getByTestId("classement-class-ecarte")).toBeTruthy();
    await fireEvent.click(screen.getByTestId("classement-class-ecarte"));
    expect(screen.getByTestId("classement-reason-N-NON-RES")).toBeTruthy();
    // Reason step lists each Steve code with its short label.
    expect(screen.getByTestId("classement-reason-N-ACCESSOIRE").textContent).toContain("N-ACCESSOIRE");
    expect(screen.getByTestId("classement-reason-N-ACCESSOIRE").textContent).toContain("accessoire");
    await fireEvent.click(screen.getByTestId("classement-reason-N-NON-RES"));
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
    await fireEvent.click(screen.getByTestId("classement-class-pertinent"));
    expect(screen.getByTestId("classement-reason-none")).toBeTruthy();
    await fireEvent.click(screen.getByTestId("classement-back"));
    expect(screen.getByTestId("classement-class-ecarte")).toBeTruthy();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("classement-class-ecarte")).toBeNull();
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    expect(screen.getByTestId("classement-class-ecarte")).toBeTruthy();
    await fireEvent.click(document.body);
    expect(screen.queryByTestId("classement-class-ecarte")).toBeNull();
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
    expect(screen.queryByTestId("classement-class-ecarte")).toBeNull();
    cleanup();
    const second = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: [], onApply },
    });
    await fireEvent.click(second.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByTestId("classement-class-ecarte"));
    expect(screen.getByTestId("classement-reasons-empty")).toBeTruthy();
    expect(screen.queryByTestId("classement-reason-none")).toBeNull();
  });

  it("criterion 3: Écarté offers no reason-free validation; Pertinent can validate without a reason", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByTestId("classement-class-ecarte"));
    expect(screen.queryByTestId("classement-reason-none")).toBeNull();
    cleanup();
    const second = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(second.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByTestId("classement-class-pertinent"));
    await fireEvent.click(screen.getByTestId("classement-reason-none"));
    expect(onApply).toHaveBeenCalledWith("pertinent", null);
    expect(DEFAULT_CLASSEMENT_FILTER.ecarte).toBe(false);
  });
});
