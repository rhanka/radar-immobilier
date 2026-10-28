// PW-C PWC-02/03/06/07: summary, confirm to a committed receipt, replay
// refusal, revocation, bearer and foreign-principal refusals over createApp.
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../services/facets/signal-write-fixture.js";
import { pwPrepared } from "../services/facets/pw-write-fixture.js";
import { APP_LOGIN_PATH } from "./write-intent-app-script.js";
import { bootstrapOf, post, surface } from "./write-intent-app-surface-harness.js";

describeDb("PW-C application surface", () => {
  it("should confirm through the summary and refuse replay, then revoke", async () => {
    const f = await workspaceFixture();
    const { app, host, cookie } = await surface(f);
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const session = await cookie(f.contributor.sub);
    const summaryUrl = `https://${host}/artifact-write/intents/${row.intentId}`;

    const anonymous = await app.request(summaryUrl, { headers: { host } });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toContain(`href="${APP_LOGIN_PATH}"`);

    const summary = await app.request(summaryUrl, { headers: { host, cookie: session } });
    expect(summary.status).toBe(200);
    expect(summary.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    const html = await summary.text();
    expect(html).toContain("Select a personal basket");
    expect(html).toContain(row.workspaceId);
    const boot = bootstrapOf(html);
    expect(boot.confirmUrl).toBe(`/api/v1/artifacts/write-intents/${row.intentId}/confirm`);

    const management = await app.request(`https://${host}/api/v1/artifacts/write-intents/${row.intentId}`,
      { headers: { host, cookie: session } });
    expect(management.status).toBe(200);
    expect(await management.json()).toMatchObject({ intentId: row.intentId, management: true, state: "pending" });

    const confirmUrl = `https://${host}${boot.confirmUrl as string}`;
    const confirmed = await post(app, host, confirmUrl, session,
      boot.csrf as string, { challengeToken: boot.challengeToken });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ intentId: row.intentId,
      state: "committed", commandId: input.commandKey,
      receipt: { event: { state: "active", basket: "pertinent" } },
      nextAction: "refresh_state" });

    const result = await app.request(`https://${host}/api/v1/artifacts/write-intents/${row.intentId}`,
      { headers: { host, cookie: session } });
    expect(result.status).toBe(200);
    const technical = await result.json();
    expect(technical).toMatchObject({ intentId: row.intentId, management: true, state: "committed" });
    expect(technical).toMatchObject({ commandId: input.commandKey,
      receipt: { event: { state: "active", basket: "pertinent" } } });
    expect(technical).not.toHaveProperty("challengeToken");

    const replay = await post(app, host, confirmUrl, session,
      boot.csrf as string, { challengeToken: boot.challengeToken });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject(
      { error: { code: "challenge_consumed", action: "read_status" } });

    const revokeUrl = `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/revoke`;
    const revoked = await post(app, host, revokeUrl, session, boot.csrf as string, {});
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ intentId: row.intentId,
      authorizationState: "revoked", commandState: "committed",
      revokedAt: expect.any(String) });
    const withdrawn = await (await app.request(`https://${host}/api/v1/artifacts/write-intents/${row.intentId}`,
      { headers: { host, cookie: session } })).json();
    expect(withdrawn).toMatchObject({ state: "revoked", executionState: "committed", revocationState: "revoked",
      commandId: input.commandKey, receipt: technical.receipt });
  });

  it("should refuse bearer use, foreign principals, and wrong methods", async () => {
    const f = await workspaceFixture();
    const { app, host, cookie } = await surface(f);
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const session = await cookie(f.contributor.sub);
    const summaryUrl = `https://${host}/artifact-write/intents/${row.intentId}`;

    const bearer = await app.request(summaryUrl,
      { headers: { host, cookie: session, authorization: "Bearer stale" } });
    expect(bearer.status).toBe(401);
    expect(await bearer.json()).toMatchObject({ error: { code: "cookie_required" } });

    const outsider = await cookie(f.outsider.sub);
    const foreign = await app.request(summaryUrl, { headers: { host, cookie: outsider } });
    expect(foreign.status).toBe(403);
    const foreignApi = await app.request(`https://${host}/api/v1/artifacts/write-intents/${row.intentId}`,
      { headers: { host, cookie: outsider } });
    expect(foreignApi.status).toBe(404);

    const method = await app.request(
      `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/confirm`);
    expect(method.status).toBe(405);
  });
});
