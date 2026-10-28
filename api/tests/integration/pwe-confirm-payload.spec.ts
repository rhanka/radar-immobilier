import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { effects, NO_EFFECTS, ONE_COMMIT } from "./pwe-fixture.js";

describeDb("PWE-01 HW-05 immutable confirm payload", () => {
  it("should execute only the server summary and refuse every substituted confirm field", async () => {
    const domain = { identityIssuer: "https://payload-idp.example.test", tier: "preprod" as const,
      appOrigin: "https://payload-app.example.test", clientId: "payload-pwe" };
    const h = await identityFixture(domain, randomUUID());
    const boot = bootstrapOf(await (await h.summary()).text());
    const send = (extra: Record<string, unknown>) => h.app.request(
      `${domain.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}/confirm`, {
        method: "POST", headers: { host: new URL(domain.appOrigin).host, cookie: h.login.cookie,
          origin: domain.appOrigin, "content-type": "application/json", "x-artifact-write-csrf": boot.csrf as string },
        body: JSON.stringify({ challengeToken: boot.challengeToken, ...extra }),
      });
    for (const extra of [{ basket: "a_surveiller" }, { target: { ...h.h.body.target, id: "other" } },
      { operation: "facets.signals.workspace.restore.v1" }, { reasonCode: "SYNTHETIC-UNKNOWN" },
      { payload: { basket: "a_surveiller" } }, { command: { ...h.row.command as object, basket: "a_surveiller" } }]) {
      const refused = await send(extra);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_facet_command" } });
      expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
    }
    const accepted = await send({});
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ state: "committed", commandId: h.row.commandKey,
      receipt: { event: { state: "active", basket: "pertinent" } } });
    expect((await h.h.f.pool.query("SELECT basket FROM facet_events")).rows).toEqual([{ basket: "pertinent" }]);
    expect(await effects(h.h.f)).toEqual(ONE_COMMIT);
  });
});
