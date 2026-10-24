import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as artifacts from "@radar/artifacts-host";
import { startArtifactControl } from "../../src/artifacts/control-route-startup.js";
import { createApp } from "../../src/app.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import type { ControlRouteDeps } from "../../src/artifacts/control-route.js";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 base without artifact services", () => {
  afterEach(() => vi.restoreAllMocks());
  it("serves lot operations while artifact configuration stays absent", async () => {
    const factories = [vi.spyOn(artifacts, "createArtifactsPool"),
      vi.spyOn(artifacts, "composeArtifactHost"), vi.spyOn(artifacts, "createArtifactControl")];
    const disabled = await startArtifactControl({ input: {}, auth: baseAuth,
      poolParams: { host: "synthetic.invalid", port: 5432, user: "synthetic",
        password: "synthetic", database: "synthetic" }, logger: { info: vi.fn(), error: vi.fn() } });
    expect(disabled).toBeNull();
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const created = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, sub);
    expect(created.status).toBe(200);
    const query = `citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`;
    expect((await f.request(`${f.lotBase}?${query}`, sub)).status).toBe(200);
    const control = await f.app.request("/api/v1/artifacts/control/meta?artifactId=x", {
      headers: { cookie: await baseCookie(sub) } });
    expect(control.status).toBe(503);
    expect(await control.json()).toEqual({ error: "capability_unavailable" });
    for (const factory of factories) expect(factory).not.toHaveBeenCalled();
  });

  it("makes no artifact backend calls during successful base operations", async () => {
    const f = await lotHttpFixture();
    let calls = 0;
    const backend = {
      handle: async () => {
        calls += 1;
        return { status: 503 as const, body: { error: "capability_unavailable" } };
      },
    };
    const deps = {
      auth: baseAuth,
      accounts: { query: async () => ({ rows: [{ status: "approved" }] }) },
      backend,
    } satisfies ControlRouteDeps;
    const app = createApp({ checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore,
      db: f.fixture.db, discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth, artifactsControl: deps });
    const sub = f.fixture.contributor.sub;
    const { target, displayed } = await f.resolve(1);
    const key = randomUUID();
    const command = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" } };
    const created = await app.request(
      `/api/v1/workspaces/${f.fixture.workspaceId}/lot-facets/workspace/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key,
          cookie: await baseCookie(sub) },
        body: JSON.stringify(command),
      });
    expect(created.status).toBe(200);
    const receipt = await created.text();
    const before = await f.sqlSnapshot();
    const replay = await app.request(`${f.lotBase}/workspace/commands`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": key,
        cookie: await baseCookie(sub) }, body: JSON.stringify(command) });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(receipt);
    expect(await f.sqlSnapshot()).toEqual(before);
    const query = `citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`;
    expect((await app.request(`/api/v1/workspaces/${f.fixture.workspaceId}/lot-facets?${query}`,
      { headers: { cookie: await baseCookie(sub) } })).status).toBe(200);
    expect(calls).toBe(0);
    const control = await app.request("/api/v1/artifacts/control/meta?artifactId=x", {
      headers: { cookie: await baseCookie(sub) } });
    expect(control.status).toBe(503);
    expect(calls).toBe(1);
  });

  it("keeps base writes independent of a failing artifact boundary", async () => {
    const f = await lotHttpFixture();
    const deps = {
      auth: baseAuth,
      accounts: { query: async () => ({ rows: [{ status: "approved" }] }) },
      backend: { handle: async (): Promise<never> => {
        throw new Error("synthetic artifact backend must stay unused");
      } },
    } satisfies ControlRouteDeps;
    const app = createApp({ checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore,
      db: f.fixture.db, discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth, artifactsControl: deps });
    const { target, displayed } = await f.resolve(0);
    const created = await app.request(
      `/api/v1/workspaces/${f.fixture.workspaceId}/lot-facets/workspace/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": randomUUID(),
          cookie: await baseCookie(f.fixture.contributor.sub) },
        body: JSON.stringify({ mode: "real", target, displayed_version: displayed,
          expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket } }),
      });
    expect(created.status).toBe(200);
  });

  it("guards the closed control router without artifact business services", async () => {
    const f = await lotHttpFixture();
    const sub = f.fixture.contributor.sub;
    const anonymous = await f.app.request("/api/v1/artifacts/control/meta?artifactId=x");
    expect(anonymous.status).toBe(401);
    const foreign = await f.app.request("/api/v1/artifacts/control/meta?artifactId=x", {
      headers: { cookie: await baseCookie(sub), origin: "https://foreign.invalid" } });
    expect(foreign.status).toBe(403);
    const closed = await f.app.request("/api/v1/artifacts/control/meta?artifactId=x", {
      headers: { cookie: await baseCookie(sub) } });
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
  });
});
