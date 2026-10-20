import { EventEmitter } from "node:events";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { ArtifactConnectionError, withArtifactAdvisoryLock } from "./idempotency.js";

const KEY = "ab".repeat(16);

class FakeClient extends EventEmitter {
  readonly query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 }));
  readonly release = vi.fn((_error?: unknown): void => {});
}

function fakePool(client: FakeClient): pg.Pool {
  return { connect: async () => client } as unknown as pg.Pool;
}

describe("withArtifactAdvisoryLock connection guard", () => {
  it("fails a pending operation with a typed error when the reserved client errors", async () => {
    const client = new FakeClient();
    let releaseGate!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
      releaseGate = resolve;
    });
    const body = vi.fn(() => gate);
    const pending = withArtifactAdvisoryLock(fakePool(client), KEY, body);
    await vi.waitFor(() => expect(body).toHaveBeenCalled());
    const first = new Error("terminating connection due to administrator command");
    const rejected = expect(pending).rejects.toMatchObject({
      code: "artifact_connection_lost", cause: first,
    });
    client.emit("error", first);
    client.emit("error", new Error("second failure"));
    await rejected;
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]?.[0]).toBe(first);
    expect(client.listenerCount("error")).toBe(0);
    releaseGate("late");
  });

  it.each(["BEGIN", "pg_advisory_unlock"])("fails when the connection errors during %s", async (phase) => {
    const client = new FakeClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes(phase)) return new Promise<never>(() => {});
      return { rows: [], rowCount: 0 };
    });
    const pending = withArtifactAdvisoryLock(fakePool(client), KEY, async () => "ok");
    const rejected = expect(pending).rejects.toBeInstanceOf(ArtifactConnectionError);
    await vi.waitFor(() => expect(client.query.mock.calls.some(([sql]) => sql.includes(phase))).toBe(true));
    client.emit("error", new Error("connection terminated"));
    await rejected;
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    expect(client.listenerCount("error")).toBe(0);
  });

  it("returns a healthy client to the pool and removes the guard", async () => {
    const client = new FakeClient();
    await expect(
      withArtifactAdvisoryLock(fakePool(client), KEY, async () => "ok"),
    ).resolves.toBe("ok");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]?.[0]).toBeUndefined();
    expect(client.listenerCount("error")).toBe(0);
  });

  it.each(["BEGIN", "pg_advisory_unlock"])("types a connection failure reported by %s", async (phase) => {
    const client = new FakeClient();
    const failure = Object.assign(new Error("server disconnected"), { code: "57P01" });
    client.query.mockImplementation(async (sql) => {
      if (sql.includes(phase)) throw failure;
      return { rows: [], rowCount: 0 };
    });
    await expect(withArtifactAdvisoryLock(fakePool(client), KEY, async () => "ok"))
      .rejects.toMatchObject({ code: "artifact_connection_lost", cause: failure });
    expect(client.release).toHaveBeenCalledWith(failure);
    expect(client.listenerCount("error")).toBe(0);
  });
});
