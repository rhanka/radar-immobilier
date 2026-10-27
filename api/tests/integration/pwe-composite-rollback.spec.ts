import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect, admitSyntheticWrite, baseState } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import { effects, outcome } from "./pwe-fixture.js";

describeDb("PWE-07 C10 composite event rollback", () => {
  it.each([1, 2, 3])("should undo every composed effect after event %i and retry once", async (position) => {
    const f = await workspaceFixture();
    const selected = await preparedSelect(f);
    const first = await admitSyntheticWrite(f.db, f.contributor.sub, selected);
    const second = await admitSyntheticWrite(f.db, f.contributor.sub, { ...selected, basket: "a_surveiller",
      commandKey: randomUUID(), expectedProjectionToken: first.scopeAfter });
    const input = { ...selected, operation: "facets.signals.personal.discard.v1" as const,
      basket: undefined, reasonCode: "N-NON-RES", deselect: ["pertinent", "a_surveiller"] as ("pertinent" | "a_surveiller")[],
      expectedSelectionHeads: { pertinent: first.event!.id, a_surveiller: second.event!.id },
      commandKey: randomUUID(), expectedProjectionToken: second.scopeAfter };
    const row = await pwPrepared(f, input);
    const execute = () => coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) }));
    const before = await baseState(f);
    const counts = await effects(f);
    expect(counts.events).toBe(2);
    await f.pool.query(`CREATE FUNCTION pwe_composite_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF (SELECT count(*) FROM facet_events) >= ${2 + position}
      THEN RAISE EXCEPTION 'PWE composite event ${position}'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER pwe_composite_failure AFTER INSERT ON facet_events
      FOR EACH ROW EXECUTE FUNCTION pwe_composite_failure()`);
    const failed = await outcome(execute());
    let cause: unknown = failed.error;
    while (cause instanceof Error && cause.cause) cause = cause.cause;
    expect((cause as Error).message).toBe(`PWE composite event ${position}`);
    expect(await baseState(f)).toEqual(before);
    expect(await effects(f)).toEqual(counts);
    await f.pool.query("DROP TRIGGER pwe_composite_failure ON facet_events; DROP FUNCTION pwe_composite_failure()");
    expect((await outcome(execute())).error).toBeNull();
    expect(await effects(f)).toEqual({ events: 5, commands: 3, links: 1, consumed: 1, audits: 1, outbox: 1, debits: 2 });
    expect((await outcome(execute())).error).toMatchObject({ message: "challenge_consumed" });
    expect(await effects(f)).toEqual({ events: 5, commands: 3, links: 1, consumed: 1, audits: 1, outbox: 1, debits: 2 });
  });
});
