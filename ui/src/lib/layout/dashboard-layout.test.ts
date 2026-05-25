import { describe, expect, it } from "vitest";
import { dashboardLayout } from "./dashboard-layout";

describe("dashboardLayout", () => {
  it("keeps chat in the right desktop column and moves map below the columns", () => {
    expect(dashboardLayout.topGrid).toContain(
      "xl:grid-cols-[320px_minmax(0,1fr)_minmax(340px,380px)]",
    );
    expect(dashboardLayout.chatColumn).toContain("xl:col-start-3");
    expect(dashboardLayout.chatColumn).toContain("xl:row-start-1");
    expect(dashboardLayout.mapRow).toContain("xl:col-span-3");
  });
});
