import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { mintSessionCookie, readSessionClaims } from "../../src/artifacts/preview-session.js";
import { l5Fixture, L5_DOMAIN, L5_P_KEY } from "./l5-fixture.js";
import { effects as baseEffects } from "./pwe-fixture.js";

async function effects(h: Awaited<ReturnType<typeof l5Fixture>>) {
  return baseEffects(h.f);
}
const appHeaders = (h: Awaited<ReturnType<typeof l5Fixture>>) => ({ host: new URL(L5_DOMAIN.appOrigin).host, cookie: h.login.cookie });
async function summary(h: Awaited<ReturnType<typeof l5Fixture>>, id: string) {
  const response = await h.app.request(`${L5_DOMAIN.appOrigin}/artifact-write/intents/${id}`, { headers: appHeaders(h) });
  expect(response.status).toBe(200);
  return bootstrapOf(await response.text());
}
async function confirm(h: Awaited<ReturnType<typeof l5Fixture>>, id: string, boot: Record<string, unknown>) {
  return h.app.request(`${L5_DOMAIN.appOrigin}/api/v1/artifacts/write-intents/${id}/confirm`, { method: "POST",
    headers: { ...appHeaders(h), origin: L5_DOMAIN.appOrigin, "content-type": "application/json",
      "x-artifact-write-csrf": String(boot.csrf) }, body: JSON.stringify({ challengeToken: boot.challengeToken }) });
}

describeDb("L5 published reader write runtime", () => {
  it("should prepare with PG ticket provenance, change nothing on GET, confirm once and recover the receipt", async () => {
    const h = await l5Fixture();
    try {
      expect(h.bootstrap.status).toBe(200);
      expect(readSessionClaims(h.cookie, L5_P_KEY, Date.now())?.writeIdentity).toEqual(L5_DOMAIN);
      const before = await effects(h), key = randomUUID();
      const prepared = await h.prepare({}, h.body, key); expect(prepared.status).toBe(201);
      const data = (await prepared.json()).data;
      expect(data.managementUrl).toBe(`${L5_DOMAIN.appOrigin}/artifact-write/intents/${data.intentId}`);
      expect(JSON.stringify(data)).not.toMatch(/challengeToken|csrf|radar_session|writeIdentity/);
      expect(await effects(h)).toEqual(before);
      const boot = await summary(h, data.intentId); expect(await effects(h)).toEqual(before);
      const response = await confirm(h, data.intentId, boot); expect(response.status).toBe(200);
      const receipt = await response.json(), after = await effects(h);
      expect(after.events).toBe(before.events! + 1);
      expect((await confirm(h, data.intentId, boot)).status).toBe(409);
      h.f.pool.options.max = 1;
      const status = await h.app.request(`${h.origin}/__reader/api/facets.write-intents.status.v1?intentId=${data.intentId}`, { headers: h.headers });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ data: { state: "committed", commandId: receipt.commandId, receipt: receipt.receipt } });
      const terminal = await h.app.request(data.managementUrl, { headers: appHeaders(h) });
      expect(await terminal.text()).not.toContain('id="pw-confirm"');
      const recovered = await h.app.request(`${L5_DOMAIN.appOrigin}/api/v1/artifacts/write-intents/${data.intentId}`, { headers: appHeaders(h) });
      expect(await recovered.json()).toMatchObject({ state: "committed", commandId: receipt.commandId, receipt: receipt.receipt });
      expect(await effects(h)).toEqual(after);
    } finally { await h.close(); }
  });

  it.each(["origin", "x-reader-instance", "x-reader-csrf"])("should refuse missing or foreign %s before any intent", async (header) => {
    const h = await l5Fixture();
    try {
      const before = await effects(h);
      expect((await h.prepare({ [header]: "" })).status).toBe(403);
      expect((await h.prepare({ [header]: "foreign" })).status).toBe(403);
      expect((await h.f.pool.query("SELECT count(*)::int AS count FROM pw_write_intents")).rows[0].count).toBe(0);
      expect(await effects(h)).toEqual(before);
    } finally { await h.close(); }
  });

  it("should leave a read-only release and a pre-provenance P unable to prepare", async () => {
    const read = await l5Fixture(false);
    try { expect(read.bootstrap.status).toBe(401); expect((await read.prepare()).status).toBe(403); }
    finally { await read.close(); }
    const h = await l5Fixture();
    try {
      const { writeIdentity: _identity, ...old } = readSessionClaims(h.cookie, L5_P_KEY, Date.now())!;
      const response = await h.app.request(`${h.origin}/__reader/api/facets.write.bootstrap.v1`, {
        headers: { ...h.headers, cookie: mintSessionCookie(old, L5_P_KEY).split(";")[0]! } });
      expect(response.status).toBe(401);
    } finally { await h.close(); }
  });

  it("should refuse confirmation and mask business summary after actual artifact ACL withdrawal", async () => {
    const h = await l5Fixture();
    try {
      const prepared = await h.prepare(); expect(prepared.status).toBe(201);
      const data = (await prepared.json()).data, boot = await summary(h, data.intentId), before = await effects(h);
      await h.f.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [h.artifactId, h.f.contributor.sub]);
      expect((await confirm(h, data.intentId, boot)).status).toBe(403);
      const page = await h.app.request(data.confirmationUrl, { headers: appHeaders(h) });
      expect(bootstrapOf(await page.text())).not.toHaveProperty("challengeToken");
      expect(await effects(h)).toEqual(before);
    } finally { await h.close(); }
  });
});
