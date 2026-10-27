import { describe, expect, it } from "vitest";
import { createContentDenyApp } from "./content-deny.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const BASE = "pages.example.net";
const STABLE = `${ARTIFACT}.${BASE}`;
const PINNED = `${RELEASE}.pinned.${BASE}`;

/** Every host form the closed boundary must deny, malformed ones included. */
const HOSTS = [
  STABLE,
  PINNED,
  `${ARTIFACT}.${BASE}:3000`,
  `${RELEASE}.PINNED.${BASE.toUpperCase()}`,
  `${STABLE}.`,
  `not-a-uuid.${BASE}`,
  `nope.pinned.${BASE}`,
  `extra.${STABLE}`,
  `${ARTIFACT}.${RELEASE}.${BASE}`,
  `${ARTIFACT}-${RELEASE}.${BASE}`,
  "other.test",
  BASE,
  "preprod.immo.sent-tech.ca",
  "10.244.0.17",
  "127.0.0.1",
  "nodot",
  "not a host value",
  `${"a".repeat(64)}.${BASE}`,
  `${`${"a".repeat(63)}.`.repeat(4)}${BASE}`,
  `under_score.${BASE}`,
  `x..${BASE}`,
  `.${BASE}`,
  `${STABLE}:invalid`,
  "[::1]",
  "",
];

const app = createContentDenyApp();
const request = (host: string, path: string, init?: RequestInit) =>
  app.request(`http://${BASE}${path}`, {
    ...init,
    headers: { host, ...init?.headers },
  });

function expectDenyHeaders(res: Response): void {
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(res.headers.get("location")).toBeNull();
}

describe("content-deny every host form", () => {
  it.each(HOSTS)("denies API routes with 401 and other paths with 404 on %s", async (host) => {
    const api = await request(host, "/api/v1/auth/me");
    expect(api.status, host).toBe(401);
    expect(await api.json(), host).toEqual({ error: "unauthenticated" });
    expectDenyHeaders(api);
    for (const path of ["/", "/index.html", "/livez/extra"]) {
      const res = await request(host, path);
      expect(res.status, `${host} ${path}`).toBe(404);
      expect(await res.json(), `${host} ${path}`).toEqual({ error: "not_found" });
      expectDenyHeaders(res);
    }
  });

  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("denies %s on pages and API", async (method) => {
    const page = await request(STABLE, "/", { method });
    expect(page.status, method).toBe(404);
    expect(await page.json()).toEqual({ error: "not_found" });
    expectDenyHeaders(page);
    const api = await request(`malformed ${BASE}`, "/api/v1/prospects/notes", {
      method,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(api.status, method).toBe(401);
    expect(await api.json()).toEqual({ error: "unauthenticated" });
    expectDenyHeaders(api);
  });

  it("ignores forwarding headers and cookies in both directions", async () => {
    const forged = await request(`forged.${BASE}`, "/api/v1/auth/me", {
      headers: {
        "x-forwarded-host": STABLE,
        "x-forwarded-proto": "https",
        cookie: "radar_session=dummy",
        accept: "text/html",
      },
    });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "unauthenticated" });
    expectDenyHeaders(forged);
    const page = await request(STABLE, "/", {
      headers: { "x-forwarded-host": "app.example.test", accept: "text/html" },
    });
    expect(page.status).toBe(404);
    expect(await page.json()).toEqual({ error: "not_found" });
    expectDenyHeaders(page);
  });
});

describe("content-deny probes", () => {
  it.each(["GET", "HEAD"])("serves %s /livez and /health without a cookie", async (method) => {
    for (const path of ["/livez", "/health"]) {
      const res = await request(`odd host ${method}`, path, { method });
      expect(res.status, path).toBe(200);
      if (method === "GET") expect(await res.json(), path).toEqual({ status: "ok" });
      else expect(await res.text(), path).toBe("");
      expect(res.headers.get("set-cookie"), path).toBeNull();
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("denies probe paths for other methods", async () => {
    for (const path of ["/livez", "/health"]) {
      const res = await request(STABLE, path, { method: "POST" });
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
      expectDenyHeaders(res);
    }
  });
});
