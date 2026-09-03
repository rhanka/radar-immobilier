import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import AnnotationBadge from "./AnnotationBadge.svelte";

afterEach(() => cleanup());

describe("AnnotationBadge", () => {
  it("count 0 → rien rendu", () => {
    const { queryByTestId } = render(AnnotationBadge, { props: { count: 0 } });
    expect(queryByTestId("annotation-badge")).toBeNull();
  });

  it("count > 0 → pill avec le compteur + aria pluralisé", () => {
    const { getByTestId } = render(AnnotationBadge, { props: { count: 3 } });
    const badge = getByTestId("annotation-badge");
    expect(badge.textContent?.trim()).toBe("3");
    expect(badge.getAttribute("aria-label")).toBe("3 notes");
  });

  it("count 1 → aria au singulier", () => {
    const { getByTestId } = render(AnnotationBadge, { props: { count: 1 } });
    expect(getByTestId("annotation-badge").getAttribute("aria-label")).toBe("1 note");
  });
});
