import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const migrations = [
  ["0014_artifacts_core", "0001_artifacts.sql", "7b12713b949a956ad0b4c370a16e80fb4625a99a5097769ed0653df5973dc533"],
  ["0015_artifacts_lifecycle", "0002_lifecycle.sql", "fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd"],
] as const;
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: { tag: string; when: number }[];
};
describe("artifact migration provenance", () => {
  it.each(migrations)("keeps %s identical to the exported package migration", (tag, source, expected) => {
    const copy = readFileSync(new URL(`../../drizzle/${tag}.sql`, import.meta.url));
    const original = readFileSync(createRequire(import.meta.url).resolve(`@sentropic/artifacts/migrations/${source}`));
    expect(copy.equals(original)).toBe(true);
    expect(createHash("sha256").update(copy).digest("hex")).toBe(expected);
  });
  it("appends unique increasing timestamps after every earlier migration", () => {
    const previousMax = Math.max(...journal.entries.slice(0, -2).map((e) => e.when));
    const tail = journal.entries.slice(-2);
    expect(tail.map((e) => e.tag)).toEqual(migrations.map(([tag]) => tag));
    expect(tail[0]!.when).toBeGreaterThan(previousMax);
    expect(tail[1]!.when).toBeGreaterThan(tail[0]!.when);
    expect(new Set(journal.entries.map((e) => e.when)).size).toBe(journal.entries.length);
  });
});
