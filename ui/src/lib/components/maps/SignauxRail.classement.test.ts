import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import SignauxRail from "./SignauxRail.svelte";

afterEach(() => cleanup());

describe("SignauxRail Pertinence dropdown — acceptance criteria", () => {
  it("criterion 1: Pertinence filter exists, checked by default except Écarté, with counts", async () => {
    const onClassementFilterChange = vi.fn();
    const view = render(SignauxRail, {
      props: {
        entries: [],
        classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
        classementCounts: { pertinent: 3, a_surveiller: 2, non_classe: 5, ecarte: 1 },
        onClassementFilterChange,
      },
    });
    // « Pertinence » is a field label like « Période des signaux », not an
    // uppercase collapsible section header.
    expect(view.container.textContent).toContain("Pertinence");
    expect(view.container.textContent).not.toContain("CLASSEMENT");

    // Dropdown closed by default: summary by class name, no counter.
    const trigger = view.getByTestId("classement-filter-trigger");
    expect(trigger.textContent).toContain("Pertinent, À surveiller, Non classé");
    expect(trigger.textContent).not.toContain("3 sur 4");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByTestId("classement-filter-panel")).toBeNull();
    expect(screen.queryByLabelText(/Pertinent/)).toBeNull();

    await fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = view.getByTestId("classement-filter-panel");
    expect(panel).toBeTruthy();
    // Counts in right-aligned pills inside the open list, not "(n)".
    expect(panel.textContent).not.toContain("(3)");
    const pills = panel.querySelectorAll(".st-badge");
    expect([...pills].map((pill) => pill.textContent?.trim())).toEqual(["3", "2", "5", "1"]);

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

    await fireEvent.click(trigger);
    expect(view.queryByTestId("classement-filter-panel")).toBeNull();
  });
});
