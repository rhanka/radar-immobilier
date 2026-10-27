/**
 * 6K per-request cutover safety binding over the real entry route.
 *
 * Two moderators share one workspace while the server holds maintenance
 * evidence reserved to moderator A. A request from moderator B stays
 * closed; a static adapter qualified for A is refused under B; A opens.
 * Synthetic disposable data only.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import {
  accountUsers,
  lotCutoverState,
  workspaceMembershipEvents,
  workspaceMemberships,
} from "../../src/db/schema.js";
import {
  cutoverFixture,
  describeDb,
  type CutoverFixture,
} from "../../src/services/facets/lots/cutover-fixture.js";
import { evaluateActivationGate } from "../../src/services/facets/lots/lot-cutover.js";
import {
  qualifiedLotCutoverSafety,
  type CutoverServerEvidence,
} from "../../src/services/facets/lots/lot-cutover-safety.js";
import { setLotCapability } from "../../src/services/facets/lots/lot-capabilities.js";
import { expectedCutoverHeadValues } from "../../src/services/facets/lots/lot-cutover-expectations.js";
import { recomputeLotManifest } from "../../src/services/facets/lots/lot-manifest-refresh.js";
import {
  MAPPING,
  makeCutoverApp,
  seedLegacyChain,
} from "../../src/routes/scoped-lot-cutover-harness.js";

async function secondModerator(f: CutoverFixture) {
  const moderatorB = { id: randomUUID(), sub: `synthetic-moderator-b-${randomUUID()}` };
  await f.db.insert(accountUsers).values({ ...moderatorB, status: "approved" });
  await f.db.insert(workspaceMemberships).values({ workspaceId: f.workspaceId, accountId: moderatorB.id,
    status: "active", revision: 1, moderateArchive: false, manageMembers: false, revokedAt: null });
  await f.db.insert(workspaceMembershipEvents).values({ workspaceId: f.workspaceId,
    accountId: moderatorB.id, kind: "member_added", capability: null, actorId: f.moderator.id,
    reason: "synthetic second moderator" });
  await f.db.update(workspaceMemberships).set({ moderateArchive: true, revision: 2 }).where(and(
    eq(workspaceMemberships.workspaceId, f.workspaceId),
    eq(workspaceMemberships.accountId, moderatorB.id)));
  await f.db.insert(workspaceMembershipEvents).values({ workspaceId: f.workspaceId,
    accountId: moderatorB.id, kind: "capability_granted", capability: "moderate_archive",
    actorId: f.moderator.id, reason: "synthetic second moderator" });
  // Fully authorize B: with import rights missing, a removed binding guard
  // still fails closed at the importer instead of opening under A's proof.
  for (const capability of ["lot_select", "lot_pipeline", "lot_market"] as const) {
    await setLotCapability(f.db, { workspaceId: f.workspaceId, targetAccountId: moderatorB.id,
      actorSub: f.moderator.sub, capability, granted: true,
      reason: "synthetic second moderator lot rights", expectedRevision: null });
  }
  return moderatorB;
}

function serverEvidenceFor(f: CutoverFixture, actorSub: string): CutoverServerEvidence {
  const attemptId = randomUUID();
  const proof = { completedAt: new Date().toISOString(),
    coveredInstanceIds: ["synthetic-old-a", "synthetic-old-b"] };
  return {
    evidence: { workspaceId: f.workspaceId, actorSub, maintenanceAttemptId: attemptId,
      releaseId: "synthetic-bound-release",
      instanceIds: ["synthetic-old-a", "synthetic-old-b"],
      reason: "synthetic bound proof", drain: proof, shutdown: proof },
    maintenanceAttemptId: attemptId,
    releaseId: "synthetic-bound-release",
    instanceIds: ["synthetic-old-a", "synthetic-old-b"],
  };
}

describeDb("6K per-request cutover safety binding", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("should refuse a foreign proof while the bound moderator opens", async () => {
    const f = await cutoverFixture();
    const moderatorB = await secondModerator(f);
    await seedLegacyChain(f, f.moderator.id);
    const server = serverEvidenceFor(f, f.moderator.sub);
    vi.stubEnv("BASE_API_LOT_CUTOVER_CONFIG", JSON.stringify({ workspaceId: f.workspaceId,
      mapping: MAPPING, maintenance: server }));
    const app = createApp({ db: f.db, checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore,
      discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth });
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`;
    const body = { mapping: MAPPING, confirmCutover: true };
    const refused = await app.request(base, {
      method: "POST", headers: { "content-type": "application/json", cookie: await baseCookie(moderatorB.sub) },
      body: JSON.stringify(body) });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "maintenance_evidence_actor_mismatch" });
    const [mid] = await f.db.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(mid?.destinationOpen).not.toBe(true);
    const opened = await app.request(base, {
      method: "POST", headers: { "content-type": "application/json", cookie: await baseCookie(f.moderator.sub) },
      body: JSON.stringify(body) });
    expect(opened.status).toBe(200);
    expect((await opened.json() as { receipt: { status: string } }).receipt.status).toBe("complete");
  });

  it("should refuse cross-actor reuse of a statically injected qualified safety", async () => {
    const f = await cutoverFixture();
    const moderatorB = await secondModerator(f);
    await seedLegacyChain(f, f.moderator.id);
    const report = await recomputeLotManifest(f.db, MAPPING);
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    const server = serverEvidenceFor(f, f.moderator.sub);
    const staticSafety = qualifiedLotCutoverSafety(f.db,
      { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
        maintenanceAttemptId: server.maintenanceAttemptId, releaseId: server.releaseId,
        instanceIds: server.instanceIds },
      server.evidence, gate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`;
    const refused = await makeCutoverApp(f, { sub: moderatorB.sub }, { cutoverSafety: staticSafety })
      .request(base, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping: MAPPING, confirmCutover: true }) });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "maintenance_evidence_actor_mismatch" });
    const [state] = await f.db.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(state?.destinationOpen).not.toBe(true);
  });

  it("should open for a fully authorized moderator with its own proof", async () => {
    const f = await cutoverFixture();
    const moderatorB = await secondModerator(f);
    await seedLegacyChain(f, f.moderator.id);
    const server = serverEvidenceFor(f, moderatorB.sub);
    vi.stubEnv("BASE_API_LOT_CUTOVER_CONFIG", JSON.stringify({ workspaceId: f.workspaceId,
      mapping: MAPPING, maintenance: server }));
    const app = createApp({ db: f.db, checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore,
      discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth });
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`;
    const opened = await app.request(base, {
      method: "POST", headers: { "content-type": "application/json", cookie: await baseCookie(moderatorB.sub) },
      body: JSON.stringify({ mapping: MAPPING, confirmCutover: true }) });
    expect(opened.status).toBe(200);
    expect((await opened.json() as { receipt: { status: string } }).receipt.status).toBe("complete");
  });
});
