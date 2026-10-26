import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { writeIntentTransaction } from "./write-intent-transaction.js";

vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: (client: unknown) => client }));
vi.mock("pg", () => ({ default: { Client: class {
  on() {} async connect() {} async query() {} async end() {}
} } }));

function fixture() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const release = vi.fn();
  const transaction = vi.fn(async (work: (tx: unknown) => unknown) => work({ execute }));
  const client = { release, transaction, on: vi.fn(), off: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [{ pid: 123 }] }) };
  const connect = vi.fn().mockResolvedValue(client);
  return { db: { $client: { connect, options: {} } }, execute, release, transaction, connect, client };
}

it("should set bounded SQL timeouts and normalize only pre-commit cancellations", async () => {
  const { db, execute, release, transaction } = fixture();
  expect(await writeIntentTransaction(db as never, async () => "ok")).toBe("ok");
  expect(release).toHaveBeenCalledExactlyOnceWith();
  const dialect = new PgDialect();
  expect(execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql))
    .toEqual(["SET LOCAL lock_timeout = '1s'", "SET LOCAL statement_timeout = '5s'"]);
  for (const code of ["55P03", "57014"]) {
    const failure = Object.assign(new Error("synthetic SQL cancellation"), { code });
    await expect(writeIntentTransaction(db as never, async () => { throw new Error("query", { cause: failure }); }))
      .rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
    transaction.mockImplementationOnce(async (work) => { await work({ execute }); throw failure; });
    await expect(writeIntentTransaction(db as never, async () => "ok")).rejects.toBe(failure);
  }
});

it("should roll back overdue work even before its cancellation timer is scheduled", async () => {
  const { db } = fixture();
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    await expect(writeIntentTransaction(db as never, async () => {
      clock.mockReturnValue(5000);
    })).rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
  } finally { clock.mockRestore(); }
});

it("should destroy only the leased connection at the deadline without waiting for suspended work", async () => {
  vi.useFakeTimers();
  const { db, release } = fixture();
  let resume!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const suspended = new Promise<void>((resolve) => { resume = resolve; });
  try {
    const result = writeIntentTransaction(db as never, async () => { started(); await suspended; });
    const refusal = expect(result).rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
    await entered;
    await vi.advanceTimersByTimeAsync(5000);
    await refusal;
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
    resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledTimes(1);
  } finally { resume?.(); vi.useRealTimers(); }
});

it("should return a late lease without beginning work after pool acquisition expires", async () => {
  vi.useFakeTimers();
  const { db, connect, release, transaction, client } = fixture();
  let acquire!: (value: typeof client) => void;
  connect.mockReturnValue(new Promise((resolve) => { acquire = resolve; }));
  try {
    const work = vi.fn();
    const result = writeIntentTransaction(db as never, work);
    const refusal = expect(result).rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
    await vi.advanceTimersByTimeAsync(5000);
    await refusal;
    acquire(client);
    await vi.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledExactlyOnceWith();
    expect(transaction).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
