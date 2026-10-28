import { writeFileSync } from "node:fs";
import type { Browser } from "@playwright/test";
import { expect } from "vitest";
import type { imagePublication } from "./l5-image-publication.js";
import type { imageNetwork } from "./l5-image-network.js";
import { L5_DOMAIN } from "./l5-fixture.js";
import { effects } from "./pwe-fixture.js";

export async function imageClosure(variant: "base" | "read", browser: Browser,
  network: Awaited<ReturnType<typeof imageNetwork>>, h: Awaited<ReturnType<typeof imagePublication>>) {
  network.setRuntime(variant === "base" ? "runtime-base" : "runtime-read");
  const context = await browser.newContext(), page = await context.newPage(), before = await effects(h.f);
  try {
    await page.goto(variant === "base" ? `${L5_DOMAIN.appOrigin}/api/v1/auth/login` : `${h.origin}/`);
    await page.getByRole("button", { name: "Reader A" }).click();
    if (variant === "read") {
      await page.getByRole("button", { name: "Autoriser et ouvrir" }).click();
      await page.waitForFunction(() => document.body.dataset.readReady === "1");
      const closed = await page.evaluate(async () => {
        const button = document.querySelector<HTMLButtonElement>("#prepare")!.dataset;
        return (await fetch("/__reader/api/facets.write-intents.prepare.v1", { method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ operation: button.pwOperation, workspaceId: button.pwWorkspace,
            target: { citySlug: button.pwCity, type: button.pwType, id: button.pwId },
            basket: button.pwBasket, expectedHeadId: button.pwExpectedHead || null,
            displayedFingerprint: button.pwFingerprint, expectedProjectionToken: button.pwToken }) })).json();
      });
      expect(closed).toMatchObject({ error: { code: "write_transport_closed", attemptOutcome: "not_executed" } });
      expect(await effects(h.f)).toEqual(before);
    } else {
      await page.waitForURL(`${L5_DOMAIN.appOrigin}/`);
      const result = await page.evaluate(async ({ workspaceId, target }) => {
        const root = `/api/v1/workspaces/${workspaceId}`;
        const me = await (await fetch("/api/v1/auth/me")).json();
        const state = await (await fetch(root + "/signal-facets/state?" + new URLSearchParams(target))).json();
        const abort = new AbortController();
        const stream = await fetch(root + "/signal-facets/projection-events?" +
          new URLSearchParams({ citySlug: target.citySlug, mode: "signal" }), { signal: abort.signal });
        const first = await stream.body!.getReader().read(); abort.abort();
        const response = await fetch(root + "/signal-facets/personal/deselect", { method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ target, basket: "pertinent", expectedHeadId: state.item.facets.selection.pertinent.id,
            displayedFingerprint: state.item.displayedFingerprint }) });
        return { me, stream: { status: stream.status, first: new TextDecoder().decode(first.value) },
          status: response.status, command: await response.json() };
      }, { workspaceId: h.f.workspaceId, target: h.signal.target });
      expect(result.me).toMatchObject({ authenticated: true, user: { sub: h.f.contributor.sub } });
      expect(result.stream.status).toBe(200); expect(result.stream.first).toContain("event: resync");
      expect(result.status).toBe(200); expect(result.command).toMatchObject({ ok: true });
      expect((await effects(h.f)).events).toBe(before.events! + 1);
      expect((await effects(h.f)).consumed).toBe(before.consumed);
    }
    writeFileSync(`/evidence/browser-closure-${variant}.json`, JSON.stringify({
      variant, imageSha: process.env.L5_IMAGE_SHA, before, after: await effects(h.f) }, null, 2));
  } finally { await context.close(); network.setRuntime("runtime"); }
}
