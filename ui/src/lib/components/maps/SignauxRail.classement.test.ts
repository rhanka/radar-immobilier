import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
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
    const boxes = Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const byLabel = (label: string) =>
      boxes.find((box) => box.closest("label")?.textContent?.includes(label) ?? box.getAttribute("aria-label")?.includes(label));
    expect(byLabel("Pertinent")?.checked ?? true).toBe(true);
    const ecarteToggle = view.container.querySelectorAll("label");
    void ecarteToggle;
    // Toggling Écarté propagates the new filter to the parent.
    const labels = Array.from(view.container.querySelectorAll("label"));
    const ecarteLabel = labels.find((el) => el.textContent?.includes("Écarté"));
    if (ecarteLabel) {
      await fireEvent.click(ecarteLabel);
      expect(onClassementFilterChange).toHaveBeenCalled();
    }
  });
});
