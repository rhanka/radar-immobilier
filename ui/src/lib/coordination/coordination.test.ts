import { describe, it, expect } from "vitest";
import { ROLE_LABELS_FR, radarPolicy, createJournal, appendDecision, summarizePolicy } from "./coordination.js";

describe("coordination roles + policy", () => {
  it("PRINCIPAL label says humain; 3 roles labelled", () => {
    expect(ROLE_LABELS_FR.principal).toContain("humain");
    expect(Object.keys(ROLE_LABELS_FR)).toHaveLength(3);
  });
  it("radarPolicy encodes anti-cheat + PRINCIPAL-is-human", () => {
    expect(radarPolicy.rules.some((r) => r.toLowerCase().includes("triche"))).toBe(true);
    expect(radarPolicy.rules.some((r) => r.includes("PRINCIPAL"))).toBe(true);
    expect(summarizePolicy(radarPolicy)).toContain(String(radarPolicy.rules.length));
  });
});

describe("append-only journal", () => {
  it("starts empty, append grows by 1 with id + at", () => {
    const j = createJournal();
    expect(j.entries).toHaveLength(0);
    const e = appendDecision(j, { who: "fabien", role: "principal", action: "qualifier" });
    expect(e.id).toBeTruthy();
    expect(e.at).toBeTruthy();
    expect(j.entries).toHaveLength(1);
    appendDecision(j, { who: "fabien", role: "principal", action: "surveiller" });
    expect(j.entries).toHaveLength(2);
  });
  it("is append-only: entries array is frozen so caller cannot corrupt internal state", () => {
    const j = createJournal();
    appendDecision(j, { who: "x", role: "principal", action: "a" });
    expect(Object.isFrozen(j.entries)).toBe(true);
    expect(j.entries).toHaveLength(1);
  });
});
