import { describe, expect, it } from "vitest";
import {
  applyClassementToCityCounts,
  buildClassementMap,
  classementCounts,
  CLASSEMENT_META,
  DEFAULT_CLASSEMENT_FILTER,
  filterNodesByClassement,
  reasonCodesForClass,
  validateClassementChoice,
  type ReasonCodeEntry,
} from "./signal-classement.js";

const ENTRIES: ReasonCodeEntry[] = [
  { code: "P-DENSITE", verdict: "pertinent" },
  { code: "S-PLANIFIE", verdict: "a_surveiller" },
  { code: "N-NON-RES", verdict: "non_pertinent" },
];

function head(basket: string | null, state = "active", reasonCode: string | null = null, id = "sig-1") {
  return {
    target: { citySlug: "delson", type: "Signal", id },
    facet: basket ? "selection" : "archive",
    basket,
    state,
    reasonCode,
    id: `${basket ?? "archive"}-${id}`,
  };
}

describe("signal classement — acceptance criteria", () => {
  it("criterion 1: Classement filter exists, checked by default except Écarté, with counts", () => {
    expect(DEFAULT_CLASSEMENT_FILTER).toEqual({
      pertinent: true,
      a_surveiller: true,
      non_classe: true,
      ecarte: false,
    });
    const counts = classementCounts(["pertinent", "pertinent", "non_classe", "ecarte"]);
    expect(counts).toEqual({ pertinent: 2, a_surveiller: 0, non_classe: 1, ecarte: 1 });
  });

  it("criterion 2: each card class is derived from its basket/archive heads", () => {
    const map = buildClassementMap(
      [head("pertinent", "active", "P-DENSITE", "sig-1"), head("a_surveiller", "active", null, "sig-2")],
      [{ target: { citySlug: "delson", type: "Signal", id: "sig-3" }, personal: { id: "a3", state: "active", reasonCode: "N-NON-RES" }, workspace: null, effectiveDiscarded: true }],
    );
    expect(map.get("Signal:sig-1")?.classe).toBe("pertinent");
    expect(map.get("Signal:sig-1")?.reasonCode).toBe("P-DENSITE");
    expect(map.get("Signal:sig-2")?.classe).toBe("a_surveiller");
    expect(map.get("Signal:sig-3")?.classe).toBe("ecarte");
  });

  it("criterion 3: Écarté without an N-* reason is impossible; Pertinent/À surveiller without reason is possible", () => {
    expect(validateClassementChoice("ecarte", null, ENTRIES).ok).toBe(false);
    expect(validateClassementChoice("ecarte", "P-DENSITE", ENTRIES).ok).toBe(false);
    expect(validateClassementChoice("ecarte", "N-NON-RES", ENTRIES).ok).toBe(true);
    expect(validateClassementChoice("pertinent", null, ENTRIES).ok).toBe(true);
    expect(validateClassementChoice("a_surveiller", null, ENTRIES).ok).toBe(true);
    expect(validateClassementChoice("pertinent", "S-PLANIFIE", ENTRIES).ok).toBe(false);
    expect(reasonCodesForClass(ENTRIES, "ecarte").map((e) => e.code)).toEqual(["N-NON-RES"]);
  });

  it("criterion 4: discarding removes the card at once and decrements its city on the left", () => {
    const nodes = [{ id: "sig-1", type: "Signal" }, { id: "sig-2", type: "Signal" }];
    const before = buildClassementMap([head("pertinent", "active", null, "sig-1")], []);
    expect(filterNodesByClassement(nodes, before, DEFAULT_CLASSEMENT_FILTER)).toHaveLength(2);
    const after = buildClassementMap([], [
      { target: { citySlug: "delson", type: "Signal", id: "sig-1" }, personal: { id: "a1", state: "active", reasonCode: "N-NON-RES" }, workspace: null, effectiveDiscarded: true },
    ]);
    expect(filterNodesByClassement(nodes, after, DEFAULT_CLASSEMENT_FILTER).map((n) => n.id)).toEqual(["sig-2"]);
    const cities = applyClassementToCityCounts(
      [{ slug: "delson", classes: ["pertinent", "ecarte"] }, { slug: "candiac", classes: ["ecarte"] }],
      DEFAULT_CLASSEMENT_FILTER,
    );
    expect(cities.get("delson")).toBe(1);
    expect(cities.has("candiac")).toBe(false);
  });

  it("criterion 6: lucide icon names and DS semantic tokens only, no hex colour", () => {
    expect(CLASSEMENT_META.pertinent.icon).toBe("Target");
    expect(CLASSEMENT_META.a_surveiller.icon).toBe("Eye");
    expect(CLASSEMENT_META.ecarte.icon).toBe("EyeOff");
    expect(CLASSEMENT_META.non_classe.icon).toBe("CircleDashed");
    for (const meta of Object.values(CLASSEMENT_META)) {
      expect(meta.token).toContain("--st-semantic-");
      expect(meta.token).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});
