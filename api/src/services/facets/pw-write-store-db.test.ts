import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect } from "./signal-write-fixture.js";
import { preparePwWriteIntentGuarded } from "./pw-write-prepare.js";
import { pwParams } from "./pw-write-fixture.js";

describeDb("PW-D intent store", () => {
  it("should bind the resolved actor to the verified principal subject", async () => {
    const f = await workspaceFixture();
    const params = pwParams(f, await preparedSelect(f));
    params.actorId = f.moderator.id;
    await expect(preparePwWriteIntentGuarded(f.db, params))
      .rejects.toMatchObject({ message: "confirmation_identity_mismatch" });
  });

  it("should return the same intent for an exact preparation replay", async () => {
    const f = await workspaceFixture();
    const params = pwParams(f, await preparedSelect(f));
    const first = await preparePwWriteIntentGuarded(f.db, params);
    const second = await preparePwWriteIntentGuarded(f.db, params);
    expect(second).toEqual(first);
    const renewed = { ...pwParams(f, params.command as Parameters<typeof pwParams>[1]),
      binding: { ...params.binding, intentId: crypto.randomUUID(), invocationId: crypto.randomUUID(),
        grantReference: "renewed-grant", expiresAtMs: params.binding.expiresAtMs + 30_000 },
      command: { ...(params.command as object), expiresAtMs: params.binding.expiresAtMs + 30_000 } };
    expect(await preparePwWriteIntentGuarded(f.db, renewed)).toEqual(first);
  });

  it.each(["body", "page", "issuer", "tier", "projection"])(
    "should refuse the same key prepared with another %s", async (change) => {
      const f = await workspaceFixture();
      const input = await preparedSelect(f);
      const params = pwParams(f, input);
      await preparePwWriteIntentGuarded(f.db, params);
      if (change === "body") params.command = { ...input, basket: "a_surveiller" };
      if (change === "page") params.binding.pageInstanceId = "another-page";
      if (change === "issuer") params.binding.principal.issuer = "https://other.example.test";
      if (change === "tier") params.binding.principal.tier = "prod";
      if (change === "projection") params.binding.expectedProjectionToken = "f".repeat(64);
      await expect(preparePwWriteIntentGuarded(f.db, params))
        .rejects.toMatchObject({ message: "idempotency_key_conflict" });
    });

  it("should cap concurrent pending intents per session and replay at the cap", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const params = pwParams(f, input);
    const attempts = Array.from({ length: 7 }, () => {
      const next = pwParams(f, { ...input, commandKey: crypto.randomUUID() });
      next.binding.pageSessionId = params.binding.pageSessionId;
      next.binding.authorityReferences.page_session = params.binding.pageSessionId;
      return next;
    });
    const results = await Promise.allSettled(attempts.map((p) => preparePwWriteIntentGuarded(f.db, p)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
    const index = results.findIndex((result) => result.status === "fulfilled");
    expect(await preparePwWriteIntentGuarded(f.db, attempts[index]!))
      .toEqual((results[index] as PromiseFulfilledResult<unknown>).value);
  });
});
