import { describe, it, expect } from "vitest";
import { JournalEntry, Action } from "./journal.js";
describe("JournalEntry", () => {
  it("accepts an append-only decision with mode + supersedes", () => {
    expect(JournalEntry.safeParse({ id: "j2", who: "fabien", role: "PRINCIPAL",
      action: "qualifier-avec-expert", target: "d1", at: "2026-05-27T00:00:00Z",
      mode: "real", supersedes: "j1" }).success).toBe(true);
  });
  it("orders the engagement taxonomy", () => {
    expect(Action.options).toEqual([
      "rejeter","surveiller","qualifier-avec-expert","approcher-propriétaire","monter-dossier-acquisition"]);
  });
});
