import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { writeIntentTransaction } from "./write-intent-transaction.js";

it("should set bounded SQL timeouts and normalize only pre-commit cancellations", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ pid: 123 }] });
  const db = { transaction: async (work: (tx: unknown) => unknown) => work({ execute }) };
  expect(await writeIntentTransaction(db as never, async () => "ok")).toBe("ok");
  const dialect = new PgDialect();
  expect(execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql))
    .toEqual(["SET LOCAL lock_timeout = '1s'", "SET LOCAL statement_timeout = '5s'", "SELECT pg_backend_pid() AS pid"]);
  for (const code of ["55P03", "57014"]) {
    const failure = Object.assign(new Error("synthetic SQL cancellation"), { code });
    await expect(writeIntentTransaction(db as never, async () => { throw new Error("query", { cause: failure }); }))
      .rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
    const failedCommit = { transaction: async () => { throw failure; } };
    await expect(writeIntentTransaction(failedCommit as never, async () => "ok")).rejects.toBe(failure);
  }
});

it("should roll back overdue work even before its cancellation timer is scheduled", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ pid: 123 }] });
  const db = { transaction: async (work: (tx: unknown) => unknown) => work({ execute }) };
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    await expect(writeIntentTransaction(db as never, async () => {
      clock.mockReturnValue(5000);
    })).rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
  } finally { clock.mockRestore(); }
});
