import { describe, it, expect } from "vitest";
import {
  createJournal,
  submitInstruction,
} from "$lib/coordination/coordination.js";
import type { CoordinationJournalEntry } from "$lib/coordination/coordination.js";

describe("CoordinationView — submitInstruction (stub chat logic)", () => {
  it("appends exactly 2 entries (principal + conductor) on a single submit", () => {
    const journal = createJournal();
    expect(journal.entries).toHaveLength(0);
    submitInstruction(journal, "qualifier H-609-4 avec expert");
    expect(journal.entries).toHaveLength(2);
  });

  it("first appended entry is PRINCIPAL with the typed text as action", () => {
    const journal = createJournal();
    submitInstruction(journal, "qualifier H-609-4 avec expert");
    const entries = journal.entries as readonly CoordinationJournalEntry[];
    expect(entries[0].role).toBe("principal");
    expect(entries[0].action).toBe("qualifier H-609-4 avec expert");
    expect(entries[0].who).toBe("Vous");
  });

  it("second appended entry is CONDUCTOR with a 'simulée' action", () => {
    const journal = createJournal();
    submitInstruction(journal, "qualifier H-609-4 avec expert");
    const entries = journal.entries as readonly CoordinationJournalEntry[];
    expect(entries[1].role).toBe("conductor");
    expect(entries[1].action).toContain("simulée");
    expect(entries[1].who).toBe("Assistant");
  });

  it("multiple submits accumulate correctly (grows by 2 each time)", () => {
    const journal = createJournal();
    submitInstruction(journal, "première instruction");
    expect(journal.entries).toHaveLength(2);
    submitInstruction(journal, "deuxième instruction");
    expect(journal.entries).toHaveLength(4);
  });

  it("conductor entry note mentions démo / no real generation", () => {
    const journal = createJournal();
    const [, conductor] = submitInstruction(journal, "test");
    expect(conductor.note).toBeTruthy();
    expect(conductor.note!.toLowerCase()).toMatch(/démo|aucune/);
  });

  it("works with seed entries: total grows from seed length + 2", () => {
    const now = new Date().toISOString();
    const seed = [
      { id: "j-seed-1", who: "Vous", role: "principal" as const, action: "qualifier avec expert", at: now },
    ];
    const journal = createJournal(seed);
    expect(journal.entries).toHaveLength(1);
    submitInstruction(journal, "nouvelle instruction");
    expect(journal.entries).toHaveLength(3);
  });
});
