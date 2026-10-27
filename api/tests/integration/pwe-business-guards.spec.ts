import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect, baseState } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import { effects, NO_EFFECTS, outcome } from "./pwe-fixture.js";

describeDb("PWE-05 HW-07 BASE guards with current 6L1", () => {
  it.each(["head", "version", "reason"] as const)(
    "should preserve the typed %s guard when the prepared scope is current", async (kind) => {
      const f = await workspaceFixture();
      const input = await preparedSelect(f);
      if (kind === "head") input.expectedHeadId = randomUUID();
      if (kind === "version") input.displayedFingerprint = "f".repeat(64);
      if (kind === "reason") {
        input.operation = "facets.signals.personal.discard.v1";
        input.basket = undefined; input.reasonCode = "SYNTHETIC-UNKNOWN";
      }
      const row = await pwPrepared(f, input);
      const before = await baseState(f);
      const result = await outcome(coordinateSignalWrite(f.db, f.contributor.sub, input,
        createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })));
      expect(result.error).toMatchObject({ status: kind === "reason" ? 422 : 409,
        message: { head: "facet_head_conflict", version: "target_version_conflict", reason: "invalid_reason_code" }[kind] });
      expect(await baseState(f)).toEqual(before);
      expect(await effects(f)).toEqual(NO_EFFECTS);
    });
});
