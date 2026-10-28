import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authorityFixture, APP } from "./pw-write-authority-fixture.js";
import { writeIntentH5Route } from "../../src/artifacts/write-intent-h5-route.js";
import { pageWriteListenerRoute } from "../../src/artifacts/write-intent-page-listener.js";
import { effects } from "./pwe-fixture.js";

describeDb("PW-C real listener to H5 contract", () => {
  it("should prepare, confirm in the app and project the original receipt through real H5 responses", async () => {
    const h = await authorityFixture(), appOrigin = h.writeApp.domain.appOrigin;
    h.page.csrfToken = "private-page-csrf".repeat(3);
    h.writeH5.statusBaseUrl = `${appOrigin}/api/v1/artifacts/reader/facets/write-intents`;
    const receiver = writeIntentH5Route(h.writeH5);
    const listener = pageWriteListenerRoute({ ...h.writeH5, contentBase: "pages.example.test", applicationOrigin: appOrigin,
      resolvePage: async () => h.page,
      forward: (request) => {
        const headers = new Headers(request.headers);
        headers.set("x-synthetic-page-proof", h.page.grant.sessionId);
        return Promise.resolve(receiver.request(new Request(request, { headers })));
      } });
    const origin = `https://${h.page.grant.host}`, headers = { host: h.page.grant.host, origin,
      "x-reader-instance": h.page.pageInstanceId, "x-reader-csrf": h.page.csrfToken,
      "content-type": "application/json", "idempotency-key": h.input.commandKey };
    const prepared = await listener.request(`http://${h.page.grant.host}/__reader/api/facets.write-intents.prepare.v1`, {
      method: "POST", headers, body: JSON.stringify(h.body) });
    expect(prepared.status).toBe(201);
    const { data } = await prepared.json();
    expect(data).toMatchObject({ confirmationUrl: `${appOrigin}/artifact-write/intents/${data.intentId}`,
      managementUrl: `${appOrigin}/artifact-write/intents/${data.intentId}` });
    const before = await effects(h.f);
    expect(before.events).toBe(0);
    const cookie = await h.cookie(), summary = await h.request(`/artifact-write/intents/${data.intentId}`, { headers: { cookie } });
    expect(summary.status).toBe(200); const boot = await summary.json();
    const confirmed = await h.request(`${APP}/${data.intentId}/confirm`, { method: "POST", headers: {
      cookie, origin: appOrigin, "content-type": "application/json", "x-artifact-write-csrf": boot.csrf,
    }, body: JSON.stringify({ challengeToken: boot.challengeToken }) });
    expect(confirmed.status).toBe(200); const receipt = await confirmed.json();
    const committedEffects = await effects(h.f);
    const status = await listener.request(`http://${h.page.grant.host}/__reader/api/facets.write-intents.status.v1?intentId=${data.intentId}`,
      { headers: { host: h.page.grant.host } });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ reader: { sub: h.f.contributor.sub },
      data: { intentId: data.intentId, state: "committed", commandId: h.input.commandKey, receipt: { event: receipt.event } } });
    expect(await effects(h.f)).toEqual(committedEffects); expect(h.counters().confirms).toBe(1);
  });
});
