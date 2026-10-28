import { expect, it } from "vitest";
import { projectWriteIntentStatus } from "./write-intent-status.js";
import type { PwIntentRow } from "../services/facets/pw-write-store.js";

it("should project closed pending and terminal status shapes without durable internals", async () => {
  const row = { intentId: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(1000),
    challengeId: "secret", command: { private: true }, actorId: "private" } as unknown as PwIntentRow;
  expect(await projectWriteIntentStatus({} as never, row, "pending")).toEqual({
    intentId: row.intentId, state: "pending", expiresAt: "1970-01-01T00:00:01.000Z" });
  for (const state of ["expired", "revoked"] as const) {
    expect(await projectWriteIntentStatus({} as never, row, state)).toEqual({ intentId: row.intentId, state });
  }
  expect(await projectWriteIntentStatus({} as never, row, "rejected", { code: "facet_head_conflict" })).toEqual({
    intentId: row.intentId, state: "rejected", error: { code: "facet_head_conflict" } });
  await expect(projectWriteIntentStatus({} as never, row, "rejected"))
    .rejects.toMatchObject({ status: 503, message: "write_authority_unavailable" });
  await expect(projectWriteIntentStatus({} as never, row, "rejected", { code: "private upstream payload" }))
    .rejects.toMatchObject({ status: 503, message: "write_authority_unavailable" });
});
