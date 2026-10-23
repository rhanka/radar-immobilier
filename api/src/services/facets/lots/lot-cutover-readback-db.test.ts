// B2 closed readback: internal authorized reads work while public stays closed.
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { lotCutoverState } from "../../../db/schema.js";
import { readLotCity } from "./lot-city.js";
import { readLotCutoverReadback } from "./lot-cutover-readback.js";
import {
  cutoverImportKeyFor,
  defaultCutoverSafety,
  evaluateActivationGate,
  readLotCutover,
  runLotCutover,
} from "./lot-cutover.js";
import {
  cleanCutoverReport,
  CUTOVER_CITY,
  describeDb,
  cutoverFixture,
  recordingCutoverSafety,
} from "./cutover-fixture.js";

describeDb("B2 closed readback and cutover resume", () => {
  it("should read back internally while public city reads stay closed", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    const probe = recordingCutoverSafety();
    const receipt = await runLotCutover(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: cutoverImportKeyFor(f.workspaceId),
      confirmCutover: true, recomputeManifest: async () => report }, probe.safety);
    expect(receipt.status).toBe("complete");
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
    const readback = await readLotCutoverReadback(
      f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY);
    expect(readback.heads.map((head) => head.target.canonicalId).sort())
      .toEqual(["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"]);
    await expect(defaultCutoverSafety(f.db, f.moderator.sub,
      (await evaluateActivationGate(f.db, f.workspaceId, report)).ready)
      .readbackAuthorized(f.workspaceId)).resolves.toBeUndefined();
    await expect(Reflect.apply(readLotCity, undefined,
      [f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY, { readback: true }]))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotCutoverReadback(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 403 });
    await expect(readLotCutoverReadback(f.db, f.moderator.sub, f.workspaceId, "real", ""))
      .rejects.toMatchObject({ status: 400 });
    await f.db.update(lotCutoverState).set({ maintenanceBarrier: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(readLotCutoverReadback(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 409, message: "lot_cutover_barrier_missing" });
  });

  it("should prevent activation without drain/shutdown confirmation", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.activatable).toBe(true);
    await expect(runLotCutover(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: cutoverImportKeyFor(f.workspaceId),
      confirmCutover: true, recomputeManifest: async () => report },
      defaultCutoverSafety(f.db, f.moderator.sub, gate.ready)))
      .rejects.toMatchObject({ status: 503, message: "lot_delivery_retirement_unconfirmed" });
    expect(await readLotCutover(f.db, f.workspaceId))
      .toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
  });
});
