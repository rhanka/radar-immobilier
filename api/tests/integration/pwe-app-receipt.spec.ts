import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { mintPageWriteGrant } from "../../src/artifacts/write-intent-page-authority.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { revokeMembership } from "../../src/services/workspaces/mutations.js";
import { setMembershipCapability } from "../../src/services/workspaces/capabilities.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { effects } from "./pwe-fixture.js";

async function committed(common = false) {
  const domain = { identityIssuer: "https://receipt-idp.example.test", tier: "preprod" as const,
    appOrigin: "https://receipt-app.example.test", clientId: "receipt-pwe" };
  const h = await identityFixture(domain, randomUUID());
  const headers = { host: new URL(domain.appOrigin).host, cookie: h.login.cookie };
  let id = h.row.intentId;
  const mutation = { workspaceId: h.h.f.workspaceId, targetAccountId: h.h.f.contributor.id,
    actorSub: h.h.f.moderator.sub, expectedRevision: 1, reason: "Synthetic PWE receipt withdrawal" };
  if (common) {
    await setMembershipCapability(h.h.f.db, { ...mutation, capability: "moderate_archive", granted: true });
    h.h.page.grant = { ...h.h.page.grant, operations: ["facets.signals.workspace.restore.v1"] };
    const scope = await readProjectionScope(h.h.f.db, h.login.session.sub,
      h.row.workspaceId, h.row.citySlug, "signal");
    const prepared = await h.app.request(`${domain.appOrigin}/api/v1/artifacts/reader/facets/write-intents`, {
      method: "POST", headers: { host: headers.host, "content-type": "application/json", "idempotency-key": randomUUID(),
        "x-synthetic-page-proof": h.h.page.grant.sessionId,
        "x-preview-write-grant": await mintPageWriteGrant(h.h.page, h.h.writeH5, h.h.clock.now) },
      body: JSON.stringify({ ...h.h.body, operation: "facets.signals.workspace.restore.v1", basket: undefined,
        expectedProjectionToken: scope.token }) });
    expect(prepared.status).toBe(201); id = (await prepared.json()).data.intentId;
  }
  const url = `${domain.appOrigin}/api/v1/artifacts/write-intents/${id}`;
  const summary = await h.app.request(`${domain.appOrigin}/artifact-write/intents/${id}`, { headers });
  const boot = bootstrapOf(await summary.text());
  const post = (action: string, body: unknown) => h.app.request(`${url}/${action}`, { method: "POST",
    headers: { ...headers, origin: domain.appOrigin, "content-type": "application/json",
      "x-artifact-write-csrf": boot.csrf as string }, body: JSON.stringify(body) });
  const confirmation = await post("confirm", { challengeToken: boot.challengeToken });
  expect(confirmation.status).toBe(200);
  const receipt = await confirmation.json();
  const get = () => h.app.request(url, { headers: { ...headers, "sec-fetch-site": "same-origin" } });
  const result = await get(); expect(result.status).toBe(200);
  const data = await result.json();
  expect({ state: data.state, commandId: data.commandId, receipt: data.receipt },
    "PW_E_APP_RECEIPT missing immutable receipt or commandId")
    .toEqual({ state: "committed", commandId: receipt.commandId, receipt: receipt.receipt });
  return { ...h, id, mutation, get, post, receipt, boot };
}

describeDb("PWE-08 C08 application receipt consultation", () => {
  it("should recover the original app receipt after P and the challenge expire with no second business effect", async () => {
    const h = await committed(); const before = await effects(h.h.f);
    h.h.clock.now = h.h.page.pageExpiresAtMs + 1;
    const result = await h.get(); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ state: "committed", commandId: h.receipt.commandId, receipt: h.receipt.receipt });
    const replay = await h.post("confirm", { challengeToken: h.boot.challengeToken });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: { code: "challenge_consumed" } });
    expect(await effects(h.h.f)).toEqual(before);
  });

  it.each(["approval", "membership", "moderation", "intent"] as const)(
    "should retain technical management without a receipt after %s loss", async (loss) => {
      const h = await committed(loss === "moderation"); const before = await effects(h.h.f);
      if (loss === "approval") await h.h.f.pool.query("UPDATE account_users SET status='pending' WHERE id=$1", [h.h.f.contributor.id]);
      if (loss === "membership") await revokeMembership(h.h.f.db, h.mutation);
      if (loss === "moderation") await setMembershipCapability(h.h.f.db,
        { ...h.mutation, expectedRevision: 2, capability: "moderate_archive", granted: false });
      if (loss === "intent") expect((await h.post("revoke", {})).status).toBe(200);
      const result = await h.get(); expect(result.status).toBe(200);
      const data = await result.json();
      expect(data).toMatchObject({ management: true, state: loss === "intent" ? "revoked" : "committed" });
      if (loss === "intent") expect(data).toMatchObject({ executionState: "committed", revocationState: "revoked",
        commandId: h.receipt.commandId, receipt: h.receipt.receipt });
      else { expect(data).not.toHaveProperty("receipt"); expect(data).not.toHaveProperty("commandId"); }
      expect(data).not.toHaveProperty("challengeToken"); expect(await effects(h.h.f)).toEqual(before);
    });
});
