import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { effects, NO_EFFECTS, ONE_COMMIT } from "./pwe-fixture.js";

export const NORMAL_DOMAIN = { identityIssuer: "https://normal-idp.example.test", tier: "preprod" as const,
  appOrigin: "https://normal-app.example.test", clientId: "normal-pwe" };

describeDb("PWE-03 normal callback cookie guards", () => {
  it.each(["summary", "management", "confirm", "revoke"] as const)(
    "should reject bearer-only and cookie-plus-bearer on %s", async (action) => {
      const h = await identityFixture(NORMAL_DOMAIN, randomUUID());
      const boot = bootstrapOf(await (await h.summary()).text());
      const base = `${NORMAL_DOMAIN.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}`;
      const url = action === "summary" ? h.intent.confirmationUrl : base +
        (["confirm", "revoke"].includes(action) ? `/${action}` : "");
      for (const cookie of ["", h.login.cookie]) {
        const response = await h.app.request(url, { method: ["confirm", "revoke"].includes(action) ? "POST" : "GET",
          headers: { host: new URL(NORMAL_DOMAIN.appOrigin).host, cookie, authorization: "Bearer page-proof",
            origin: NORMAL_DOMAIN.appOrigin, "content-type": "application/json",
            "x-artifact-write-csrf": boot.csrf as string },
          ...(["confirm", "revoke"].includes(action) ? { body: JSON.stringify(action === "confirm"
            ? { challengeToken: boot.challengeToken } : {}) } : {}) });
        expect(response.status).toBe(401);
        expect(await response.text()).not.toContain('id="pw-bootstrap"');
      }
      expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
    });

  it.each(["confirm", "revoke"] as const)(
    "should discriminate Origin and CSRF independently for normal-cookie %s", async (action) => {
      const h = await identityFixture(NORMAL_DOMAIN, randomUUID());
      const boot = bootstrapOf(await (await h.summary()).text());
      const url = `${NORMAL_DOMAIN.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}/${action}`;
      const body = JSON.stringify(action === "confirm" ? { challengeToken: boot.challengeToken } : {});
      const send = (overrides: Record<string, string | undefined>) => {
        const headers = new Headers({ host: new URL(NORMAL_DOMAIN.appOrigin).host, cookie: h.login.cookie,
          origin: NORMAL_DOMAIN.appOrigin, "content-type": "application/json", "x-artifact-write-csrf": boot.csrf as string });
        for (const [name, value] of Object.entries(overrides)) {
          if (value === undefined) headers.delete(name); else headers.set(name, value);
        }
        return h.app.request(url, { method: "POST", headers, body });
      };
      for (const origin of [undefined, "null", "https://foreign.test", "https://sibling.example.test"]) {
        expect((await send({ origin })).status).toBe(403);
      }
      for (const token of [undefined, "tampered", boot.csrf + "x"]) {
        expect((await send({ "x-artifact-write-csrf": token })).status).toBe(403);
      }
      expect((await send({ "x-artifact-write-csrf": undefined, "x-reader-csrf": boot.csrf as string })).status).toBe(403);
      const form = await send({ "content-type": "application/x-www-form-urlencoded" });
      expect(form.status).toBe(415);
      expect(await form.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
      expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
      expect((await send({})).status).toBe(200);
      expect(await effects(h.h.f)).toEqual(action === "confirm" ? ONE_COMMIT : NO_EFFECTS);
    });
});
