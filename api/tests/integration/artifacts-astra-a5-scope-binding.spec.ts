import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createArtifactBinding } from "../../../packages/immo-mcp/src/artifact-binding.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie } from "./artifacts-h2.helpers.js";
import { ALICE, SECOND, WORKSPACE, live, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";

describe("astra A5 scope-bound membership", () => {
  let h: Astra;
  beforeAll(async () => { h = await startAstra("scope"); });
  beforeEach(async () => { await h.memberships([WORKSPACE]); });
  afterAll(async () => { await h?.close(); });

  it("refuses a single foreign workspace at HTTP entry", async () => {
    const { host, control } = await h.openHost();
    try {
      const route = controlRoute({ auth, accounts: h.pool, backend: control,
        readActivation: live, storageScope: h.config.storageScope });
      await h.memberships([SECOND]);
      const res = await route.request("https://app.example.test/list",
        { headers: { cookie: await cookie(ALICE), origin: auth.appBaseUrl } });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "workspace_membership_required" });
    } finally { host.close(); }
  });

  it("refuses a foreign workspace on the production MCP binding", async () => {
    const bound = (await createArtifactBinding({ ...h.bindingEnv }))!;
    try {
      await h.memberships([SECOND]);
      const before = await h.durable();
      const denied = await bound.binding.invoke("artifacts_list", {}, {
        principal: { issuer: "synthetic", sub: ALICE, scopes: ["immo:read", "immo:artifacts:read", "immo:artifacts:write"], claims: [], attributes: {} },
        resource: "synthetic:mcp", correlationId: "scope", signal: new AbortController().signal,
      });
      expect(denied.isError).toBe(true);
      expect(JSON.parse((denied.content[0] as { text: string }).text))
        .toEqual({ error: "workspace_membership_required", retryable: false });
      expect(await h.durable()).toEqual(before);
    } finally { await bound.close(); }
  });

  it("rejects replacement during upload without a durable write", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let enteredResolve!: () => void;
    const enteredGate = new Promise<void>((done) => { enteredResolve = done; });
    const { host, control } = await h.openHost({ ...h.blobs,
      async putBlob(...args: Parameters<typeof h.blobs.putBlob>) {
        enteredResolve(); await gate; return h.blobs.putBlob(...args);
      } });
    try {
      const ensured = await control.handle("ensure", ALICE, { bindingName: "scope-race", idempotencyKey: "scope-race" });
      expect(ensured.status).toBe(201);
      const artifactId = (ensured.body as { artifactId: string }).artifactId;
      const before = await h.durable();
      const pending = control.handle("publish", ALICE, { artifactId, idempotencyKey: "scope-race-publish",
        files: [{ path: "index.html", mimeType: "text/html", text: "replaced" }] });
      await enteredGate;
      await h.memberships([SECOND]);
      release();
      const denied = await pending;
      expect(denied).toMatchObject({ status: 403, body: { error: "workspace_membership_required" } });
      expect(await h.durable()).toEqual(before);
    } finally { release(); host.close(); }
  });

  it("rejects replay after replacement without recharging quota", async () => {
    const { host } = await h.openHost();
    try {
      const request = { method: "POST", path: "/ensure", actorId: ALICE,
        body: { bindingName: "scope-replay", idempotencyKey: "scope-replay" } };
      expect(await host.execute(request, h.invocation(host))).toMatchObject({ ok: true });
      const before = await h.durable();
      await h.memberships([SECOND]);
      expect(await host.execute(request, h.invocation(host))).toMatchObject({ ok: false,
        failure: { publicCode: "workspace_membership_required", httpStatus: 403 } });
      expect(await h.durable()).toEqual(before);
    } finally { host.close(); }
  });
});
