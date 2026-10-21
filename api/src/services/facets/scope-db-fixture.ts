// Disposable synthetic databases keep global cutover tests away from legacy suites.
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, describe } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../../config.js";
import { createDb } from "../../db/client.js";
import { accountUsers, facetEvents } from "../../db/schema.js";
import { initializeWorkspaceStore } from "../workspaces/init-store.js";
import { attachPersonalHistory } from "./attachment.js";
import type { ActivationSafety } from "./activation.js";

export const describeDb: ReturnType<typeof describe.skipIf> = describe.skipIf(process.env.LOT_MIGRATION_DB_TEST !== "1");
const handles: Array<ReturnType<typeof createDb> & { name: string }> = [];
export const safety: ActivationSafety = { drain: async () => {}, readback: async () => {} };

afterAll(async () => {
  if (handles.length === 0) return;
  const admin = createDb(loadConfig());
  for (const handle of handles) {
    await handle.pool.end();
    await admin.pool.query(`DROP DATABASE "${handle.name}" WITH (FORCE)`);
  }
  await admin.pool.end();
});

export async function database(legacy = false) {
  const name = `synthetic_6h_${randomUUID().replaceAll("-", "")}`;
  const admin = createDb(loadConfig());
  try { await admin.pool.query(`CREATE DATABASE "${name}"`); } finally { await admin.pool.end(); }
  const handle = { ...createDb({ ...loadConfig(), POSTGRES_DB: name }), name };
  handles.push(handle);
  if (legacy) {
    mkdirSync("tmp", { recursive: true });
    const folder = mkdtempSync("tmp/migrations-6h-");
    try {
      mkdirSync(`${folder}/meta`);
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 17);
      writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify(journal));
      for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, `${folder}/${entry.tag}.sql`);
      await migrate(handle.db, { migrationsFolder: folder });
    } finally { rmSync(folder, { recursive: true }); }
  } else await migrate(handle.db, { migrationsFolder: "drizzle" });
  return handle;
}

export async function fixture(legacy = false) {
  const handle = await database(legacy);
  const { db } = handle;
  const actor = { id: randomUUID(), sub: `synthetic-actor-${randomUUID()}` };
  const member = { id: randomUUID(), sub: `synthetic-member-${randomUUID()}` };
  for (const person of [actor, member]) await db.insert(accountUsers).values({ ...person, status: "approved" });
  const init = async () => initializeWorkspaceStore(db, {
    workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic 6H",
    approvedAccountIds: [actor.id, member.id], managerAccountIds: [actor.id],
    moderatorAccountIds: [], actorAccountId: actor.id, reason: "synthetic initialization",
  });
  const first = await init();
  const second = await init();
  return { ...handle, actor, member, workspaceId: first.workspaceId, otherId: second.workspaceId };
}

export type Fixture = Awaited<ReturnType<typeof fixture>>;
export async function attach(f: Fixture) {
  return attachPersonalHistory(f.db, { actorAccountId: f.actor.id, reason: "synthetic attachment",
    entries: [{ accountId: f.member.id, workspaceId: f.workspaceId }] });
}
export function activation(f: Fixture) {
  return { workspaceId: f.workspaceId, actorSub: f.actor.sub, reason: "synthetic activation" };
}
export async function event(f: Fixture, extra: Partial<typeof facetEvents.$inferInsert> = {}) {
  const [row] = await f.db.insert(facetEvents).values({
    ownerId: f.member.id, actorId: f.member.id, citySlug: "synthetic-city", nodeType: "Signal",
    nodeId: randomUUID(), facet: "selection", basket: "pertinent", state: "active",
    observedFingerprint: "a".repeat(64), commandKey: randomUUID(), commandDigest: "b".repeat(64), ...extra,
  }).returning();
  return row!;
}
