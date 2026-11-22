/**
 * chaperon-reprise-apply — governed, INSERT-ONLY write of the Chaperon
 * Immobilier triage (reference set C, 21/09 state) into the personal signal
 * facets of the given accounts of one workspace.
 *
 * Preprod CLI (`scripts/chaperon-reprise.mjs`) passes a resolved Plan on stdin
 * with `--apply --confirm <workspace-slug>` (preprod-only by default).
 *
 * Prod CD (`.github/workflows/chaperon-reprise-prod.yml`) invokes this image
 * entrypoint with `--allow-prod` and either `--dry-run` or
 * `--apply --confirm <workspace-slug>`, supplying the raw built plan via
 * `CHAPERON_REPRISE_PLAN_B64` (base64 JSON) or stdin. Dry-run executes inside
 * one REPEATABLE READ READ ONLY transaction (always rolled back); apply runs
 * the same resolution check first, refuses on any mismatch/conflict, then
 * writes insert-only via `writeScopedPersonalFacetInTx` (`source='manual'`).
 *
 * Usage (inside radar-api):
 *   node api/dist/scripts/chaperon-reprise-apply.js --apply --confirm <workspace-slug> < plan.json
 *   node api/dist/scripts/chaperon-reprise-apply.js --dry-run --allow-prod
 *   node api/dist/scripts/chaperon-reprise-apply.js --apply --confirm <workspace-slug> --allow-prod
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type pg from "pg";
import { loadConfig } from "../config.js";
import { createDb, type Database } from "../db/client.js";
import { accountUsers, facetEvents, facetHeads, facetStreams, workspaces } from "../db/schema.js";
import { lockWorkspace } from "../services/workspaces/mutations.js";
import { writeScopedPersonalFacetInTx } from "../services/facets/scoped-writer.js";
import { resolveTarget, type SignalTarget } from "../services/facets/target.js";
import { readClassificationHeads, projectFacets } from "../services/facets/classification-heads.js";
import type { Basket, FacetCommand } from "../services/facets/writer.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Verdict = "pertinent" | "a_surveiller" | "non_pertinent";
export interface PlanTarget { row: number; citySlug: string; type: SignalTarget["type"]; id: string; verdict: Verdict; reasonCode: string }
export interface Plan { workspaceSlug: string; ownerAccountIds: string[]; keyNamespace: string; manifestSha: string;
  mapping: string; targets: PlanTarget[]; expectedInserts?: Record<string, number> }
export interface RawCitationSegment { page: number | null; norm: string }
export interface RawPlanTarget {
  row: number;
  citySlugHint: string;
  nodeId: string;
  verdict: Verdict;
  reasonCode: string;
  rawRefs: string[];
  citations: RawCitationSegment[];
}
export interface RawPlan {
  workspaceSlug: string;
  ownerEmailDomain: string;
  ownerAccountIds: string[];
  profile: string;
  keyNamespace: string;
  manifestSha: string;
  mapping: string;
  keyOnly?: boolean;
  targets: RawPlanTarget[];
}
export interface DryRunAccountSummary {
  accountId: string;
  approved: boolean;
  member: boolean;
  attachedHere: boolean;
  unresolvedHistory: number;
  writable: boolean;
  plan: { insert: number; noop: number; skipExisting: Array<{ row: number; id: string; existing: string[] }> };
  expectedReadback: { cities: number; pertinent: number; a_surveiller: number; archive: number };
}
export interface DryRunResult {
  mode: "dry-run";
  insertOnly: true;
  database: { database: string; read_only: string };
  workspace: { id: string; slug: string };
  activation: { writer_epoch: string; maintenance_barrier: boolean; old_index_dropped: boolean } | undefined;
  reasonCodes: { profile: string; inProfile: number; used: number; mismatched: Array<{ row: number; code: string }> };
  match: {
    targets: number;
    resolvedTargets: number;
    exact: number;
    exactSameDocument: number;
    exactOtherDocument: Array<{ row: number; nodeRawRef: string }>;
    byKey: number;
    byKeySameId: number;
    ambiguous: Array<{ row: number; nodeId: string; candidates: number }>;
    notFound: Array<{ row: number; nodeId: string }>;
    resolvedDuplicates: Array<{ rows: number[]; id: string }>;
    resolvedConflicts: Array<{ rows: number[]; id: string }>;
  };
  targets: PlanTarget[];
  accounts: DryRunAccountSummary[];
  writable: boolean;
}
export interface ApplyHooks { beforeWrite?: (tx: Tx, ownerSub: string, workspaceId: string, target: SignalTarget) => Promise<void> }

export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(Buffer.concat([Buffer.from(namespace.replace(/-/g, ""), "hex"),
    Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const x = hash.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Deterministic key of the single insert this reprise may make for one account and target. */
export function repriseCommandKey(plan: Pick<Plan, "keyNamespace">, workspaceId: string, ownerId: string, t: PlanTarget): string {
  const basket = t.verdict === "non_pertinent" ? null : t.verdict;
  return uuidV5(plan.keyNamespace, JSON.stringify([workspaceId, ownerId, t.citySlug, t.type, t.id,
    basket ? "selection" : "archive", basket, t.reasonCode]));
}

export function resolveRepriseBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.APP_BASE_URL?.trim();
  if (explicit) return explicit;
  const callback = env.AUTH_CALLBACK_BASE_URL?.trim();
  return callback || undefined;
}

export function assertAllowedBaseUrl(baseUrl: string | undefined, allowProd: boolean): void {
  const value = baseUrl ?? "";
  if (allowProd) {
    if (!/^https:\/\/(preprod\.)?immo\.sent-tech\.ca(?:\/|$)/.test(value)) {
      throw new Error("refused: unrecognized APP_BASE_URL for prod/preprod reprise");
    }
    return;
  }
  if (!/^https:\/\/preprod\./.test(value)) {
    throw new Error("refused: preprod only");
  }
}

const normText = (s: unknown): string => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const lcp = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return i;
};

interface GraphNodeRow {
  id: string;
  city_slug: string;
  type: SignalTarget["type"];
  label: string;
  source_ref: string | null;
  props: { refs?: Array<{ rawRef?: string; citation?: string; excerpt?: string; page?: number }> } | null;
}

/** Read-only resolution and plan verification inside one REPEATABLE READ READ ONLY transaction. */
export async function dryRunReprise(pool: pg.Pool, plan: RawPlan): Promise<DryRunResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const one = async <T = Record<string, unknown>>(q: string, args: unknown[] = []): Promise<T[]> =>
      (await client.query(q, args)).rows as T[];

    const [database] = await one<{ database: string; read_only: string }>(
      "SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only",
    );
    const [ws] = await one<{ id: string; slug: string }>("SELECT id, slug FROM workspaces WHERE slug = $1", [plan.workspaceSlug]);
    if (!ws) throw new Error("workspace not found");
    const [activation] = await one<{ writer_epoch: string; maintenance_barrier: boolean; old_index_dropped: boolean }>(
      "SELECT writer_epoch, maintenance_barrier, old_index_dropped FROM facet_activation_state WHERE workspace_id = $1",
      [ws.id],
    );
    const members = await one<{
      account_id: string; status: string; account_status: string; domain: string;
      attachment: string | null; attached_here: boolean | null;
    }>(
      `SELECT m.account_id, m.status, u.status AS account_status, split_part(u.email, '@', 2) AS domain,
        a.status AS attachment, a.workspace_id = m.workspace_id AS attached_here
       FROM workspace_memberships m
       JOIN account_users u ON u.id = m.account_id
       LEFT JOIN facet_stream_attachments a ON a.account_id = m.account_id
       WHERE m.workspace_id = $1`,
      [ws.id],
    );
    const wanted = plan.ownerAccountIds.length > 0
      ? plan.ownerAccountIds
      : members.filter((m) => m.domain === plan.ownerEmailDomain).map((m) => m.account_id);
    if (wanted.length === 0) throw new Error("no owner account");
    const owners = wanted.map((id) => {
      const m = members.find((entry) => entry.account_id === id);
      return {
        accountId: id,
        approved: m?.account_status === "approved",
        member: m?.status === "active",
        attachedHere: m?.attachment === "attached" && m?.attached_here === true,
      };
    });

    const codes = new Map((await one<{ code: string; verdict: string }>(
      "SELECT code, verdict FROM facet_reason_codes WHERE profile_id = $1",
      [plan.profile],
    )).map((r) => [r.code, r.verdict]));
    const reasonCodes = {
      profile: plan.profile,
      inProfile: codes.size,
      used: new Set(plan.targets.map((t) => t.reasonCode)).size,
      mismatched: plan.targets.filter((t) => codes.get(t.reasonCode) !== t.verdict)
        .map((t) => ({ row: t.row, code: t.reasonCode })),
    };

    const nodes = await one<GraphNodeRow>(
      "SELECT id, city_slug, type, label, source_ref, props FROM graph_nodes WHERE id = ANY($1) AND type IN ('Signal', 'DesignationEvent')",
      [plan.targets.map((t) => t.nodeId)],
    );
    const byId = new Map<string, GraphNodeRow[]>();
    for (const n of nodes) byId.set(n.id, [...(byId.get(n.id) ?? []), n]);
    const refsOf = (n: GraphNodeRow) => (Array.isArray(n.props?.refs) ? n.props!.refs : []);
    const citySlugs = new Set((await one<{ city_slug: string }>(
      "SELECT DISTINCT city_slug FROM graph_nodes WHERE type IN ('Signal', 'DesignationEvent')",
    )).map((r) => r.city_slug));

    const match = {
      exact: 0,
      exactSameDocument: 0,
      exactOtherDocument: [] as Array<{ row: number; nodeRawRef: string }>,
      byKey: 0,
      byKeySameId: 0,
      ambiguous: [] as Array<{ row: number; nodeId: string; candidates: number }>,
      notFound: [] as Array<{ row: number; nodeId: string }>,
      resolvedDuplicates: [] as Array<{ rows: number[]; id: string }>,
      resolvedConflicts: [] as Array<{ rows: number[]; id: string }>,
    };
    const resolved: Array<{ t: RawPlanTarget; n: GraphNodeRow }> = [];
    for (const t of plan.targets) {
      const all = byId.get(t.nodeId) ?? [];
      const exact = all.filter((n) => n.city_slug === t.citySlugHint || all.length === 1);
      if (!plan.keyOnly && exact.length === 1) {
        const docs = refsOf(exact[0]!).map((r) => r.rawRef).filter((d): d is string => typeof d === "string");
        match.exact += 1;
        if (t.rawRefs.length === 0 || docs.some((d) => t.rawRefs.includes(d))) match.exactSameDocument += 1;
        else match.exactOtherDocument.push({ row: t.row, nodeRawRef: docs.length > 0 ? "different" : "absent" });
        resolved.push({ t, n: exact[0]! });
        continue;
      }
      const stem = t.nodeId.replace(/^(signal|event)-/, "");
      const city = citySlugs.has(t.citySlugHint) ? t.citySlugHint
        : [...citySlugs].filter((s) => stem.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0];
      let candidates: GraphNodeRow[] = !city || t.rawRefs.length === 0 ? [] : await one<GraphNodeRow>(
        `SELECT id, city_slug, type, label, source_ref, props FROM graph_nodes g
         WHERE city_slug = $1 AND type IN ('Signal', 'DesignationEvent') AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.props->'refs') = 'array' THEN g.props->'refs' ELSE '[]'::jsonb END) r
           WHERE r->>'rawRef' = ANY($2))`,
        [city, t.rawRefs],
      );
      if (city && candidates.length === 0) {
        candidates = await one<GraphNodeRow>(
          "SELECT id, city_slug, type, label, source_ref, props FROM graph_nodes WHERE city_slug = $1 AND type IN ('Signal', 'DesignationEvent')",
          [city],
        );
      }
      const keyed = candidates.filter((n) => refsOf(n).some((r) => {
        const q = normText(r.citation || r.excerpt).slice(0, 80);
        return q.length >= 20 && t.citations.some((seg) => (seg.page === null || Number(r.page) === seg.page)
          && seg.norm.length >= 20 && (q.startsWith(seg.norm) || seg.norm.startsWith(q)));
      }));
      const best = Math.max(-1, ...keyed.map((n) => lcp(n.id, t.nodeId)));
      const top = keyed.filter((n) => lcp(n.id, t.nodeId) === best);
      if (top.length === 1) {
        match.byKey += 1;
        if (top[0]!.id === t.nodeId) match.byKeySameId += 1;
        resolved.push({ t, n: top[0]! });
      } else if (top.length > 1) {
        match.ambiguous.push({ row: t.row, nodeId: t.nodeId, candidates: top.length });
      } else {
        match.notFound.push({ row: t.row, nodeId: t.nodeId });
      }
    }

    const byNode = new Map<string, Array<{ t: RawPlanTarget; n: GraphNodeRow }>>();
    for (const entry of resolved) {
      const k = JSON.stringify([entry.n.city_slug, entry.n.type, entry.n.id]);
      byNode.set(k, [...(byNode.get(k) ?? []), entry]);
    }
    const unique: Array<{ t: RawPlanTarget; n: GraphNodeRow }> = [];
    for (const group of byNode.values()) {
      const rows = group.map((g) => g.t.row);
      if (group.some((g) => g.t.verdict !== group[0]!.t.verdict || g.t.reasonCode !== group[0]!.t.reasonCode)) {
        match.resolvedConflicts.push({ rows, id: group[0]!.n.id });
        continue;
      }
      if (group.length > 1) match.resolvedDuplicates.push({ rows, id: group[0]!.n.id });
      unique.push(group[0]!);
    }

    const resolvedTargets: PlanTarget[] = unique.map(({ t, n }) => ({
      row: t.row, citySlug: n.city_slug, type: n.type, id: n.id, verdict: t.verdict, reasonCode: t.reasonCode,
    }));

    const accounts: DryRunAccountSummary[] = [];
    for (const owner of owners) {
      const [unresolved] = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM facet_events e
         LEFT JOIN facet_event_bindings b ON b.event_id = e.id WHERE e.owner_id = $1 AND b.event_id IS NULL`,
        [owner.accountId],
      );
      const heads = await one<{
        city_slug: string; node_type: string; node_id: string; facet: string;
        basket: string | null; state: string; reason_code: string | null; command_key: string;
      }>(
        `SELECT s.city_slug, s.node_type, s.node_id, s.facet, s.basket, e.state, e.reason_code, e.command_key
         FROM facet_streams s JOIN facet_heads h ON h.stream_id = s.id JOIN facet_events e ON e.id = h.event_id
         WHERE s.workspace_id = $1 AND s.scope = 'personal' AND s.owner_id = $2 AND s.target_type = 'signal'`,
        [ws.id, owner.accountId],
      );
      const byTarget = new Map<string, typeof heads>();
      for (const h of heads) {
        const k = JSON.stringify([h.city_slug, h.node_type, h.node_id]);
        byTarget.set(k, [...(byTarget.get(k) ?? []), h]);
      }
      const accountPlan = { insert: 0, noop: 0, skipExisting: [] as Array<{ row: number; id: string; existing: string[] }> };
      const perVerdict = { pertinent: 0, a_surveiller: 0, archive: 0 };
      const cities = new Set<string>();
      for (const t of resolvedTargets) {
        const existing = byTarget.get(JSON.stringify([t.citySlug, t.type, t.id])) ?? [];
        const facet = t.verdict === "non_pertinent" ? "archive" : "selection";
        const basket = facet === "selection" ? t.verdict : null;
        if (existing.length === 0) {
          accountPlan.insert += 1;
          perVerdict[facet === "archive" ? "archive" : (basket as "pertinent" | "a_surveiller")] += 1;
          cities.add(t.citySlug);
          continue;
        }
        const key = repriseCommandKey(plan, ws.id, owner.accountId, t);
        if (existing.length === 1 && existing[0]!.command_key === key) accountPlan.noop += 1;
        else accountPlan.skipExisting.push({ row: t.row, id: t.id, existing: existing.map((h) => `${h.facet}/${h.basket ?? "-"}/${h.state}`) });
      }
      accounts.push({
        ...owner,
        unresolvedHistory: unresolved?.n ?? 0,
        writable: owner.approved && owner.member && owner.attachedHere && (unresolved?.n ?? 0) === 0,
        plan: accountPlan,
        expectedReadback: { cities: cities.size, ...perVerdict },
      });
    }

    const writable = activation?.writer_epoch === "scoped" && activation.maintenance_barrier === false
      && accounts.every((a) => a.writable) && reasonCodes.mismatched.length === 0;

    return {
      mode: "dry-run",
      insertOnly: true,
      database: database!,
      workspace: ws,
      activation,
      reasonCodes,
      match: { targets: plan.targets.length, resolvedTargets: resolvedTargets.length, ...match },
      targets: resolvedTargets,
      accounts,
      writable,
    };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export async function applyReprise(db: Database, plan: Plan, hooks: ApplyHooks = {}) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, plan.workspaceSlug));
  if (!ws) throw new Error("workspace not found");
  const owners = await db.select({ id: accountUsers.id, sub: accountUsers.sub }).from(accountUsers)
    .where(inArray(accountUsers.id, plan.ownerAccountIds));
  if (owners.length !== plan.ownerAccountIds.length || owners.some((o) => !o.sub)) throw new Error("account not found");
  const ordered = [...plan.targets].sort((a, b) => JSON.stringify([a.citySlug, a.type, a.id])
    .localeCompare(JSON.stringify([b.citySlug, b.type, b.id])));
  const tallies = new Map(owners.map((o) => [o.id, { inserted: 0, noop: 0, skippedRows: [] as number[] }]));
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, ws.id);
    for (const owner of owners) {
      const tally = tallies.get(owner.id)!;
      for (const t of ordered) {
        const target: SignalTarget = { citySlug: t.citySlug, type: t.type, id: t.id };
        const basket: Basket | null = t.verdict === "non_pertinent" ? null : t.verdict;
        const commandKey = repriseCommandKey(plan, ws.id, owner.id, t);
        const heads = await tx.select({ commandKey: facetEvents.commandKey }).from(facetStreams)
          .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
          .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
          .where(and(eq(facetStreams.workspaceId, ws.id), eq(facetStreams.scope, "personal"),
            eq(facetStreams.ownerId, owner.id), eq(facetStreams.targetType, "signal"),
            eq(facetStreams.citySlug, t.citySlug), eq(facetStreams.nodeType, t.type), eq(facetStreams.nodeId, t.id)));
        if (heads.length > 0) {
          if (heads.length === 1 && heads[0]!.commandKey === commandKey) tally.noop += 1;
          else tally.skippedRows.push(t.row);
          continue;
        }
        await hooks.beforeWrite?.(tx, owner.sub!, ws.id, target);
        const command: FacetCommand = {
          action: basket ? "select" : "discard", target, reasonCode: t.reasonCode, ...(basket ? { basket } : {}),
          expectedHeadId: null, displayedFingerprint: await resolveTarget(tx, target), commandKey,
        };
        await writeScopedPersonalFacetInTx(tx, owner.sub!, ws.id, command);
        tally.inserted += 1;
      }
      const expected = plan.expectedInserts?.[owner.id];
      if (expected !== undefined && expected !== tally.inserted) {
        throw new Error(`insert count drift for ${owner.id}: planned ${expected}, would insert ${tally.inserted}`);
      }
    }
  });
  const cities = [...new Set(plan.targets.map((t) => t.citySlug))].sort();
  const accounts = [];
  for (const owner of owners) {
    const tally = tallies.get(owner.id)!;
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
        else if (!tally.skippedRows.includes(t.row)) mismatchedRows.push(t.row);
      }
    }
    accounts.push({ accountId: owner.id, applied: { inserted: tally.inserted, noop: tally.noop,
      skipped: tally.skippedRows.length, skippedRows: [...new Set(tally.skippedRows)] },
    readback: { cities: cities.length, ...seen, mismatchedRows } });
  }
  return { workspaceId: ws.id, manifestSha: plan.manifestSha, mapping: plan.mapping, accounts };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readInputJson(): Promise<unknown> {
  const b64 = process.env.CHAPERON_REPRISE_PLAN_B64?.trim();
  const raw = b64 ? Buffer.from(b64, "base64").toString("utf8") : await readStdin();
  return JSON.parse(raw);
}

function isRawPlan(input: unknown): input is RawPlan {
  return typeof input === "object" && input !== null && "profile" in input && "ownerEmailDomain" in input;
}

export async function main(args: string[]): Promise<void> {
  const isDryRun = args.includes("--dry-run");
  const isApply = args.includes("--apply");
  const allowProd = args.includes("--allow-prod");
  if (isDryRun === isApply) {
    throw new Error("usage: --dry-run [--allow-prod] OR --apply --confirm <workspace-slug> [--allow-prod]");
  }
  const input = await readInputJson();
  const workspaceSlug = (input as { workspaceSlug?: string }).workspaceSlug;
  if (!workspaceSlug) throw new Error("missing workspaceSlug in plan");
  if (isApply && args[args.indexOf("--confirm") + 1] !== workspaceSlug) {
    throw new Error("usage: --apply --confirm <workspace-slug> [--allow-prod]");
  }
  assertAllowedBaseUrl(resolveRepriseBaseUrl(process.env), allowProd);

  const { db, pool } = createDb(loadConfig());
  try {
    if (isRawPlan(input)) {
      const dry = await dryRunReprise(pool, input);
      const drySummary = {
        mode: "dry-run" as const,
        insertOnly: true as const,
        database: dry.database,
        workspace: dry.workspace,
        activation: dry.activation,
        reasonCodes: dry.reasonCodes,
        match: dry.match,
        accounts: dry.accounts.map((a) => ({
          accountId: a.accountId,
          approved: a.approved,
          member: a.member,
          attachedHere: a.attachedHere,
          unresolvedHistory: a.unresolvedHistory,
          writable: a.writable,
          plan: { insert: a.plan.insert, noop: a.plan.noop, skipExisting: a.plan.skipExisting.length },
          expectedReadback: a.expectedReadback,
        })),
        writable: dry.writable,
      };
      if (isDryRun) {
        process.stdout.write(`${JSON.stringify({ kind: "chaperon-reprise", mode: "dry-run", manifestSha: input.manifestSha, mapping: input.mapping, dryRun: drySummary })}\n`);
        return;
      }
      if (!dry.writable) throw new Error("refused: workspace, accounts or reason codes not writable");
      if (dry.match.ambiguous.length || dry.match.notFound.length || dry.match.resolvedConflicts.length) {
        throw new Error("refused: unresolved or conflicting targets");
      }
      const resolvedPlan: Plan = {
        workspaceSlug: input.workspaceSlug,
        ownerAccountIds: dry.accounts.map((a) => a.accountId),
        keyNamespace: input.keyNamespace,
        manifestSha: input.manifestSha,
        mapping: input.mapping,
        expectedInserts: Object.fromEntries(dry.accounts.map((a) => [a.accountId, a.plan.insert])),
        targets: dry.targets,
      };
      const applied = await applyReprise(db, resolvedPlan);
      process.stdout.write(`${JSON.stringify({ kind: "chaperon-reprise", mode: "apply", manifestSha: input.manifestSha, mapping: input.mapping, dryRun: drySummary, apply: applied })}\n`);
      if (applied.accounts.some((a) => a.readback.mismatchedRows.length)) process.exitCode = 2;
      return;
    }

    if (isDryRun) throw new Error("--dry-run requires a raw plan");
    const result = await applyReprise(db, input as Plan);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.accounts.some((a) => a.readback.mismatchedRows.length)) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const invoked = /(?:^|[/\\])chaperon-reprise-apply\.(ts|js)$/.test(process.argv[1] ?? "");
if (invoked) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`chaperon-reprise-apply: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
