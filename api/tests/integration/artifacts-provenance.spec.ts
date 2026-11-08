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
 * fixed rewrite: the immo lock-timeout prefix (same convention as 0032-0035
 * and 0038: a blocked lock fails the migration after 5 s instead of queueing
 * every reader of artifacts.releases behind it) plus the idempotence rewrite
 * (every immo migration must replay on a prod-restore journal drift, see
 * migrate-idempotence.spec.ts). The provider file is pinned by hash and the
 * immo file must equal exactly the rewrite of it: no other byte may differ.
 */
const derivedMigrations = [
  // M2-I: SG1 bindings, audit and release index. Inert until the git mode flag selects a tool.
  ["0036_artifacts_git_bindings", "0010_git_bindings.sql",
    "896947eec4898a0918bab2f5d236718095296952ea37c1012fa448c779041de1",
    "465b3b22d12e4b299d5711338056649a718dde3ec6e1572d36d138ec4a48a571"],
  // SG3 git_attach intents (0.2.20): branch_created audit column + attach intent table. Inert until the flag selects git_attach.
  ["0040_artifacts_git_attach_intents", "0012_git_attach_intents.sql",
    "8cfb72c5337dcf6305909af52d789940d1944bcf5fca4e4e2d845d745c8d19f8",
    "621fa02397f0002f9e5e06bca1076be0a1c105d87342d14379f4bf4beb92ea02"],
  // Generic live invitations (0.2.22): session-bound invitations and epochs. Runs AFTER immo 0041, which drops the
  // table of the immo store (0038) the package migration re-creates under the same name (its guard refuses a foreign one).
  ["0042_artifacts_live_invitations", "0013_live_invitations.sql",
    "fb839f4579df640032a16cadc7cf66a987542701ba853a78e5889d0a2a31f65b",
    "a9deebcde5819871e63ff9c40a6436933d64b775a600ae99843deee6a945f336"],
] as const;

const IDEMPOTENCE_REWRITE: readonly (readonly [RegExp, string])[] = [
  [/^CREATE UNIQUE INDEX (?!IF NOT EXISTS )/gm, "CREATE UNIQUE INDEX IF NOT EXISTS "],
  [/^CREATE INDEX (?!IF NOT EXISTS )/gm, "CREATE INDEX IF NOT EXISTS "],
  [/^CREATE TABLE (?!IF NOT EXISTS )/gm, "CREATE TABLE IF NOT EXISTS "],
  [/ ADD COLUMN (?!IF NOT EXISTS )/g, " ADD COLUMN IF NOT EXISTS "],
  [/^ALTER TABLE (\S+) ADD CONSTRAINT (\S+)/gm, "ALTER TABLE $1 DROP CONSTRAINT IF EXISTS $2, ADD CONSTRAINT $2"],
  [/^CREATE FUNCTION /gm, "CREATE OR REPLACE FUNCTION "],
  [/^CREATE TRIGGER /gm, "CREATE OR REPLACE TRIGGER "],
];
const LOCK_TIMEOUT_PREFIX = "SET LOCAL lock_timeout = '5s';\n--> statement-breakpoint\n";
const rewrite = (sql: string) => LOCK_TIMEOUT_PREFIX +
  IDEMPOTENCE_REWRITE.reduce((text, [pattern, value]) => text.replace(pattern, value), sql);

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
  it.each(derivedMigrations)("derives %s from the pinned package migration by the lock-timeout and idempotence rewrite only",
    (tag, source, providerHash, expected) => {
      const original = provider(source);
      expect(sha256(original)).toBe(providerHash);
      const bytes = copy(tag);
      expect(bytes.toString("utf8")).toBe(rewrite(original.toString("utf8")));
      expect(sha256(bytes)).toBe(expected);
    });
  it("applies the package live invitations migration 0013 (immo 0042) after the immo drop 0041", () => {
    const tags = journal.entries.map((entry) => entry.tag);
    const drop = tags.indexOf("0041_drop_artifacts_live_invitations");
    const invitations = tags.indexOf("0042_artifacts_live_invitations");
    expect(drop).toBeGreaterThan(-1);
    expect(invitations).toBe(drop + 1);
    expect(journal.entries[invitations]!.when).toBeGreaterThan(journal.entries[drop]!.when);
    // 0038 (immo store) < 0041 (drop) < 0042 (package): the package guard would refuse the old table.
    expect(tags.indexOf("0038_artifacts_live_invitations")).toBeLessThan(drop);
    expect(copy("0041_drop_artifacts_live_invitations").toString("utf8")).toContain("live invitations not empty");
    expect(copy("0042_artifacts_live_invitations").toString("utf8")).toContain("live invitations schema mismatch");
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
