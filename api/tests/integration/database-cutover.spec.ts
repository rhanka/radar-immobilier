import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { accountUsers, facetEvents } from "../../src/db/schema.js";
import { migrateDatabaseCutover, type CutoverPlan } from "../../src/scripts/database-cutover.js";
import { database, describeDb } from "../../src/services/facets/scope-db-fixture.js";
import * as readback from "../../src/services/facets/activation-readback.js";

async function seeded() {
  const f = await database();
  const actor = { id: randomUUID(), sub: `prod-actor-${randomUUID()}` };
  const member = { id: randomUUID(), sub: `prod-member-${randomUUID()}` };
  await f.db.insert(accountUsers).values([actor, member].map(a => ({ ...a, status: "approved" as const })));
  await f.db.insert(facetEvents).values({ ownerId: member.id, actorId: member.id, citySlug: "synthetic-city",
    nodeType: "Signal", nodeId: randomUUID(), facet: "selection", basket: "pertinent", state: "active",
    observedFingerprint: "a".repeat(64), commandKey: randomUUID(), commandDigest: "b".repeat(64) });
  const plan: CutoverPlan = { version: 1, actorSub: actor.sub, workspaceSlug: "approved-workspace",
