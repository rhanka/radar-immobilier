import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { discoverFacetContext } from "../../src/services/facets/classification-discovery.js";
import * as context from "../../src/services/facets/classification-context.js";
import * as store from "../../src/services/workspaces/store.js";
import { addMembership, revokeMembership } from "../../src/services/workspaces/mutations.js";
import { initializeWorkspaceStore } from "../../src/services/workspaces/init-store.js";

describeDb("classification atomic discovery membership snapshot", () => {
  for (const transport of ["h5", "mcp"] as const) {
    for (const selection of ["singleton", "many", "explicit"] as const) {
      for (const change of ["revocation", "addition"] as const) {
        it(`should refuse ${transport} ${selection} discovery after ${change} during final approval`, async () => {
          const f = await classificationFixture();
          const created = selection === "many" && change === "addition" ? await initializeWorkspaceStore(f.data.db, {
            workspaceSlug: `synthetic-${f.data.outsider.id}`, workspaceLabel: "Synthetic late membership",
            approvedAccountIds: [f.data.moderator.id], managerAccountIds: [f.data.moderator.id],
            moderatorAccountIds: [], actorAccountId: f.data.moderator.id, reason: "Synthetic initialization",
          }) : null;
          const mutation = { workspaceId: created?.workspaceId ?? f.data.otherId, targetAccountId: f.data.contributor.id,
            actorSub: f.data.moderator.sub, reason: "Synthetic final discovery race" };
          const removed = !created && (selection === "singleton" || change === "addition")
            ? await revokeMembership(f.data.db, { ...mutation, expectedRevision: 1 }) : null;
          let contextResolved = false;
          const readContext = context.readFacetContext;
          const contextSpy = vi.spyOn(context, "readFacetContext").mockImplementation(async (...args) => {
            const result = await readContext(...args);
            contextResolved = true;
            return result;
          });
          const approve = store.approvedAccountId;
          let approvals = 0;
          let changed = false;
          const approvalSpy = vi.spyOn(store, "approvedAccountId").mockImplementation(async (...args) => {
            const accountId = await approve(...args);
            const final = selection === "many" ? ++approvals === 2 : contextResolved;
            if (final && !changed) {
              changed = true;
              if (change === "addition") {
                await addMembership(f.data.db, { ...mutation, expectedRevision: removed?.revision ?? null });
              } else {
                await revokeMembership(f.data.db, { ...mutation, workspaceId: f.data.workspaceId, expectedRevision: 1 });
              }
            }
            return accountId;
          });
          try {
            const outcome = await discoverFacetContext(f.data.db, f.data.contributor.sub, transport,
              selection === "explicit" ? f.data.workspaceId : undefined).catch((error: unknown) => error);
            expect(changed).toBe(true);
            expect(outcome).toMatchObject({ code: change === "revocation" && selection !== "many" ? "workspace_not_authorized" : "workspace_ambiguous" });
            expect(outcome).not.toHaveProperty("workspaces");
            expect(outcome).not.toHaveProperty("selectedWorkspace");
          } finally { approvalSpy.mockRestore(); contextSpy.mockRestore(); }
        });
      }
    }
  }
});
