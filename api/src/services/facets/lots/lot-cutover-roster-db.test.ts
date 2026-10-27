import { expect, it } from "vitest";
import { cleanCutoverReport, cutoverFixture, describeDb } from "./cutover-fixture.js";
import { evaluateActivationGate } from "./lot-cutover-gate.js";

describeDb("6K concrete activation inputs", () => {
  it("should reject a missing manager, moderator, membership, or distinct grant", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    await f.pool.query("UPDATE workspace_memberships SET manage_members = false WHERE workspace_id = $1", [f.workspaceId]);
    expect((await evaluateActivationGate(f.db, f.workspaceId, report)).reasons)
      .toContain("workspace_manager_missing");
    await f.pool.query("UPDATE workspace_memberships SET moderate_archive = false WHERE workspace_id = $1", [f.workspaceId]);
    expect((await evaluateActivationGate(f.db, f.workspaceId, report)).reasons)
      .toContain("workspace_moderator_missing");
    await f.pool.query("UPDATE lot_capability_grants SET granted = false WHERE workspace_id = $1 AND capability = 'lot_market'", [f.workspaceId]);
    expect((await evaluateActivationGate(f.db, f.workspaceId, report)).reasons)
      .toContain("lot_grant_missing:lot_market");
    await f.pool.query("UPDATE workspace_memberships SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1", [f.workspaceId]);
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.activatable).toBe(false);
    expect(gate.reasons).toContain("workspace_members_missing");
  });
});
