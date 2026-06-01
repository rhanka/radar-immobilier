import { describe, expect, it } from "vitest";
import {
  BACKLOG_COLUMNS,
  backlogSeed,
  mergeBacklog,
  statutLabel,
  statutTone,
  type BacklogItem,
} from "./backlog-data.js";

describe("backlogSeed", () => {
  it("is non-empty and has the three statuses represented", () => {
    expect(backlogSeed.length).toBeGreaterThan(0);
    const statuses = new Set(backlogSeed.map((i) => i.statut));
    expect(statuses).toEqual(new Set(["a-faire", "en-cours", "realise"]));
  });

  it("has unique ids", () => {
    const ids = backlogSeed.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is faithful: ÉV15 is the in-progress item", () => {
    const enCours = backlogSeed.filter((i) => i.statut === "en-cours");
    expect(enCours.map((i) => i.code)).toContain("ÉV15");
  });

  it("realised items carry a known PR number", () => {
    const realised = backlogSeed.filter((i) => i.statut === "realise");
    expect(realised.length).toBeGreaterThan(0);
    for (const item of realised) {
      expect(typeof item.pr).toBe("number");
      expect(item.pr).toBeGreaterThan(0);
    }
  });

  it("ÉV1 maps to PR #18 (verified against merged history)", () => {
    const ev1 = backlogSeed.find((i) => i.code === "ÉV1");
    expect(ev1?.pr).toBe(18);
  });
});

describe("mergeBacklog", () => {
  it("dynamic items override seed items by id", () => {
    const dynamic: BacklogItem[] = [
      {
        id: "ev15-backlog",
        code: "ÉV15",
        titre: "x",
        description: "y",
        statut: "realise",
      },
    ];
    const merged = mergeBacklog(backlogSeed, dynamic);
    const ev15 = merged.find((i) => i.id === "ev15-backlog");
    expect(ev15?.statut).toBe("realise");
    // no duplicate
    expect(merged.filter((i) => i.id === "ev15-backlog")).toHaveLength(1);
  });

  it("appends brand new dynamic items", () => {
    const dynamic: BacklogItem[] = [
      { id: "new-thing", code: "Demande", titre: "t", description: "", statut: "a-faire" },
    ];
    const merged = mergeBacklog(backlogSeed, dynamic);
    expect(merged.some((i) => i.id === "new-thing")).toBe(true);
  });
});

describe("helpers", () => {
  it("statutLabel covers every column", () => {
    for (const col of BACKLOG_COLUMNS) {
      expect(statutLabel(col.statut)).toBe(col.label);
    }
  });

  it("statutTone maps each status to a DS tone", () => {
    expect(statutTone("realise")).toBe("success");
    expect(statutTone("en-cours")).toBe("info");
    expect(statutTone("a-faire")).toBe("neutral");
  });
});
