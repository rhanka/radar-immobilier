import { describe, it, expect } from "vitest";
import { filterRealMode, type MaybeSimulated } from "./real-boundary.js";

describe("real-mode boundary (§2.7)", () => {
  it("excludes mode=simulation rows", () => {
    const rows: MaybeSimulated[] = [{ id: "1", mode: "real" }, { id: "2", mode: "simulation" }];
    expect(filterRealMode(rows).map((r) => r["id"])).toEqual(["1"]);
  });
  it("excludes verification=simulé evidence", () => {
    const evidence: MaybeSimulated[] = [{ sourceId: "e1", verification: "fait" }, { sourceId: "e2", verification: "simulé" }];
    expect(filterRealMode(evidence).map((e) => e["sourceId"])).toEqual(["e1"]);
  });
  it("keeps items that have neither field", () => {
    const items: MaybeSimulated[] = [{ id: "x" }, { id: "y" }];
    expect(filterRealMode(items)).toHaveLength(2);
  });
  it("drops an item that is simulation by either field", () => {
    const items: MaybeSimulated[] = [
      { id: "ok", mode: "real", verification: "fait" },
      { id: "m", mode: "simulation", verification: "fait" },
      { id: "v", mode: "real", verification: "simulé" },
    ];
    expect(filterRealMode(items).map((i) => i["id"])).toEqual(["ok"]);
  });
});
