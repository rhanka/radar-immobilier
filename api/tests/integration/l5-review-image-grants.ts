import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Browser } from "@playwright/test";
import type { imagePublication } from "./l5-image-publication.js";
import type { imageNetwork } from "./l5-image-network.js";
import { L5_DOMAIN } from "./l5-fixture.js";
import { effects, ONE_COMMIT } from "./pwe-fixture.js";

export type ImageReview = { h: Awaited<ReturnType<typeof imagePublication>>;
  network: Awaited<ReturnType<typeof imageNetwork>>; browser: Browser };

export async function openPublished({ browser, h }: ImageReview, reader = "Reader A") {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${h.origin}/`);
  await page.getByRole("button", { name: reader, exact: true }).click({ timeout: 1500 });
  await page.getByRole("button", { name: "Autoriser et ouvrir" }).click({ timeout: 1500 });
  await page.waitForFunction(() => document.body.dataset.readReady === "1", null, { timeout: 1500 });
  return { context, page };
}

export function grantImageReviews(current: () => ImageReview) {
  it.each(["gesture", "confirmation"])("should recover real expired read authority before %s beyond 55 seconds", async (stage) => {
    const fixture = current(), { h, network } = fixture, { context, page } = await openPublished(fixture);
    try {
      let expiresAt = await page.evaluate(() => {
        const boot = JSON.parse(document.querySelector("#pw-page-bootstrap")!.textContent!);
        const payload = boot.readGrant.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(payload)).exp * 1000;
      });
      const waitForExpiry = async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, expiresAt - Date.now() + 1100)));
        expect(Date.now()).toBeGreaterThan(expiresAt);
      };
      const before = await effects(h.f), start = network.traffic.length;
      if (stage === "gesture") await waitForExpiry();
      const popup = context.waitForEvent("page");
      const renewed = page.waitForResponse((response) => response.url().endsWith("/__reader/renew") && response.status() === 200);
      await page.getByRole("button", { name: stage === "gesture" ? "Prepare personal.deselect" : "Prepare personal.select", exact: true }).click();
      const app = await popup;
      await app.locator("#pw-confirm").waitFor({ state: "visible", timeout: 1500 });
      const id = new URL(app.url()).pathname.split("/").at(-1)!;
      expect(await effects(h.f)).toEqual(before);
      const { grant } = await (await renewed).json();
      if (stage === "confirmation") {
        expiresAt = JSON.parse(Buffer.from(grant.split(".")[1], "base64url").toString("utf8")).exp * 1000;
        await waitForExpiry();
      }
      const post = app.waitForResponse((response) => response.url().endsWith(`/${id}/confirm`));
      await app.locator("#pw-confirm").click();
      const confirmed = await post; expect(confirmed.status()).toBe(200);
      const receipt = await confirmed.json();
      await page.bringToFront();
      await page.waitForFunction((intentId) => {
        const raw = document.querySelector("#pw-page-receipt")?.textContent;
        const counts = document.querySelector("#pw-live-counts")?.textContent;
        return raw && JSON.parse(raw).intentId === intentId && counts;
      }, id, { timeout: 6000 });
      const after = await effects(h.f);
      for (const [key, delta] of Object.entries(ONE_COMMIT)) expect(after[key], key).toBe(before[key]! + delta);
      const renewals = network.traffic.slice(start).filter((request) => request.path === "/__reader/renew");
      expect(renewals.some((request) => request.status === 401)).toBe(true);
      expect(renewals.some((request) => request.status === 200)).toBe(true);
      expect(receipt.state).toBe("committed");
      expect(app.url()).toBe(`${L5_DOMAIN.appOrigin}/artifact-write/intents/${id}`);
      const live = JSON.parse(await page.locator("#pw-live-state").textContent() ?? "{}");
      expect(live.facets.selection.pertinent.state).toBe(stage === "gesture" ? "inactive" : "active");
      expect(await page.locator("#pw-live-cards").textContent()).not.toBe("");
      writeFileSync(`/evidence/browser-expired-${stage}.json`, JSON.stringify({ stage, expiresAt, completedAt: Date.now(),
        imageSha: process.env.L5_IMAGE_SHA, contentBase: process.env.L5_CONTENT_BASE, id, before, after, renewals }));
    } finally { await context.close(); }
  }, 75000); // The actual server-side 55-second JWT expiry is deliberately observed.
}
