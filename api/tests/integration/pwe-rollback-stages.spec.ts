import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { effects, NO_EFFECTS, ONE_COMMIT, outcome, writeFixture } from "./pwe-fixture.js";

describeDb("PWE-07 C10 durable failure stages", () => {
  it.each([
    { stage: "consumption", table: "pw_write_intents", event: "UPDATE", predicate: "NEW.challenge_state='consumed'" },
    { stage: "admission quota", table: "pw_write_quota_ledger", event: "INSERT", predicate: "NEW.kind='admission'" },
    { stage: "business event", table: "facet_events", event: "INSERT", predicate: "true" },
    { stage: "BASE receipt", table: "facet_commands", event: "INSERT", predicate: "true" },
    { stage: "receipt link", table: "pw_write_receipt_links", event: "INSERT", predicate: "true" },
    { stage: "audit", table: "pw_write_audit", event: "INSERT", predicate: "NEW.result='committed'" },
    { stage: "outbox", table: "pw_write_outbox", event: "INSERT", predicate: "NEW.kind='write_committed'" },
  ])("should roll back after $stage and permit exactly one retry", async ({ table, event, predicate, stage }) => {
    const h = await writeFixture();
    const before = await baseState(h.f);
    await h.f.pool.query(`CREATE FUNCTION pwe_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF ${predicate} THEN RAISE EXCEPTION 'PWE failure after ${stage}'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER pwe_failure AFTER ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION pwe_failure()`);
    const result = await outcome(h.execute());
    expect(result.error, `Failure must reach the selected ${stage} hook`).not.toBeNull();
    let cause: unknown = result.error;
    while (cause instanceof Error && cause.cause) cause = cause.cause;
    expect((cause as Error).message).toContain(`PWE failure after ${stage}`);
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
    expect(await baseState(h.f)).toEqual(before);
    expect((await h.f.pool.query("SELECT challenge_state,execution_state FROM pw_write_intents")).rows)
      .toEqual([{ challenge_state: "pending", execution_state: "pending" }]);
    await h.f.pool.query(`DROP TRIGGER pwe_failure ON ${table}; DROP FUNCTION pwe_failure()`);
    expect((await outcome(h.execute())).error).toBeNull();
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
    expect((await outcome(h.execute())).error).toMatchObject({ message: "challenge_consumed" });
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
  });
});
