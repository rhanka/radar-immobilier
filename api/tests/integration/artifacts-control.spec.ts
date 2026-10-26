import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { schema } from "../../src/db/schema.js";
import { auth, cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { seedArtifactMemberships } from "./artifacts-membership.helpers.js";

let h: Harness;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  h = await startHarness("control");
  await h.pool.query("INSERT INTO account_users (sub, email, status) VALUES ('alice','alice@example.test','approved'), ('bob','bob@example.test','approved'), ('pending','pending@example.test','pending')");
  await seedArtifactMemberships(h.pool);
  app = makeApp(true);
});
afterAll(async () => { await h?.close(); });
function makeApp(enabled: boolean, backend = h.control) {
  return createApp({ checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    store: {} as ObjectStore, db: drizzle(h.pool, { schema }), auth: { ...auth, enabled },
    contentHost: { enabled: true, contentBase: "pages.example.test" },
    artifactsControl: { auth, accounts: h.pool, backend } });
}
async function request(op: string, body: unknown = {}, options: {
  sub?: string; origin?: string; contentType?: string; host?: string; bearer?: boolean;
  target?: ReturnType<typeof makeApp>; raw?: string; method?: string;
} = {}) {
  const method = options.method ?? "POST";
  return (options.target ?? app).request(`https://app.example.test/api/v1/artifacts/control/${op}`, {
    method, headers: { host: options.host ?? "app.example.test", origin: options.origin ?? auth.appBaseUrl,
      "content-type": options.contentType ?? "application/json",
      ...(options.sub === "anonymous" ? {} : { cookie: await cookie(options.sub ?? "alice") }),
      ...(options.bearer ? { authorization: "Bearer test-only" } : {}) },
    ...(method === "POST" ? { body: options.raw ?? JSON.stringify(body) } : {}),
  });
}
const input = { bindingName: "control", idempotencyKey: "control" };
async function counts() {
  return (await h.pool.query(`SELECT
    (SELECT count(*) FROM artifacts.artifacts) AS artifacts,
    (SELECT count(*) FROM artifacts.releases) AS releases,
    (SELECT count(*) FROM artifacts.idempotency_keys) AS keys`)).rows[0];
}
describe("artifact control HTTP isolation", () => {
  it("rejects unauthenticated, pending, bearer and foreign-origin requests without writes", async () => {
    const before = await counts();
    for (const [options, expected] of [
      [{ sub: "anonymous" }, 401], [{ sub: "pending" }, 403], [{ bearer: true }, 401],
      [{ sub: "anonymous", bearer: true }, 401], [{ origin: "https://foreign.example" }, 403],
      [{ origin: "https://123e4567-e89b-12d3-a456-426614174000.pages.example.test" }, 403],
      [{ contentType: "text/plain" }, 415], [{ contentType: "text/plain; application/json" }, 415],
      [{ raw: "x".repeat(2 * 1024 * 1024 + 1) }, 413],
      [{ host: "123e4567-e89b-12d3-a456-426614174000.pages.example.test" }, 401],
    ] as const) expect((await request("ensure", input, options)).status, JSON.stringify(options).slice(0, 100)).toBe(expected);
    expect((await request("ensure", { ...input, storageScopeId: "forged" })).status).toBe(400);
    expect((await request("ensure", { bindingName: "missing-key" })).status).toBe(400);
    expect((await request("ensure", input, { target: makeApp(false) })).status).toBe(404);
    expect((await request("fork", input)).status).toBe(503);
    expect(await counts()).toEqual(before);
  });
  it("returns identical 404 bodies for another owner's artifact and an unknown artifact", async () => {
    const ensured = await (await request("ensure", input)).json() as { artifactId: string };
    const hidden = await request(`meta?artifactId=${ensured.artifactId}`, {}, { sub: "bob", method: "GET" });
    const unknown = await request("meta?artifactId=123e4567-e89b-12d3-a456-426614174000", {}, { sub: "bob", method: "GET" });
    expect(hidden.status).toBe(404); expect(unknown.status).toBe(404);
    expect(await hidden.json()).toEqual(await unknown.json());
    const publish = await request("publish", { artifactId: ensured.artifactId,
      files: [{ path: "index.html", mimeType: "text/html", text: "hello" }], idempotencyKey: "bob" }, { sub: "bob" });
    expect(publish.status).toBe(404);
    const listed = await (await request("list", {}, { sub: "bob", method: "GET" })).json() as { total: number };
    expect(listed.total).toBe(0);
  });
  it("rejects unsafe publication manifests before writing a release", async () => {
    const { artifactId } = await (await request("ensure", input)).json() as { artifactId: string };
    const before = await counts();
    const base = { path: "index.html", mimeType: "text/html", text: "hello" };
    const badFiles = [
      ...["../index.html", "a\\b", "a//b", "%69ndex.html", "api/test", "__artifacts/x", "health", "livez"].map((path) => [{ ...base, path }]),
      [{ ...base, mimeType: "application/javascript" }], [base, base],
      Array.from({ length: 33 }, (_, i) => ({ ...base, path: `${i}.html` })),
      [{ ...base, text: "é".repeat(131073) }],
      [{ ...base, bytes: [256] }],
    ];
    for (const files of badFiles) {
      expect((await request("publish", { artifactId, files, idempotencyKey: "invalid" })).status).toBe(400);
    }
    expect(await counts()).toEqual(before);
  });
});
