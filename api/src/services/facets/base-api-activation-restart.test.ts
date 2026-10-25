/** Guarded restart: durable retirement never defaults to serving on doubt. */
import { describe, expect, it } from "vitest";
import type { Database } from "../../db/client.js";
import { legacyFenceStatus, readDurableLegacyRetirement } from "./legacy-retirement.js";

function stubDb(rows: unknown[] | Error): Database {
  return { select: () => ({ from: async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  } }) } as unknown as Database;
}

const legacyClosed = { writerEpoch: "legacy", maintenanceBarrier: true, oldIndexDropped: false };
const scopedClosed = { writerEpoch: "scoped", maintenanceBarrier: true, oldIndexDropped: true };
const scopedOpen = { writerEpoch: "scoped", maintenanceBarrier: false, oldIndexDropped: true };
const legacyOpen = { writerEpoch: "legacy", maintenanceBarrier: false, oldIndexDropped: false };

describe("durable legacy retirement restart", () => {
  it("keeps serving only on proven absence of cutover", async () => {
    await expect(readDurableLegacyRetirement(stubDb([]))).resolves.toBeUndefined();
    await expect(readDurableLegacyRetirement(stubDb([legacyOpen]))).resolves.toBeUndefined();
    expect(legacyFenceStatus(undefined)).toBeNull();
  });
  it.each([[legacyClosed], [scopedClosed]])("stays cutover-closed while a barrier is closed (%o)", async (row) => {
    const state = await readDurableLegacyRetirement(stubDb([legacyOpen, row]));
    expect(state).toBe("cutover-closed");
    expect(legacyFenceStatus(state)).toBe(503);
  });
  it("retires once a scoped epoch is durably open", async () => {
    const state = await readDurableLegacyRetirement(stubDb([legacyOpen, scopedOpen]));
    expect(state).toBe("retired");
    expect(legacyFenceStatus(state)).toBe(410);
  });
  it.each([
    ["unknown epoch", [{ ...legacyOpen, writerEpoch: "draft" }]],
    ["incoherent legacy index", [{ ...legacyOpen, oldIndexDropped: true }]],
  ])("rejects %s instead of serving", async (_label, rows) => {
    await expect(readDurableLegacyRetirement(stubDb(rows))).rejects.toMatchObject({
      status: 503, message: "durable_retirement_ambiguous",
    });
  });
  it("rejects read failures so the caller starts closed", async () => {
    await expect(readDurableLegacyRetirement(stubDb(new Error("db unreachable")))).rejects.toThrow("db unreachable");
  });
});
