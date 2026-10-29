import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { openPublished, type ImageReview } from "./l5-review-image-grants.js";
import { effects, ONE_COMMIT } from "./pwe-fixture.js";

export function statusImageReviews(current: () => ImageReview) {
  it("should mask a committed workspace receipt from the published page after moderation withdrawal", async () => {
    const fixture = current(), { h } = fixture, { context, page } = await openPublished(fixture, "Reader B");
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    try {
      await page.route("**/__reader/api/facets.write-intents.status.v1?*", async (route) => {
        await held; await route.continue();
      });
      const before = await effects(h.f), popup = context.waitForEvent("page");
      await page.getByRole("button", { name: "Prepare workspace.discard", exact: true }).click();
      const app = await popup;
      await app.locator("#pw-confirm").waitFor({ state: "visible", timeout: 1500 });
      const id = new URL(app.url()).pathname.split("/").at(-1)!;
      const post = app.waitForResponse((response) => response.url().endsWith(`/${id}/confirm`));
      await app.locator("#pw-confirm").click();
      const confirmed = await post; expect(confirmed.status()).toBe(200);
      expect(await confirmed.json()).toHaveProperty("receipt.event");
      await h.f.pool.query("UPDATE workspace_memberships SET moderate_archive=false WHERE workspace_id=$1 AND account_id=$2",
        [h.f.workspaceId, h.f.moderator.id]);
      const denied = page.waitForResponse((response) => response.url().includes("facets.write-intents.status.v1"));
      release(); await page.bringToFront();
      const status = await denied;
      expect(status.status()).toBe(403);
      expect(await status.json()).not.toHaveProperty("data.receipt");
      expect(await page.locator("#pw-page-receipt").textContent()).toBe("");
      const after = await effects(h.f);
      for (const [key, delta] of Object.entries(ONE_COMMIT)) expect(after[key], key).toBe(before[key]! + delta);
      await page.unrouteAll({ behavior: "wait" });
      await h.f.pool.query("UPDATE workspace_memberships SET moderate_archive=true WHERE workspace_id=$1 AND account_id=$2",
        [h.f.workspaceId, h.f.moderator.id]);
      const restoredPopup = context.waitForEvent("page");
      await page.getByRole("button", { name: "Prepare workspace.restore", exact: true }).click();
      const restore = await restoredPopup;
      await restore.locator("#pw-confirm").waitFor({ state: "visible", timeout: 1500 });
      const restored = restore.waitForResponse((response) => response.url().endsWith("/confirm"));
      await restore.locator("#pw-confirm").click(); expect((await restored).status()).toBe(200);
      writeFileSync("/evidence/browser-status-withdrawal.json", JSON.stringify({ id, before, after,
        deniedStatus: status.status(), imageSha: process.env.L5_IMAGE_SHA }));
    } finally {
      release();
      await h.f.pool.query("UPDATE workspace_memberships SET moderate_archive=true WHERE workspace_id=$1 AND account_id=$2",
        [h.f.workspaceId, h.f.moderator.id]);
      await context.close();
    }
  });
}
