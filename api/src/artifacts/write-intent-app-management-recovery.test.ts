// @vitest-environment jsdom
import { runInNewContext } from "node:vm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import type { PwIntentRow } from "../services/facets/pw-write-store.js";
import { renderWriteIntentManagement } from "./write-intent-app-page.js";

it.each(["transport", "corps", "réseau"])("rend le rechargement accessible dans le vrai document après une révocation incertaine : %s", async (stage) => {
  const id = "11111111-1111-4111-8111-111111111111", path = `/artifact-write/intents/${id}`;
  const app = new Hono();
  app.get(path, (c) => renderWriteIntentManagement(c, { intentId: id } as PwIntentRow, { csrf: "csrf" }));
  const response = await app.request(path);
  expect(response.status).toBe(200);
  document.documentElement.innerHTML = await response.text();
  expect(document.getElementById("pw-manage-box")).toBeNull();
  const script = [...document.scripts].find((node) => !node.id)!.textContent!;
  const reload = document.getElementById("pw-reload-box")!;
  const revoke = document.getElementById("pw-revoke") as HTMLButtonElement;
  expect(reload.hidden).toBe(true);
  expect(document.getElementById("pw-reload")!.getAttribute("href")).toBe(path);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const timers: Array<{ fn: () => void; delay: number }> = [];
  const calls: string[] = [];
  runInNewContext(script, { document, window: {}, AbortController,
    setTimeout: (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    fetch: async (url: string) => {
      calls.push(url);
      if (stage === "réseau") throw new Error("Connexion coupée");
      if (stage === "transport") await held;
      return { status: 200, headers: new Headers(), json: async () => {
        if (stage === "corps") await held;
        return { authorizationState: "revoked", commandState: "not_committed" };
      } };
    },
  });
  revoke.click();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  if (stage !== "réseau") timers.find((timer) => timer.delay === 15000)!.fn();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(revoke.disabled).toBe(false);
  expect(document.getElementById("pw-note")!.textContent).toContain("Result to verify");
  expect(reload.hidden).toBe(false);
  const note = document.getElementById("pw-note")!.textContent;
  release();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(document.getElementById("pw-note")!.textContent).toBe(note);
  expect(calls).toEqual([`/api/v1/artifacts/write-intents/${id}/revoke`]);
  document.documentElement.innerHTML = "";
});
