import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { pwParams } from "../../src/services/facets/pw-write-fixture.js";
import { pwIntentDigest } from "../../src/services/facets/pw-write-digests.js";
import { signalWriteOperationDigest } from "../../src/services/facets/signal-write-operations.js";

describeDb("PWE-04 immutable binding dimensions", () => {
  it.each(["commandKey", "pageInstanceId", "expectedProjectionToken"] as const)(
    "should bind %s independently of the immutable command", async (field) => {
      const f = await workspaceFixture();
      const params = pwParams(f, await preparedSelect(f));
      const original = pwIntentDigest(params.binding, params.command);
      const value = field === "commandKey" ? randomUUID() : field === "expectedProjectionToken" ? "f".repeat(64) : randomUUID();
      expect(pwIntentDigest({ ...params.binding, [field]: value }, params.command)).not.toBe(original);
    });

  it("should bind different deselection masks with equal expected head values and command keys", async () => {
    const f = await workspaceFixture();
    const selected = await preparedSelect(f);
    const discard = { ...selected, operation: "facets.signals.personal.discard.v1" as const, basket: undefined,
      reasonCode: "N-NON-RES" };
    const first = signalWriteOperationDigest({ ...discard, deselect: ["pertinent"], expectedSelectionHeads: { pertinent: null } });
    const second = signalWriteOperationDigest({ ...discard, deselect: ["a_surveiller"], expectedSelectionHeads: { a_surveiller: null } });
    expect(first).not.toBe(second);
  });
});
