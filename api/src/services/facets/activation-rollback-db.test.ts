import { expect, it } from "vitest";
import { activation, attach, describeDb, event, fixture, safety } from "./scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";

describeDb("6H atomic enforcement replacement", () => {
  it("should rollback the index drop and bindings when epoch switching fails", async () => {
    const f = await fixture();
    const original = await event(f);
    await attach(f);
    await f.pool.query(`CREATE FUNCTION synthetic_epoch_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.writer_epoch = 'scoped' THEN RAISE EXCEPTION 'synthetic swap interruption'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER synthetic_epoch_failure BEFORE UPDATE ON facet_activation_state
      FOR EACH ROW EXECUTE FUNCTION synthetic_epoch_failure()`);
    await expect(runPersonalAttachmentActivation(f.db, activation(f), safety))
      .rejects.toMatchObject({ cause: { message: "synthetic swap interruption" } });
    expect((await f.pool.query("SELECT to_regclass('facet_events_head_idx') AS idx")).rows[0].idx)
      .toBe("facet_events_head_idx");
    expect((await f.pool.query("SELECT writer_epoch, maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ writer_epoch: "legacy", maintenance_barrier: true }]);
    expect((await f.pool.query("SELECT * FROM facet_event_bindings")).rows).toEqual([]);
    expect((await f.pool.query("SELECT id FROM facet_events")).rows).toEqual([{ id: original.id }]);
    await f.pool.query("DROP TRIGGER synthetic_epoch_failure ON facet_activation_state");
    expect(await runPersonalAttachmentActivation(f.db, activation(f), safety)).toMatchObject({ streamsBound: 1 });
  });
});
