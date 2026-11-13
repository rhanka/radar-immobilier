import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";

/** Only the viewer's personal feedback and the workspace's shared feedback. */
export async function readClassFeedback(db: Database, sub: string, workspaceId: string, citySlug?: string) {
  const actor = await approvedAccountId(db, sub, true);
  await resolveWorkspaceAccess(db, workspaceId, sub);
  const result = await db.execute(sql`SELECT f.id,f.node_type AS "nodeType",f.node_id AS "nodeId",
    f.city_slug AS "citySlug", f.verdict,f.human_class AS "humanClass",f.reason,f.reason_code AS "reasonCode",
    f.created_at::text AS "createdAt",f.model,f.prompt_sha256 AS "promptSha256",
    f.judged_class AS "judgedClass",f.event_id AS "eventId"
    FROM signal_class_feedback f
    WHERE f.workspace_id=${workspaceId} AND (f.scope='workspace' OR f.actor_id=${actor})
      ${citySlug ? sql`AND f.city_slug=${citySlug}` : sql``}
    ORDER BY f.created_at DESC,f.id DESC`);
  return result.rows;
}

export async function exportClassFeedback(db: Database, sub: string, workspaceId: string) {
  const rows = await readClassFeedback(db, sub, workspaceId);
  const groups = new Map<string, { model: string; promptSha256: string; up: number; down: number;
    positiveRate: number; confusions: Record<string, number> }>();
  for (const row of rows) {
    const key = JSON.stringify([row.model, row.promptSha256]);
    const group = groups.get(key) ?? { model: String(row.model), promptSha256: String(row.promptSha256),
      up: 0, down: 0, positiveRate: 0, confusions: {} };
    if (row.verdict === "up") group.up++; else group.down++;
    const pair = `${row.judgedClass}->${row.humanClass}`;
    group.confusions[pair] = (group.confusions[pair] ?? 0) + 1;
    group.positiveRate = group.up / (group.up + group.down);
    groups.set(key, group);
  }
  return { version: 1, visibility: "own-personal-and-workspace", rows, aggregates: [...groups.values()] };
}

/** A later manual edit replaces the feedback badge as well as the class. */
export async function readCurrentClassFeedback(db: Database, sub: string, workspaceId: string, citySlug: string) {
  const rows = await readClassFeedback(db, sub, workspaceId, citySlug);
  if (!rows.length) return rows;
  const heads = await db.execute(sql`SELECT event_id FROM facet_heads WHERE event_id IN (${sql.join(rows.map((row) => sql`${row.eventId}::uuid`), sql`,`)})`);
  const current = new Set(heads.rows.map((row) => row.event_id));
  return rows.filter((row) => current.has(row.eventId));
}
