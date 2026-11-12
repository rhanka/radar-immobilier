// Insert-only Chaperon reprise against the real migrated schema (synthetic data only).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { graphNodes, workspaces } from "../../src/db/schema.js";
import { runPersonalAttachmentActivation } from "../../src/services/facets/activation-run.js";
import { activation, attach, describeDb, fixture, safety, type Fixture } from "../../src/services/facets/scope-db-fixture.js";
import { writeScopedPersonalFacet, writeScopedPersonalFacetInTx } from "../../src/services/facets/scoped-writer.js";
import { resolveTarget } from "../../src/services/facets/target.js";
import { applyReprise, type Plan, type PlanTarget } from "../../src/scripts/chaperon-reprise-apply.js";

const CITY = "synthetic-city";
const NAMESPACE = "6c1f3a52-8f0e-5b7d-9a41-2e6d0c9b7f13";

async function setup() {
  const f = await fixture();
  await attach(f);
  await runPersonalAttachmentActivation(f.db, activation(f), safety);
  const [ws] = await f.db.select().from(workspaces).where(eq(workspaces.id, f.workspaceId));
  const decisions: Array<[PlanTarget["verdict"], string]> = [["pertinent", "P-DENSITE"], ["a_surveiller", "S-PLANIFIE"],
    ["non_pertinent", "N-FORME"], ["pertinent", "P-NORMES"]];
  const targets: PlanTarget[] = [];
  for (const [index, [verdict, reasonCode]] of decisions.entries()) {
    const [node] = await f.db.insert(graphNodes).values({ id: `signal-synthetic-${index}-${randomUUID()}`, type: "Signal",
      citySlug: CITY, label: `Synthetic signal ${index}` }).returning();
    targets.push({ row: index + 1, citySlug: CITY, type: "Signal", id: node!.id, verdict, reasonCode });
  }
  const plan: Plan = { workspaceSlug: ws!.slug, ownerAccountIds: [f.member.id], keyNamespace: NAMESPACE,
    manifestSha: "0".repeat(64), mapping: "synthetic", targets };
  return { f, plan };
}

const count = async (f: Fixture, table: string) =>
  (await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

describeDb("chaperon reprise apply (insert-only)", () => {
  it("skips an already classified target, archives non pertinent personally, and replays idempotently", async () => {
    const { f, plan } = await setup();
    const existing = plan.targets[3]!;
    const target = { citySlug: existing.citySlug, type: existing.type, id: existing.id };
    await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, { action: "select", basket: "a_surveiller", target,
      expectedHeadId: null, displayedFingerprint: await resolveTarget(f.db, target), commandKey: randomUUID() });

    const first = await applyReprise(f.db, plan);
    expect(first.accounts[0]).toMatchObject({ applied: { inserted: 3, noop: 0, skipped: 1, skippedRows: [4] },
      readback: { cities: 1, pertinent: 1, a_surveiller: 1, archive: 1, mismatchedRows: [] } });
    const archived = await f.pool.query(`SELECT scope, owner_id, actor_id, facet, basket, state, verdict, reason_code
      FROM facet_events WHERE node_id = $1`, [plan.targets[2]!.id]);
    expect(archived.rows).toEqual([{ scope: "personal", owner_id: f.member.id, actor_id: f.member.id, facet: "archive",
      basket: null, state: "active", verdict: "non_pertinent", reason_code: "N-FORME" }]);
    const kept = await f.pool.query("SELECT facet, basket, reason_code FROM facet_events WHERE node_id = $1", [existing.id]);
    expect(kept.rows).toEqual([{ facet: "selection", basket: "a_surveiller", reason_code: null }]);

    const before = { events: await count(f, "facet_events"), commands: await count(f, "facet_commands") };
    const second = await applyReprise(f.db, { ...plan, expectedInserts: { [f.member.id]: 0 } });
    expect(second.accounts[0]!.applied).toEqual({ inserted: 0, noop: 3, skipped: 1, skippedRows: [4] });
    expect({ events: await count(f, "facet_events"), commands: await count(f, "facet_commands") }).toEqual(before);
  });

  it("rolls back every insert when a head conflict appears inside the transaction", async () => {
    const { f, plan } = await setup();
    const last = [...plan.targets].sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
    await expect(applyReprise(f.db, plan, { beforeWrite: async (tx, sub, workspaceId, target) => {
      if (target.id !== last.id) return;
      const basket = last.verdict === "non_pertinent" ? undefined : last.verdict;
      await writeScopedPersonalFacetInTx(tx, sub, workspaceId, { action: basket ? "select" : "discard",
        ...(basket ? { basket } : {}), reasonCode: last.reasonCode, target, expectedHeadId: null,
        displayedFingerprint: await resolveTarget(tx, target), commandKey: randomUUID() });
    } })).rejects.toMatchObject({ message: "facet_head_conflict" });
    for (const table of ["facet_events", "facet_streams", "facet_heads", "facet_commands", "facet_command_contexts"]) {
      expect(await count(f, table)).toBe(0);
    }
  });

  it("aborts without writing when the insert count drifts from the dry run", async () => {
    const { f, plan } = await setup();
    await expect(applyReprise(f.db, { ...plan, expectedInserts: { [f.member.id]: 3 } }))
      .rejects.toThrow(/insert count drift/);
    expect(await count(f, "facet_events")).toBe(0);
  });
});
