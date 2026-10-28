import { createServer, request } from "node:http";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authorityFixture, APP } from "./pw-write-authority-fixture.js";

// Selected only by the explicit proxy phase, never silently skipped in API CI.
let h: Awaited<ReturnType<typeof authorityFixture>> | undefined;
const server = createServer(getRequestListener((request) => h!.app.fetch(request)));
// Exercise Host on the wire: fetch implementations may replace it from the URL.
function proxyRequest(url: string, init: { headers?: Record<string, string>; method?: string; body?: string } = {}) {
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: init.method ?? "GET", headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode!,
        headers: Object.fromEntries(Object.entries(res.headers).filter(([, value]) => value !== undefined)
          .map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : value!])) })));
    });
    req.on("error", reject); req.end(init.body);
  });
}
beforeAll(async () => {
  server.listen(3000, "0.0.0.0"); await once(server, "listening");
  writeFileSync("/evidence/proxy-ready", "ready\n");
});
afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); });

it.each([["compose", 8080], ["cluster", 8080], ["preprod", 8080]])("should route %s PW requests through its real nginx configuration", async (kind, port) => {
  h = await authorityFixture();
  const prepared = await h.prepare(); expect(prepared.status).toBe(201);
  const id = (await prepared.json()).data.intentId, cookie = await h.cookie(), origin = h.writeApp.domain.appOrigin;
  const headers = { host: new URL(origin).host, cookie, forwarded: "for=foreign;proto=http;host=foreign.test",
    "x-forwarded-host": "foreign.test", "x-forwarded-proto": "http" };
  const base = `http://proxy-${kind}:${port}`;
  const deadline = Date.now() + 10_000;
  let ready = false;
  while (!ready) {
    ready = await proxyRequest(`${base}/health`).then((response) => response.ok, () => false);
    if (Date.now() >= deadline) throw new Error("Owned nginx did not start");
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const summary = await proxyRequest(`${base}/artifact-write/intents/${id}`, { headers });
  expect(summary.status).toBe(200); const boot = await summary.json();
  expect(boot.intentId).toBe(id); expect(typeof boot.challengeToken).toBe("string");
  expect(summary.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(summary.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const confirmed = await proxyRequest(`${base}${APP}/${id}/confirm`, { method: "POST", headers: {
    ...headers, origin, "content-type": "application/json", "x-artifact-write-csrf": boot.csrf,
  }, body: JSON.stringify({ challengeToken: boot.challengeToken }) });
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({ event: { scope: "personal", facet: "selection", state: "active" } });
  const refused = await proxyRequest(`${base}/artifact-write/intents/${id}`, { headers: { ...headers, authorization: "Bearer foreign" } });
  expect(refused.status).toBe(401); expect(refused.headers.get("cache-control")).toBe("private, no-store");
  const returned = await proxyRequest(`${base}${APP}/${id}`, { headers });
  expect(returned.status).toBe(200); expect((await returned.json()).executionState).toBe("committed");
  expect(h.counters().confirms).toBe(1);
  const overlay = readFileSync("../deploy/overlays/preprod/kustomization.yaml", "utf8");
  expect(overlay).toMatch(/name: radar-ui-nginx[\s\S]*?behavior: replace[\s\S]*?default.conf=nginx\/default.conf/);
});
