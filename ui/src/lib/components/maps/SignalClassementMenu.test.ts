import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import SignalClassementMenu from "./SignalClassementMenu.svelte";
import { DEFAULT_CLASSEMENT_FILTER } from "$lib/signals/signal-classement.js";

afterEach(() => cleanup());

const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" as const },
  { code: "S-PLANIFIE", verdict: "a_surveiller" as const },
  { code: "N-NON-RES", verdict: "non_pertinent" as const },
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
    expect(view.getByTestId("classement-class-ecarte")).toBeTruthy();
    await fireEvent.click(view.getByTestId("classement-class-ecarte"));
    expect(view.getByTestId("classement-reason-N-NON-RES")).toBeTruthy();
    await fireEvent.click(view.getByTestId("classement-reason-N-NON-RES"));
    expect(onApply).toHaveBeenCalledWith("ecarte", "N-NON-RES");
  });

  it("criterion 3: Écarté offers no reason-free validation; Pertinent can validate without a reason", async () => {
    const onApply = vi.fn();
    const view = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(view.getByTestId("signal-classement-button"));
    await fireEvent.click(view.getByTestId("classement-class-ecarte"));
    expect(view.queryByTestId("classement-reason-none")).toBeNull();
    cleanup();
    const second = render(SignalClassementMenu, {
      props: { classe: "non_classe" as const, reasonCodes: CODES, onApply },
    });
    await fireEvent.click(second.getByTestId("signal-classement-button"));
    await fireEvent.click(second.getByTestId("classement-class-pertinent"));
    await fireEvent.click(second.getByTestId("classement-reason-none"));
    expect(onApply).toHaveBeenCalledWith("pertinent", null);
    expect(DEFAULT_CLASSEMENT_FILTER.ecarte).toBe(false);
  });
});
