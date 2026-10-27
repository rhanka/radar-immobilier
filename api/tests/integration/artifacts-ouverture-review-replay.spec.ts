import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie } from "./artifacts-h2.helpers.js";
import { createArtifactBinding } from "../../../packages/immo-mcp/src/artifact-binding.js";
import { ALICE, SCOPE, bindingRequest, body, general, startOuverture, type Ouverture } from "./artifacts-ouverture.helpers.js";

describe("Astra review: committed replay before the minute bound", () => {
  let h: Ouverture;
  let bound: NonNullable<Awaited<ReturnType<typeof createArtifactBinding>>>;
  let http: ReturnType<typeof controlRoute>;
  let session: string;
  let uploads = 0;
  beforeAll(async () => {
    h = await startOuverture("review_replay");
    bound = (await createArtifactBinding(h.bindingEnv))!;
    http = controlRoute({ auth, accounts: h.pool, backend: h.control,
      readActivation: general, storageScope: SCOPE });
    session = await cookie(ALICE);
    h.beforeUpload(async () => { uploads++; });
  });
  beforeEach(async () => {
    await h.setStatus(ALICE, "approved");
    await h.pool.query("DELETE FROM artifacts.host_actor_rate");
  });
  afterAll(async () => { await bound?.close(); await h?.close(); });

  for (const surface of ["http", "mcp"] as const) {
    for (const operation of ["ensure", "publish"] as const) {
      it(`replays the tenth ${operation} through ${surface} without debit and refuses suspension`, async () => {
        const prefix = `${surface}-${operation}`;
        async function invoke(op: string, args: Record<string, unknown>) {
          if (surface === "mcp") {
            const result = await bound.binding.invoke(`artifacts_${op}`, args, bindingRequest(ALICE));
            return { ok: result.isError !== true, data: body(result) };
          }
          const result = await http.request(`/${op}`, { method: "POST", headers: {
            cookie: session, origin: auth.appBaseUrl, "content-type": "application/json",
          }, body: JSON.stringify(args) });
          return { ok: result.status === 201, data: await result.json() as Record<string, unknown> };
        }
        let artifactId: string | undefined;
        for (let index = 0; index < 9; index++) {
          const key = `${prefix}-${index}`;
          const result = await invoke("ensure", { bindingName: key, idempotencyKey: key });
          expect(result.ok, JSON.stringify(result)).toBe(true);
          artifactId ??= result.data.artifactId;
        }
        const args = operation === "ensure"
          ? { bindingName: `${prefix}-tenth`, idempotencyKey: `${prefix}-tenth` }
          : { artifactId, idempotencyKey: `${prefix}-tenth`, files: [
            { path: "index.html", mimeType: "text/html", text: prefix }] };
        const committed = await invoke(operation, args);
        expect(committed.ok, JSON.stringify(committed)).toBe(true);
        const before = await h.durable();
        const beforeUploads = uploads;
        expect(before.rate).toBe(10);
        const replay = await invoke(operation, args);
        expect(replay.ok, JSON.stringify(replay)).toBe(true);
        if (operation === "publish") expect(replay.data).toEqual(committed.data);
        else expect(replay.data).toMatchObject({ artifactId: committed.data.artifactId, replayed: true });
        expect(await h.durable()).toEqual(before);
        expect(uploads).toBe(beforeUploads);
        const capped = await invoke("ensure", { bindingName: `${prefix}-new`, idempotencyKey: `${prefix}-new` });
        expect(capped).toMatchObject({ ok: false, data: { error: "rate_limited", retryable: true } });
        expect(await h.durable()).toEqual(before);
        await h.setStatus(ALICE, "suspended");
        expect(await invoke(operation, args)).toMatchObject({ ok: false, data: { error: "account_not_approved" } });
        expect(await h.durable()).toEqual(before);
        expect(uploads).toBe(beforeUploads);
      });
    }
  }
});
