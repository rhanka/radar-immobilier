import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { imagePublication } from "./l5-image-publication.js";
import { imageNetwork } from "./l5-image-network.js";
import { L5_DOMAIN } from "./l5-fixture.js";
import { effects, ONE_COMMIT } from "./pwe-fixture.js";
import { imageClosure } from "./l5-image-closures.js";
import { grantImageReviews } from "./l5-review-image-grants.js";
import { deadlineImageReviews } from "./l5-review-image-deadlines.js";
import { statusImageReviews } from "./l5-review-image-status.js";

let h: Awaited<ReturnType<typeof imagePublication>>;
let network: Awaited<ReturnType<typeof imageNetwork>>;
let browser: Browser;
const contentBase = process.env.L5_CONTENT_BASE!;
beforeAll(async () => {
  h = await imagePublication(contentBase);
  const entries = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries as Array<{ tag: string; when: number }>;
  const expected = entries.map((entry) => ({ hash: createHash("sha256")
    .update(readFileSync(`drizzle/${entry.tag}.sql`)).digest("hex"), created_at: String(entry.when) }));
  const history = (await h.f.pool.query("SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
  expect(history).toEqual(expected);
  expect(entries.at(-1)?.tag).toBe("0027_pw_write_persistence");
  writeFileSync("/evidence/image-database-migrations.json", JSON.stringify({
    imageSha: process.env.L5_IMAGE_SHA, database: h.f.name, entries, history }, null, 2));
  network = await imageNetwork([h.f.contributor.sub, h.f.moderator.sub]);
  writeFileSync("/evidence/fixture-ready.json", JSON.stringify({ database: h.f.name, scope: h.scope }));
  for (const service of ["runtime", "runtime-base", "runtime-read"]) {
    const deadline = Date.now() + 30_000;
    while (true) {
      const response = await fetch(`http://${service}:3000/health`).catch(() => null);
      if (response?.ok) { expect((await response.json()).sha).toBe(process.env.L5_IMAGE_SHA); break; }
      if (Date.now() > deadline) throw new Error(`Exact runtime image ${service} did not become healthy`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--no-proxy-server",
    `--ignore-certificate-errors-spki-list=${process.env.L5_CERT_SPKI}`,
    "--host-resolver-rules=MAP preprod.immo.sent-tech.ca 127.0.0.1, MAP preprod.auth.sent-tech.ca 127.0.0.1, MAP *.sent-tech.ca 127.0.0.1, MAP *.reader.test 127.0.0.1"] });
}, 60_000);
afterAll(async () => {
  if (h) {
    writeFileSync("/evidence/runtime-stop-request", "Stop image clients before fixture database teardown\n");
    const deadline = Date.now() + 20_000;
    while (!existsSync("/evidence/runtime-stopped")) {
      if (Date.now() > deadline) throw new Error("Runtime shutdown was not acknowledged");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await browser?.close(); await network?.close(); await h?.close();
}, 30_000);


it.each([0, 1])("should read and confirm a published write through normal image login for reader %s", async (reader) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const before = await effects(h.f), start = network.traffic.length;
    await page.goto(`${h.origin}/`);
    await page.getByRole("button", { name: reader === 0 ? "Reader A" : "Reader B" }).click({ timeout: 1500 });
    await page.getByRole("button", { name: "Autoriser et ouvrir" }).click({ timeout: 1500 });
    await page.waitForFunction(() => document.body.dataset.readReady === "1", null, { timeout: 1500 });
    expect(new URL(page.url()).host).toBe(h.pageHost);
    const initial = JSON.parse(await page.locator("body").getAttribute("data-selection") ?? "{}");
    expect(initial[reader === 0 ? "pertinent" : "a_surveiller"]?.state).toBe("active");
    expect(initial[reader === 0 ? "a_surveiller" : "pertinent"]).toBeNull();
    expect(await page.evaluate(() => document.cookie)).toBe("");
    const cookies = await context.cookies();
    for (const name of ["radar_session", "__Host-preview-session"]) {
      const cookie = cookies.find((value) => value.name === name)!;
      expect(cookie.secure && cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("Lax");
      expect(cookie.domain.startsWith(".")).toBe(false);
      expect(cookie.domain).toBe(name === "radar_session" ? new URL(L5_DOMAIN.appOrigin).host : h.pageHost);
    }
    if (reader === 1) await page.evaluate(() => { window.open = () => null; });
    const popup = context.waitForEvent("page", { timeout: 5000 });
    await page.getByRole("button", { name: "Prepare selection" }).click();
    if (reader === 1) await page.getByRole("link", { name: "Open in the application", exact: true }).click();
    const app = await popup;
    await app.waitForURL(`${L5_DOMAIN.appOrigin}/artifact-write/intents/*`, { timeout: 1500 });
    await app.locator("#pw-confirm").waitFor({ state: "visible", timeout: 1500 });
    expect(await effects(h.f)).toEqual(before);
    expect(await app.evaluate(() => window.opener)).toBeNull();
    const id = new URL(app.url()).pathname.split("/").at(-1)!;
    const body = await page.content(); expect(body).not.toMatch(/challengeToken|radar_session=/);
    const guards = await app.evaluate(async (intentId) => {
      const boot = JSON.parse(document.querySelector("#pw-bootstrap")!.textContent!);
      const results = [];
      for (const credentials of ["omit", "same-origin"] as const) {
        results.push((await fetch(`/artifact-write/intents/${intentId}`, {
          credentials, headers: { authorization: "Bearer synthetic" } })).status);
      }
      for (const csrf of ["", boot.csrf + "x"]) {
        results.push((await fetch(`/api/v1/artifacts/write-intents/${intentId}/confirm`, { method: "POST",
          headers: { "content-type": "application/json", "x-artifact-write-csrf": csrf },
          body: JSON.stringify({ challengeToken: boot.challengeToken }) })).status);
      }
      return results;
    }, id);
    expect(guards).toEqual([401, 401, 403, 403]);
    expect(await page.evaluate(async (url) =>
      fetch(url, { credentials: "include" }).then(() => "leaked", () => "blocked"),
    `${L5_DOMAIN.appOrigin}/artifact-write/intents/${id}`)).toBe("blocked");
    expect(await effects(h.f)).toEqual(before);
    let receipt: Record<string, unknown>;
    if (reader === 0) {
      const lostBefore = network.lostResponses();
      network.loseNextConfirmResponse();
      await app.locator("#pw-confirm").click();
      await expect.poll(() => network.lostResponses(), { timeout: 3000 }).toBe(lostBefore + 1);
      receipt = await app.evaluate(async (intentId) =>
        (await fetch(`/api/v1/artifacts/write-intents/${intentId}`)).json(), id);
    } else {
      const post = app.waitForResponse((response) => response.url().endsWith(`/${id}/confirm`));
      await app.locator("#pw-confirm").click(); const confirmed = await post;
      expect(confirmed.status()).toBe(200); receipt = await confirmed.json();
    }
    expect(receipt.state).toBe("committed");
    const after = await effects(h.f); expect(after.events).toBe(before.events! + 1);
    for (const [key, delta] of Object.entries(ONE_COMMIT)) expect(after[key], key).toBe(before[key]! + delta);
    await page.bringToFront();
    await page.waitForFunction(() => {
      const receipt = document.querySelector("#pw-page-receipt")?.textContent;
      const state = document.querySelector("#pw-live-state")?.textContent;
      const counts = document.querySelector("#pw-live-counts")?.textContent;
      return receipt && JSON.parse(receipt).state === "committed" && state && counts;
    }, null, { timeout: 6000 });
    const state = JSON.parse(await page.locator("#pw-live-state").textContent() ?? "{}");
    expect(state.facets.selection.pertinent.state).toBe("active");
    expect(state.facets.selection.a_surveiller.state).toBe("active");
    const restored = await app.evaluate(async (intentId) => {
      const response = await fetch(`/api/v1/artifacts/write-intents/${intentId}`); return response.json();
    }, id);
    expect(restored).toMatchObject({ state: "committed", commandId: receipt.commandId, receipt: receipt.receipt });
    const replay = await app.evaluate(async (intentId) => {
      const boot = JSON.parse(document.querySelector("#pw-bootstrap")!.textContent!);
      return (await fetch(`/api/v1/artifacts/write-intents/${intentId}/confirm`, { method: "POST",
        headers: { "content-type": "application/json", "x-artifact-write-csrf": boot.csrf },
        body: JSON.stringify({ challengeToken: boot.challengeToken }) })).status;
    }, id);
    expect(replay).toBe(409);
    await expect.poll(() => effects(h.f), { timeout: 1500 }).toEqual(after);
    await context.clearCookies({ name: "__Host-preview-session" });
    const withoutP = await app.evaluate(async (intentId) =>
      (await fetch(`/api/v1/artifacts/write-intents/${intentId}`)).json(), id);
    expect(withoutP).toMatchObject({ state: "committed", receipt: receipt.receipt });
    const requests = network.traffic.slice(start);
    const navigation = requests.find((request) => request.path === `/artifact-write/intents/${id}`)!;
    expect(navigation).toMatchObject({ method: "GET", site: contentBase.endsWith("sent-tech.ca") ? "same-site" : "cross-site",
      mode: "navigate", dest: "document", status: 200 });
    expect(navigation.isolation.coop).toBe("same-origin");
    expect(navigation.isolation.csp).toContain("frame-ancestors 'none'");
    expect(navigation.isolation.cache).toContain("no-store");
    expect(requests.filter((request) => request.host === h.pageHost).every((request) => !request.cookieNames.includes("radar_session"))).toBe(true);
    writeFileSync(`/evidence/browser-reader-${reader}.json`, JSON.stringify({ reader, contentBase, imageSha: process.env.L5_IMAGE_SHA,
      normalOidcExchanges: network.exchanges(), before, after, navigation, requests }, null, 2));
  } finally { await context.close(); }
});
grantImageReviews(() => ({ h, network, browser }));
deadlineImageReviews(() => ({ h, network, browser }));
statusImageReviews(() => ({ h, network, browser }));

it("should execute all six published gestures and close on a real ACL withdrawal", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const receipts = [];
  try {
    await page.goto(`${h.origin}/`);
    await page.getByRole("button", { name: "Reader B" }).click();
    await page.getByRole("button", { name: "Autoriser et ouvrir" }).click();
    await page.waitForFunction(() => document.body.dataset.readReady === "1");
    for (const operation of ["personal.deselect", "personal.select", "personal.discard",
      "personal.restore", "workspace.discard", "workspace.restore"]) {
      const before = await effects(h.f), popup = context.waitForEvent("page");
      await page.getByRole("button", { name: `Prepare ${operation}`, exact: true }).click();
      const app = await popup;
      try {
        await app.locator("#pw-confirm").waitFor({ state: "visible" });
        expect(await effects(h.f)).toEqual(before);
        const id = new URL(app.url()).pathname.split("/").at(-1)!;
        const post = app.waitForResponse((response) => response.url().endsWith(`/${id}/confirm`));
        await app.locator("#pw-confirm").click();
        const response = await post;
        expect(response.status()).toBe(200);
        const receipt = await response.json(); receipts.push({ operation, id, receipt });
        const after = await effects(h.f);
        for (const [key, delta] of Object.entries(ONE_COMMIT)) expect(after[key], key).toBe(before[key]! + delta);
        await page.bringToFront();
        await page.waitForFunction((intentId) => {
          const note = document.querySelector("#pw-page-receipt")?.textContent;
          return note && JSON.parse(note).intentId === intentId;
        }, id);
        await expect.poll(async () => {
          const raw = await page.locator("#pw-live-state").textContent();
          const state = JSON.parse(raw ?? "{}").facets;
          if (operation.endsWith("discard")) return state?.archive[operation.split(".")[0]!]?.state;
          if (operation.endsWith("restore")) return state?.archive[operation.split(".")[0]!]?.state;
          return state?.selection.pertinent?.state;
        }).toBe(operation.endsWith("deselect") || operation.endsWith("restore") ? "inactive" : "active");
      } finally { await app.close(); }
    }
    const before = await effects(h.f), popup = context.waitForEvent("page");
    await page.getByRole("button", { name: "Prepare personal.select", exact: true }).click();
    const app = await popup;
    await app.locator("#pw-confirm").waitFor({ state: "visible" });
    const id = new URL(app.url()).pathname.split("/").at(-1)!;
    await h.f.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2",
      [h.artifactId, h.f.moderator.sub]);
    const denied = app.waitForResponse((response) => response.url().endsWith(`/${id}/confirm`));
    await app.locator("#pw-confirm").click(); expect((await denied).status()).toBe(403);
    await app.reload();
    expect(await app.locator("#pw-confirm").count()).toBe(0);
    const revoke = app.waitForResponse((response) => response.url().endsWith(`/${id}/revoke`));
    await app.locator("#pw-revoke").click(); expect((await revoke).status()).toBe(200);
    expect(await effects(h.f)).toEqual(before);
    writeFileSync("/evidence/browser-six-operations.json", JSON.stringify({ imageSha: process.env.L5_IMAGE_SHA,
      contentBase, receipts, revokedIntent: id, effects: before }, null, 2));
  } finally { await context.close(); }
}, 60_000);

it.each(["base", "read"] as const)("should preserve CT-9 under the %s image closure", async (variant) => {
  await imageClosure(variant, browser, network, h);
}, 30_000);
