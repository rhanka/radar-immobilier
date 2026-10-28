import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect } from "./signal-write-fixture.js";
import { pwParams, pwConfirmation } from "./pw-write-fixture.js";
import { preparePwWriteIntentGuarded } from "./pw-write-prepare.js";
import { purgePwExpiredPayloads } from "./pw-write-outbox.js";
import { revokePwIntent } from "./pw-write-fences.js";

describeDb("PW-D retention", () => {
  it("should purge old uncommitted payloads while retaining digests and revocations", async () => {
    const f = await workspaceFixture();
    const input = { ...await preparedSelect(f), expiresAtMs: Date.now() - 25 * 3600_000 };
    const params = pwParams(f, input);
    const row = await preparePwWriteIntentGuarded(f.db, params);
    await f.db.transaction((tx) => revokePwIntent(tx, row.intentId, f.contributor.id,
      pwConfirmation(row).principal));
    expect(await f.db.transaction((tx) => purgePwExpiredPayloads(tx))).toBe(1);
    expect(await f.db.transaction((tx) => purgePwExpiredPayloads(tx))).toBe(0);
    const stored = (await f.pool.query("SELECT intent_digest,target,command,revoked_at FROM pw_write_intents")).rows[0];
    expect(stored).toMatchObject({ intent_digest: row.intentDigest, target: {}, command: {} });
    expect(stored.revoked_at).not.toBeNull();
    await expect(preparePwWriteIntentGuarded(f.db, params)).rejects.toThrow("idempotency_key_conflict");
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_key_reservations")).rows[0].n).toBe(1);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_intent_tombstones")).rows[0].n).toBe(1);
  });
});
