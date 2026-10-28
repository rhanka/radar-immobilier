import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { L5_DOMAIN } from "./l5-fixture.js";
import { effects, ONE_COMMIT } from "./pwe-fixture.js";
import { openPublished, type ImageReview } from "./l5-review-image-grants.js";

export function deadlineImageReviews(current: () => ImageReview) {
  it.each(["transport", "body"] as const)("should recover a real committed receipt after a suspended application %s", async (stage) => {
    const fixture = current(), { h, network } = fixture, { context, page } = await openPublished(fixture);
    try {
      const before = await effects(h.f), popup = context.waitForEvent("page");
      await page.getByRole("button", { name: stage === "transport" ? "Prepare personal.deselect" : "Prepare personal.select", exact: true }).click();
      const app = await popup;
      await app.locator("#pw-confirm").waitFor({ state: "visible", timeout: 1500 });
      await app.clock.install();
      const id = new URL(app.url()).pathname.split("/").at(-1)!;
      const count = network.suspensions();
      network.suspendNext(`/api/v1/artifacts/write-intents/${id}/confirm`, stage);
      await app.locator("#pw-confirm").click();
      await expect.poll(() => network.suspensions(), { timeout: 1500 }).toBe(count + 1);
      expect(await app.locator("#pw-confirm").isDisabled()).toBe(true);
      await app.clock.fastForward(15001);
      await expect.poll(() => app.locator("#pw-note").textContent(), { timeout: 1500 }).toContain("Result to verify");
      expect(await app.locator("#pw-confirm").isDisabled()).toBe(false);
      expect(await app.locator("#pw-manage-box").isVisible()).toBe(true);
      expect(await app.locator("#pw-receipt").isVisible()).toBe(false);
      const receipt = await app.evaluate(async (intentId) => {
        const response = await fetch(`/api/v1/artifacts/write-intents/${intentId}`); return response.json();
      }, id);
      expect(receipt).toMatchObject({ intentId: id, state: "committed", receipt: { event: expect.anything() } });
      const after = await effects(h.f);
      for (const [key, delta] of Object.entries(ONE_COMMIT)) expect(after[key], key).toBe(before[key]! + delta);
      writeFileSync(`/evidence/browser-app-deadline-${stage}.json`, JSON.stringify({ stage, id, before, after,
        imageSha: process.env.L5_IMAGE_SHA, recoveredCommand: receipt.commandId }));
    } finally { await context.close(); }
  });

  it.each(["transport", "body"] as const)("should settle a suspended L5 bootstrap %s without installing writes", async (stage) => {
    const { h, network, browser } = current(), context = await browser.newContext(), page = await context.newPage();
    try {
      await page.clock.install();
      await page.goto(`${h.origin}/`);
      await page.getByRole("button", { name: "Reader A", exact: true }).click({ timeout: 1500 });
      const count = network.suspensions(), before = await effects(h.f);
      network.suspendNext("/__reader/api/facets.write.bootstrap.v1", stage);
      await page.getByRole("button", { name: "Autoriser et ouvrir" }).click({ timeout: 1500 });
      await expect.poll(() => network.suspensions(), { timeout: 1500 }).toBe(count + 1);
      await page.clock.fastForward(15001);
      const outcome = await page.evaluate(async () => {
        const win = window as unknown as { __pwWriteReady: Promise<void>; __pwReadGesture?: unknown };
        return { ready: await win.__pwWriteReady.then(() => "ready", () => "failed"),
          readerInstalled: typeof win.__pwReadGesture === "function" };
      });
      expect(outcome).toEqual({ ready: "failed", readerInstalled: false });
      expect(await page.locator("#pw-page-bootstrap").count()).toBe(0);
      expect(await page.locator("#prepare").isDisabled()).toBe(true);
      expect(await effects(h.f)).toEqual(before);
      expect(network.traffic.some((request) => request.host === new URL(L5_DOMAIN.appOrigin).host)).toBe(true);
      writeFileSync(`/evidence/browser-bootstrap-deadline-${stage}.json`, JSON.stringify({ stage, outcome,
        imageSha: process.env.L5_IMAGE_SHA, effects: before }));
    } finally { await context.close(); }
  });
}
