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

  it("filter change → counts updated: Pertinence pills follow the new counts prop", async () => {
    const view = render(SignauxRail, {
      props: {
        entries: [],
        classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
        classementCounts: { pertinent: 3, a_surveiller: 2, non_classe: 5, ecarte: 1 },
        filtreCounts: { z: 4, r: 3, p: 2, piia: 1, derog: 1 },
      },
    });
    await fireEvent.click(view.getByTestId("classement-filter-trigger"));
    const pillsOf = (testid: string): string[] => {
      const panel = view.getByTestId(testid);
      return [...panel.querySelectorAll(".st-badge")].map((pill) => pill.textContent?.trim() ?? "");
    };
    expect(pillsOf("classement-filter-panel")).toEqual(["3", "2", "5", "1"]);
    // Simulate the parent recomputing after a Filtre/period change.
    await view.rerender({
      entries: [],
      classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
      classementCounts: { pertinent: 1, a_surveiller: 0, non_classe: 2, ecarte: 0 },
      filtreCounts: { z: 1, r: 1, p: 1, piia: 0, derog: 0 },
    });
    expect(pillsOf("classement-filter-panel")).toEqual(["1", "0", "2", "0"]);
  });

  it("Filtre options show counts in the same right-aligned pill style, reactive", async () => {
    const view = render(SignauxRail, {
      props: {
        entries: [],
        classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
        classementCounts: { pertinent: 3, a_surveiller: 2, non_classe: 5, ecarte: 1 },
        filtreCounts: { z: 4, r: 3, p: 2, piia: 1, derog: 6 },
      },
    });
    await fireEvent.click(view.getByTestId("filtre-trigger"));
    const panel = view.getByTestId("filtre-panel");
    const rows = [...panel.querySelectorAll(".classement-row")];
    expect(rows.map((row) => row.querySelector(".st-badge")?.textContent?.trim())).toEqual(["4", "3", "2", "1", "6"]);
    // Same pill mechanism as Pertinence: a Badge in each row, no scope caption.
    expect(panel.textContent).not.toContain("ville sélectionnée");
    await view.rerender({
      entries: [],
      classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
      classementCounts: { pertinent: 3, a_surveiller: 2, non_classe: 5, ecarte: 1 },
      filtreCounts: { z: 9, r: 8, p: 7, piia: 0, derog: 0 },
    });
    const updated = [...view.getByTestId("filtre-panel").querySelectorAll(".st-badge")].map((pill) => pill.textContent?.trim());
    expect(updated).toEqual(["9", "8", "7", "0", "0"]);
  });

  it("Filtre is a dropdown with the same field pattern as Pertinence", async () => {
    const view = render(SignauxRail, {
      props: {
        entries: [],
        classementFilter: { pertinent: true, a_surveiller: true, non_classe: true, ecarte: false },
        classementCounts: { pertinent: 3, a_surveiller: 2, non_classe: 5, ecarte: 1 },
      },
    });
    expect(view.container.textContent).toContain("Filtre");
    const trigger = view.getByTestId("filtre-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByTestId("filtre-panel")).toBeNull();
    await fireEvent.click(trigger);
    const panel = view.getByTestId("filtre-panel");
    expect(panel.textContent).toContain("Zonage");
    expect(panel.textContent).toContain("Exclure PIIA sans projet résidentiel");
    expect(panel.textContent).toContain("Exclure dérogations mineures");
  });
});
