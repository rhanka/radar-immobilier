/**
 * 6G migration static guard: the authority schema carries explicit identity,
 * revisions, and append-only audit, with no operational data baked in.
 */
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob<string>(
  ["../../../drizzle/0017_workspace_memberships.sql", "../../../drizzle/meta/_journal.json"],
  { eager: true, query: "?raw", import: "default" },
);

function source(name: string): string {
  const text = SOURCES[name];
  if (typeof text !== "string") throw new Error(`missing source: ${name}`);
  return text;
}

const migration = (): string => source("../../../drizzle/0017_workspace_memberships.sql");
const journal = (): string => source("../../../drizzle/meta/_journal.json");

describe("workspace membership migration", () => {
  it("should create the workspace, membership, and audit tables", () => {
    const sql = migration();
    for (const table of ["workspaces", "workspace_memberships", "workspace_membership_events"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`, "i"));
    }
  });

  it("should keep the audit trail append-only", () => {
    const sql = migration();
    expect(sql).toMatch(/workspace_membership_events_immutable/i);
    expect(sql).toMatch(/append-only/i);
    expect(sql).not.toMatch(/UPDATE\s+workspace_membership_events\s+SET/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+workspace_membership_events/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });

  it("should carry revisions, separate capabilities, and revocation state", () => {
    const sql = migration();
    expect(sql).toMatch(/revision\s+integer/i);
    expect(sql).toMatch(/moderate_archive\s+boolean/i);
    expect(sql).toMatch(/manage_members\s+boolean/i);
    expect(sql).toMatch(/IN\s*\('active'\s*,\s*'revoked'\)/i);
    expect(sql).toMatch(/capability_granted/i);
    expect(sql).toMatch(/capability_revoked/i);
  });

  it("should register the migration after 0016 without touching history", () => {
    const entries = JSON.parse(journal()).entries as Array<{ idx: number; tag: string; when: number }>;
    const found = entries.find((entry) => entry.tag === "0017_workspace_memberships");
    expect(found?.idx).toBe(16);
    expect(entries.filter((entry) => entry.idx === 16)).toHaveLength(1);
    expect(entries.some((entry) => entry.tag === "0016_artifacts_lifecycle")).toBe(true);
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
    expect(entries[15]?.tag).toBe("0016_artifacts_lifecycle");
    expect(found!.when).toBeGreaterThan(Math.max(...entries.slice(0, found!.idx).map((entry) => entry.when)));
  });

  it("should bake in no operational identity or account data", () => {
    const sql = migration();
    expect(sql).not.toMatch(/chaperon/i);
    expect(sql).not.toMatch(/@/);
    expect(sql).not.toMatch(/example\.(com|invalid)/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+workspace/i);
  });
});
