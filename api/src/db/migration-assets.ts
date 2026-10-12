import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface MigrationAsset {
  tag: string;
  when: number;
  checksum: string;
  statements: readonly string[];
}

/** Every SQL is accounted for, including the documented unjournaled 0009. */
export async function loadMigrationAssets(folder: string): Promise<readonly MigrationAsset[]> {
  const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const entries = journal.entries;
  if (!Array.isArray(entries) || entries.some((e, i) => e.idx !== i ||
      !/^\d{4}_[a-z0-9_]+$/.test(e.tag) || !Number.isSafeInteger(e.when))) {
    throw new Error("Invalid host migration journal");
  }
  const metadata = new Map(entries.map((e) => [e.tag, e.when]));
  if (metadata.size !== entries.length || new Set(entries.map((e) => e.when)).size !== entries.length) {
    throw new Error("Duplicate host migration identity or timestamp");
  }
  metadata.set("0009_account_invitations", 1781740000000);
  const files = (await readdir(folder)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  if (files.length !== metadata.size || files.some((f) => !metadata.has(f.slice(0, -4)))) {
    throw new Error("SQL inventory and host journal disagree");
  }
  return Promise.all(files.map(async (file) => {
    const bytes = await readFile(join(folder, file));
    const tag = file.slice(0, -4);
    return { tag, when: metadata.get(tag)!,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      statements: bytes.toString("utf8").split("--> statement-breakpoint") };
  }));
}
