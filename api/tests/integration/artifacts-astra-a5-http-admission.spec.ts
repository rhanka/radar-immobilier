import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactControl } from "@radar/artifacts-host";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie } from "./artifacts-h2.helpers.js";
import { ALICE, BASE, WORKSPACE, SECOND, live, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";

describe("astra A5 HTTP route membership admission", () => {
  let h: Astra;
  beforeAll(async () => { h = await startAstra("http", 1); });
  afterAll(async () => { await h?.close(); });
  it("should resolve membership at HTTP entry before dispatching reads", async () => {
    const { host } = await h.openHost();
    const backend = createArtifactControl(host, h.config.storageScope, BASE);
    const ensured = await backend.handle("ensure", ALICE, { bindingName: "http", idempotencyKey: "http" });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const route = controlRoute({ auth, accounts: h.pool, backend, readActivation: live });
    const headers = { cookie: await cookie(ALICE), origin: auth.appBaseUrl };
    expect((await route.request("https://app.example.test/list", { headers })).status).toBe(200);
    const before = await h.durable();
    for (const [ids, status, error] of [[[], 403, "workspace_membership_required"],
      [[WORKSPACE, SECOND], 409, "workspace_ambiguous"]] as const) {
      await h.memberships([...ids]);
      for (const path of ["list", `meta?artifactId=${artifactId}`]) {
        const response = await route.request(`https://app.example.test/${path}`, { headers });
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error });
      }
    }
    expect(await h.durable()).toEqual(before);
  });

  it("maps real pool saturation at the complete HTTP route to 503", async () => {
    await h.memberships([WORKSPACE]);
    const { host, control } = await h.openHost();
    const before = await h.durable();
    const held = await h.pool.connect();
    try {
      const route = controlRoute({ auth, accounts: h.pool, backend: control,
        readActivation: live, storageScope: h.config.storageScope });
      const response = await route.request("https://app.example.test/list", {
        headers: { cookie: await cookie(ALICE), origin: auth.appBaseUrl },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "capability_unavailable" });
    } finally { held.release(); host.close(); }
    expect(await h.durable()).toEqual(before);
  });
});
