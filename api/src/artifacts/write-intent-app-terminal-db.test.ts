import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../services/facets/signal-write-fixture.js";
import { pwPrepared } from "../services/facets/pw-write-fixture.js";
import { revokeMembership } from "../services/workspaces/mutations.js";
import { bootstrapOf, post, surface } from "./write-intent-app-surface-harness.js";

describeDb("PW-C terminal HTML consultation", () => {
  it.each(["committed", "revoked", "committed_then_revoked"])(
    "should serve the authorized %s HTML without confirmation and hide receipts after rights loss", async (terminal) => {
      const f = await workspaceFixture();
      const { app, host, cookie } = await surface(f);
      const row = await pwPrepared(f, await preparedSelect(f));
      const session = await cookie(f.contributor.sub);
      const url = `https://${host}/artifact-write/intents/${row.intentId}`;
      const headers = { host, cookie: session, accept: "text/html",
        "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
      const summary = await app.request(url, { headers });
      expect(summary.status).toBe(200);
      const boot = bootstrapOf(await summary.text());
      const committed = terminal.startsWith("committed");
      const revoked = terminal !== "committed";
      let receipt: unknown;
      if (committed) {
        const result = await post(app, host, `https://${host}${boot.confirmUrl}`, session,
          boot.csrf as string, { challengeToken: boot.challengeToken });
        expect(result.status).toBe(200);
        receipt = (await result.json()).receipt;
      }
      if (revoked) {
        const result = await post(app, host, `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/revoke`,
          session, boot.csrf as string, {});
        expect(result.status).toBe(200);
      }
      const get = async () => {
        const response = await app.request(url, { headers });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        const html = await response.text();
        expect(html).not.toContain('id="pw-confirm"');
        expect(html).not.toContain(String(boot.challengeToken));
        expect(bootstrapOf(html)).not.toHaveProperty("challengeToken");
        expect(bootstrapOf(html)).not.toHaveProperty("confirmUrl");
        expect(html).toContain(`<dt>Execution</dt><dd>${committed ? "committed" : "pending"}</dd>`);
        expect(html).toContain(`<dt>Revocation</dt><dd>${revoked ? "revoked" : "active"}</dd>`);
        return html;
      };
      const html = await get();
      if (committed) {
        expect(html).toContain('id="pw-recovered-receipt"');
        expect(html.replaceAll("&quot;", '"')).toContain(JSON.stringify(receipt));
        expect(html).toContain(row.commandKey);
      } else expect(html).not.toContain('id="pw-recovered-receipt"');
      await revokeMembership(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
        actorSub: f.moderator.sub, expectedRevision: 1, reason: "Synthetic terminal HTML rights withdrawal" });
      const withdrawn = await get();
      expect(withdrawn).not.toContain('id="pw-recovered-receipt"');
      expect(withdrawn).not.toContain(row.commandKey);
      expect(withdrawn).not.toContain("Displayed fingerprint");
      expect(withdrawn).toContain('id="pw-revoke"');
    });
});
