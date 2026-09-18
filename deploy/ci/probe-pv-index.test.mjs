import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { cities, parseCities, probe, requestHeaders } from "./probe-pv-index.mjs";

test("built-in URLs and user agent match the adapter configuration", async () => {
  const source = await readFile(new URL("../../packages/radar-sources/src/sources/proces-verbaux-generic.ts", import.meta.url), "utf8");
  for (const [city, url] of Object.entries(cities)) {
    assert.ok(source.includes(`citySlug: "${city}",\n  pvIndexUrl: "${url}"`));
  }
  assert.ok(source.includes(`"${requestHeaders(false)["user-agent"]}"`));
  assert.deepEqual(requestHeaders(false), {
    "user-agent": "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)", accept: "text/html",
  });
  assert.deepEqual(requestHeaders(true), {
    ...requestHeaders(false), accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "fr-CA,fr;q=0.9",
  });
});

test("validates the whole input list before sending requests", () => {
  assert.equal(parseCities(["drummondville", "saint-henri"]).length, 2);
  assert.deepEqual(parseCities(["test=https://example.org/pv?year=2026"]), [{ city: "test", url: "https://example.org/pv?year=2026" }]);
  for (const args of [[], ["unknown"], ["test=ftp://example.org"], ["test=https://user:pass@example.org"]]) {
    assert.throws(() => parseCities(args));
  }
});

test("paces both variants and redirect hops, recording only allowed response metadata", async () => {
  const requests = [], lines = [], waits = [];
  let time = 0;
  await probe(parseCities(["drummondville", "saint-henri"]), {
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; },
    emit: (line) => lines.push(line),
    fetchImpl: async (url, init) => {
      requests.push({ url, ...init, time });
      time += 17;
      return new globalThis.Response("BODY_SECRET", { status: requests.length === 1 ? 302 : 404, headers: {
        server: "cloudflare", "cf-ray": "ray", "cf-mitigated": "challenge",
        location: "/redirect", "content-type": "text/html", authorization: "AUTH_SECRET", "set-cookie": "COOKIE_SECRET",
      } });
    },
  });
  assert.equal(requests.length, 5);
  assert.deepEqual(waits, [2000, 2000, 2000, 2000]);
  for (let i = 1; i < requests.length; i++) assert.ok(requests[i].time - requests[i - 1].time >= 2000);
  assert.deepEqual(requests.map((r) => r.headers), [false, false, true, false, true].map(requestHeaders));
  assert.ok(requests.every((r) => r.redirect === "manual"));
  assert.equal(lines[1].url, "https://www.drummondville.ca/redirect");
  assert.equal(lines[0].httpStatus, 302);
  assert.ok(lines.every((l) => l.phase === "index" && l.durationMs === 17));
  assert.deepEqual(lines[0].headers, { server: "cloudflare", "cf-ray": "ray", "cf-mitigated": "challenge", location: "/redirect", "content-type": "text/html" });
  assert.doesNotMatch(JSON.stringify(lines), /BODY_SECRET|AUTH_SECRET|COOKIE_SECRET|authorization|set-cookie/);
});

test("continues after transport failure without serializing the error", async () => {
  const lines = [];
  await probe(parseCities(["drummondville"]), {
    wait: async () => {}, emit: (line) => lines.push(line),
    fetchImpl: async () => { throw new Error("AUTH_SECRET"); },
  });
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.httpStatus === null && l.error === "Transport failure or timeout"));
  assert.doesNotMatch(JSON.stringify(lines), /AUTH_SECRET/);
});
