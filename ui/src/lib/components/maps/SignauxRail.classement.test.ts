import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import SignauxRail from "./SignauxRail.svelte";

afterEach(() => cleanup());

describe("SignauxRail Classement section — acceptance criteria", () => {
  it("criterion 1: Classement filter exists, checked by default except Écarté, with counts", async () => {
    const onClassementFilterChange = vi.fn();
    const view = render(SignauxRail, {
      props: {
        entries: [],
        classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
        classementCounts: { pertinent: 3, a_surveiller: 2, non_classe: 5, ecarte: 1 },
        onClassementFilterChange,
      },
    });
    expect(view.container.textContent).toContain("Classement");
    expect(view.container.textContent).toContain("Pertinent (3)");
    expect(view.container.textContent).toContain("Écarté (1)");

    // Non-vacuous: every checkbox must be found by its label text.
    const checkbox = (label: string): HTMLInputElement => {
      const el = screen.getByLabelText(new RegExp(label)) as HTMLInputElement;
      expect(el, `checkbox for ${label}`).toBeTruthy();
      expect(el.type).toBe("checkbox");
      return el;
    };
    expect(checkbox("Pertinent").checked).toBe(true);
    expect(checkbox("À surveiller").checked).toBe(true);
    expect(checkbox("Non classé").checked).toBe(true);
    expect(checkbox("Écarté").checked).toBe(false);

    await fireEvent.click(checkbox("Écarté"));
    expect(onClassementFilterChange).toHaveBeenCalledWith({
      pertinent: true, a_surveiller: true, non_classe: true, ecarte: true,
    });
  });
});
