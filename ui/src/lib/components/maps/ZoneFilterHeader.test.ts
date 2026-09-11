import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { ZoneKindGroupId } from "$lib/maps/zone-kind-filter.js";
import ZoneFilterHeader from "./ZoneFilterHeader.svelte";

describe("ZoneFilterHeader", () => {
  it("should label the additive control as a zone type filter", () => {
    render(ZoneFilterHeader, {
      props: {
        zones: [{ kind: null, code: "H-12" }],
        filter: new Set<ZoneKindGroupId>(),
      },
    });

    expect(screen.getByText("Filtrer par type")).toBeTruthy();
    expect(screen.getByRole("group", {
      name: "Filtre par type de zone (additif)",
    })).toBeTruthy();
  });
});
