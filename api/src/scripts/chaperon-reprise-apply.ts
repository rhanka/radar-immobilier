/**
 * chaperon-reprise-apply — governed, INSERT-ONLY write of the Chaperon
 * Immobilier triage (reference set C, 21/09 state) into the personal signal
 * facets of the given accounts of one workspace. PREPROD only.
 *
 * Input on stdin: the plan resolved by the read-only dry run of
 * `scripts/chaperon-reprise.mjs` (ids and codes, never sheet text).
 * Every insert goes through `writeScopedPersonalFacetInTx`, the writer behind
 * the UI (membership, scoped epoch, maintenance barrier, reason-code profile,
 * displayed fingerprint, expected head, receipt and command context).
 *
 * Insert-only (owner decision 2026-11-12): a target on which the account
 * already has ANY facet head is never touched; it is counted as `noop` when it
 * already holds the planned state, otherwise as `skipped` and listed.
 * One transaction for all accounts, all or nothing. Command keys are UUIDv5
 * over workspace, account, target, wanted state and fingerprint, so a retried
 * identical command replays its receipt. After the commit, every account is
 * re-read with `readClassificationHeads`, the head reader of baskets.search.v1.
 *
 * Usage (inside radar-api): node api/dist/scripts/chaperon-reprise-apply.js --apply --confirm <workspace-slug> < plan.json
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { accountUsers, facetStreams, workspaces } from "../db/schema.js";
import { writeScopedPersonalFacetInTx } from "../services/facets/scoped-writer.js";
import { resolveTarget, type SignalTarget } from "../services/facets/target.js";
import { readClassificationHeads, projectFacets } from "../services/facets/classification-heads.js";
import type { Basket, FacetCommand } from "../services/facets/writer.js";

type Verdict = "pertinent" | "a_surveiller" | "non_pertinent";
interface PlanTarget { row: number; citySlug: string; type: SignalTarget["type"]; id: string; verdict: Verdict; reasonCode: string }
interface Plan { workspaceSlug: string; ownerAccountIds: string[]; keyNamespace: string; manifestSha: string;
  mapping: string; targets: PlanTarget[] }

export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(Buffer.concat([Buffer.from(namespace.replace(/-/g, ""), "hex"),
    Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const x = hash.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(args: string[]): Promise<void> {
  const plan = JSON.parse(await readStdin()) as Plan;
  if (!args.includes("--apply") || args[args.indexOf("--confirm") + 1] !== plan.workspaceSlug) {
    throw new Error("usage: --apply --confirm <workspace-slug> (dry runs go through scripts/chaperon-reprise.mjs)");
  }
  if (!/^https:\/\/preprod\./.test(process.env.APP_BASE_URL ?? "")) throw new Error("refused: preprod only");
  const { db, pool } = createDb(loadConfig());
  try {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, plan.workspaceSlug));
    if (!ws) throw new Error("workspace not found");
    const owners = await db.select({ id: accountUsers.id, sub: accountUsers.sub }).from(accountUsers)
      .where(inArray(accountUsers.id, plan.ownerAccountIds));
    if (owners.length !== plan.ownerAccountIds.length || owners.some((o) => !o.sub)) throw new Error("account not found");
    const ordered = [...plan.targets].sort((a, b) => JSON.stringify([a.citySlug, a.type, a.id])
      .localeCompare(JSON.stringify([b.citySlug, b.type, b.id])));
    const applied = new Map(owners.map((o) => [o.id, { inserted: 0, noop: 0, skipped: [] as number[] }]));
    await db.transaction(async (tx) => {
      for (const owner of owners) {
        const tally = applied.get(owner.id)!;
        for (const t of ordered) {
          const target: SignalTarget = { citySlug: t.citySlug, type: t.type, id: t.id };
          const basket: Basket | null = t.verdict === "non_pertinent" ? null : t.verdict;
          const existing = await tx.select({ id: facetStreams.id }).from(facetStreams).where(and(
            eq(facetStreams.workspaceId, ws.id), eq(facetStreams.scope, "personal"), eq(facetStreams.ownerId, owner.id),
            eq(facetStreams.targetType, "signal"), eq(facetStreams.citySlug, t.citySlug),
            eq(facetStreams.nodeType, t.type), eq(facetStreams.nodeId, t.id)));
          if (existing.length > 0) { tally.skipped.push(t.row); continue; }
          const fingerprint = await resolveTarget(tx, target);
          const command: FacetCommand = {
            action: basket ? "select" : "discard", target, reasonCode: t.reasonCode, ...(basket ? { basket } : {}),
            expectedHeadId: null, displayedFingerprint: fingerprint,
            commandKey: uuidV5(plan.keyNamespace, JSON.stringify([ws.id, owner.id, t.citySlug, t.type, t.id,
              basket ? "selection" : "archive", basket, t.reasonCode, null, fingerprint])),
          };
          const event = await writeScopedPersonalFacetInTx(tx, owner.sub!, ws.id, command);
          if (event) tally.inserted += 1; else tally.noop += 1;
        }
      }
    });
    const accounts = [];
    const cities = [...new Set(plan.targets.map((t) => t.citySlug))].sort();
    for (const owner of owners) {
      const seen = { pertinent: 0, a_surveiller: 0, archive: 0 };
      const mismatchedRows: number[] = [];
      for (const city of cities) {
        const heads = await readClassificationHeads(db, owner.sub!, ws.id, city);
        for (const t of plan.targets.filter((entry) => entry.citySlug === city)) {
          const facets = projectFacets(heads, { citySlug: t.citySlug, type: t.type, id: t.id });
          const ok = t.verdict === "non_pertinent"
            ? facets.personalHidden && facets.archive.personal?.reason?.code === t.reasonCode
            : facets.selection[t.verdict]?.state === "active" && facets.selection[t.verdict]?.reason?.code === t.reasonCode;
          if (ok) seen[t.verdict === "non_pertinent" ? "archive" : t.verdict] += 1;
          else if (!applied.get(owner.id)!.skipped.includes(t.row)) mismatchedRows.push(t.row);
        }
      }
      const tally = applied.get(owner.id)!;
      accounts.push({ accountId: owner.id, applied: { inserted: tally.inserted, noop: tally.noop,
        skipped: tally.skipped.length, skippedRows: [...new Set(tally.skipped)] },
      readback: { cities: cities.length, ...seen, mismatchedRows } });
    }
    process.stdout.write(`${JSON.stringify({ workspaceId: ws.id, manifestSha: plan.manifestSha, mapping: plan.mapping, accounts })}\n`);
    if (accounts.some((a) => a.readback.mismatchedRows.length)) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const invoked = /(?:^|[/\\])chaperon-reprise-apply\.(ts|js)$/.test(process.argv[1] ?? "");
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
