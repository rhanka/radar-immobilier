import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { pwParams, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { preparePwWriteIntentGuarded } from "../../src/services/facets/pw-write-prepare.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import { revokePwIntent } from "../../src/services/facets/pw-write-fences.js";
import { effects, outcome } from "./pwe-fixture.js";

describeDb("PWE-09 C12 shared durable no-op quotas", () => {
  it("should aggregate reader admission across six P grants and artifacts and charge each no-op once", async () => {
    const f = await workspaceFixture();
    const selected = await preparedSelect(f);
    const inputs = [];
    for (let index = 0; index < 6; index++) {
      const input = { ...selected, operation: "facets.signals.personal.restore.v1" as const,
        basket: undefined, commandKey: randomUUID() };
      const params = pwParams(f, input);
      params.artifactRef = { ...params.artifactRef, artifactId: `synthetic-quota-${index}` };
      params.binding.artifactRef = params.artifactRef;
      const row = await preparePwWriteIntentGuarded(f.db, params);
      inputs.push({ input, row, proof: pwConfirmation(row) });
    }
    expect(new Set(inputs.map(({ row }) => row.pageSessionId)).size).toBe(6);
    expect(new Set(inputs.map(({ row }) => row.grantReference)).size).toBe(6);
    const run = (item: typeof inputs[number]) => coordinateSignalWrite(f.db, f.contributor.sub, item.input,
      createDurableWriteAdmission(item.row.intentId, { confirmation: item.proof }));
    const results = await Promise.all(inputs.map((item) => outcome(run(item))));
    expect(results.filter((item) => item.error === null)).toHaveLength(5);
    expect(results.find((item) => item.error !== null)?.error)
      .toMatchObject({ status: 429, message: "write_quota_exceeded" });
    const committed = inputs.filter((_, index) => results[index]!.error === null);
    for (const item of committed) expect((await outcome(run(item))).error).toMatchObject({ message: "challenge_consumed" });
    expect(await effects(f)).toEqual({ events: 0, commands: 5, links: 5, consumed: 5, audits: 5, outbox: 5, debits: 10 });
    const refused = inputs.find((_, index) => results[index]!.error !== null)!;
    expect(await f.db.transaction((tx) => revokePwIntent(tx, refused.row.intentId, f.contributor.id, refused.proof.principal)))
      .toEqual({ committed: false });
    expect(await effects(f)).toEqual({ events: 0, commands: 5, links: 5, consumed: 5, audits: 5, outbox: 5, debits: 10 });
  });

  it("should aggregate the workspace burst across readers and roll back the losing reader debit", async () => {
    const f = await workspaceFixture();
    const selected = await preparedSelect(f);
    const inputs = [];
    for (const person of [f.contributor, f.moderator]) {
      const scope = await readProjectionScope(f.db, person.sub, f.workspaceId, selected.target.citySlug, "signal");
      const input = { ...selected, operation: "facets.signals.personal.restore.v1" as const,
        basket: undefined, commandKey: randomUUID(), expectedProjectionToken: scope.token };
      const row = await preparePwWriteIntentGuarded(f.db, pwParams({ ...f, contributor: person }, input));
      inputs.push({ input, row, person });
    }
    await f.pool.query(`INSERT INTO pw_write_quota_ledger(kind,bucket,created_at)
      SELECT 'admission',$1,clock_timestamp() FROM generate_series(1,19)`, [`admission:workspace:${f.workspaceId}`]);
    const results = await Promise.all(inputs.map(({ input, row, person }) => outcome(coordinateSignalWrite(f.db, person.sub,
      input, createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })))));
    expect(results.filter((item) => item.error === null)).toHaveLength(1);
    expect(results.find((item) => item.error !== null)?.error).toMatchObject({ status: 429, message: "write_quota_exceeded" });
    expect(await effects(f)).toEqual({ events: 0, commands: 1, links: 1, consumed: 1, audits: 1, outbox: 1, debits: 21 });
  });
});
