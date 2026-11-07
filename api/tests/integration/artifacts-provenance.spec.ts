import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/** Byte copies of provider migrations that are already replay-idempotent. */
const migrations = [
  ["0015_artifacts_core", "0001_artifacts.sql", "7b12713b949a956ad0b4c370a16e80fb4625a99a5097769ed0653df5973dc533"],
  ["0016_artifacts_lifecycle", "0002_lifecycle.sql", "fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd"],
  // M4-I: private live drafts, commands and commit quota. Inert until a live tool is selected.
  ["0037_artifacts_live_drafts", "0011_live_drafts.sql", "cc5399440c5531224fdd99337703cf3caebdd39d0f79df527efe3b6d6edf3fa4"],
] as const;

/**
 * Provider migrations that are NOT replay-idempotent, adopted through one
 * fixed idempotence rewrite (every immo migration must replay on a
 * prod-restore journal drift, see migrate-idempotence.spec.ts). The provider
 * file is pinned by hash and the immo file must equal exactly the rewrite of
 * it: no other byte may differ.
 */
const derivedMigrations = [
  // M2-I: SG1 bindings, audit and release index. Inert until the git mode flag selects a tool.
  ["0036_artifacts_git_bindings", "0010_git_bindings.sql",
    "896947eec4898a0918bab2f5d236718095296952ea37c1012fa448c779041de1",
    "b2c4b1cf4eadd747464afa8548c36b40ee3b99b549aa2c267fd70dfbcc466c60"],
] as const;

const IDEMPOTENCE_REWRITE: readonly (readonly [RegExp, string])[] = [
  [/^CREATE UNIQUE INDEX (?!IF NOT EXISTS )/gm, "CREATE UNIQUE INDEX IF NOT EXISTS "],
  [/^CREATE INDEX (?!IF NOT EXISTS )/gm, "CREATE INDEX IF NOT EXISTS "],
  [/^CREATE TABLE (?!IF NOT EXISTS )/gm, "CREATE TABLE IF NOT EXISTS "],
  [/ ADD COLUMN (?!IF NOT EXISTS )/g, " ADD COLUMN IF NOT EXISTS "],
  [/^CREATE FUNCTION /gm, "CREATE OR REPLACE FUNCTION "],
  [/^CREATE TRIGGER /gm, "CREATE OR REPLACE TRIGGER "],
];
const idempotent = (sql: string) => IDEMPOTENCE_REWRITE.reduce((text, [pattern, value]) => text.replace(pattern, value), sql);

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const provider = (source: string) => readFileSync(createRequire(import.meta.url).resolve(`@sentropic/artifacts/migrations/${source}`));
const copy = (tag: string) => readFileSync(new URL(`../../drizzle/${tag}.sql`, import.meta.url));

const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: { tag: string; when: number }[];
};
describe("artifact migration provenance", () => {
  it.each(migrations)("keeps %s identical to the exported package migration", (tag, source, expected) => {
    const bytes = copy(tag);
    expect(bytes.equals(provider(source))).toBe(true);
    expect(sha256(bytes)).toBe(expected);
  });
  it.each(derivedMigrations)("derives %s from the pinned package migration by the idempotence rewrite only",
    (tag, source, providerHash, expected) => {
      const original = provider(source);
      expect(sha256(original)).toBe(providerHash);
      const bytes = copy(tag);
      expect(bytes.toString("utf8")).toBe(idempotent(original.toString("utf8")));
      expect(sha256(bytes)).toBe(expected);
    });
  it("appends unique increasing timestamps after every earlier migration", () => {
    let previousIndex = -1;
    for (const [tag] of [...migrations, ...derivedMigrations].sort((a, b) => a[0].localeCompare(b[0]))) {
      const matches = journal.entries.filter((entry) => entry.tag === tag);
      expect(matches).toHaveLength(1);
      const index = journal.entries.findIndex((entry) => entry.tag === tag);
      expect(index).toBeGreaterThan(previousIndex);
      const previousMax = Math.max(...journal.entries.slice(0, index).map((entry) => entry.when));
      expect(matches[0]!.when).toBeGreaterThan(previousMax);
      previousIndex = index;
    }
    expect(new Set(journal.entries.map((e) => e.when)).size).toBe(journal.entries.length);
  });
});
