import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { EventEmitter } from "node:events";
import {
  computeParamsHash,
  createArtifactsPool,
  deriveIdempotencyKey,
  withArtifactAdvisoryLock,
} from "./idempotency.js";

const INPUT = {
  scope: "scope-1",
  sub: "user-sub-1",
  op: "publish",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  clientKey: "client-key-1",
};

describe("deriveIdempotencyKey", () => {
  it("is sha256(scope|sub|op|artifactId|clientKey) over UTF-8 bytes", () => {
    expect(deriveIdempotencyKey(INPUT)).toBe(
      "9a159e31bdd2a0415be1bf65c70e37c29d5076365616af5acc356ee8210c8ff1",
    );
  });

  it("changes when any single field changes", () => {
    const base = deriveIdempotencyKey(INPUT);
    const variants = [
      { ...INPUT, scope: "scope-2" },
      { ...INPUT, sub: "user-sub-2" },
      { ...INPUT, op: "ensure" },
      { ...INPUT, artifactId: "123e4567-e89b-12d3-a456-426614174001" },
      { ...INPUT, clientKey: "client-key-2" },
    ];
    for (const variant of variants) {
      expect(deriveIdempotencyKey(variant)).not.toBe(base);
    }
  });

  it("keeps the same client key independent across subs", () => {
    expect(deriveIdempotencyKey({ ...INPUT, sub: "sub-a" })).not.toBe(
      deriveIdempotencyKey({ ...INPUT, sub: "sub-b" }),
    );
  });

  it("counts multibyte content in UTF-8 bytes", () => {
    const withAccent = deriveIdempotencyKey({ ...INPUT, clientKey: "Été 🏠" });
    expect(withAccent).toBe(
      "cdbd12ef59da02ab7ad392f06f60bb101f49b78635be07ea0d6c3210ae08afa4",
    );
    expect(withAccent).not.toBe(deriveIdempotencyKey(INPUT));
  });
});

describe("computeParamsHash", () => {
  it("matches a fixed canonical JSON SHA-256 vector computed with sha256sum", () => {
    expect(computeParamsHash({ b: 2, a: 1 })).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });
  it("detects changes in JSON keys named __proto__", () => {
    const profile = JSON.parse('{"__proto__":{"title":"changed"}}');
    expect(computeParamsHash({ profile })).not.toBe(computeParamsHash({ profile: {} }));
  });
  it("is order-insensitive on object keys", () => {
    expect(computeParamsHash({ b: 2, a: 1 })).toBe(computeParamsHash({ a: 1, b: 2 }));
  });

  it("is order-insensitive on nested keys but sensitive to array order", () => {
    const left = computeParamsHash({ files: [{ path: "b" }, { path: "a" }], mode: "page" });
    const right = computeParamsHash({ mode: "page", files: [{ path: "b" }, { path: "a" }] });
    expect(left).toBe(right);
    expect(computeParamsHash({ files: [{ path: "a" }, { path: "b" }] })).not.toBe(left);
  });

  it("changes on any value change", () => {
    expect(computeParamsHash({ a: 1 })).not.toBe(computeParamsHash({ a: 2 }));
  });
});

interface RecordedCall {
  readonly text: string;
  readonly params: readonly unknown[];
}

function fakePool(queries: RecordedCall[], releases: { count: number }) {
  return {
    async connect() {
      return Object.assign(new EventEmitter(), {
        async query(text: string, params: unknown[] = []) {
          queries.push({ text, params });
          return { rows: [] };
        },
        release() {
          releases.count += 1;
        },
      });
    },
  } as unknown as pg.Pool;
}

describe("withArtifactAdvisoryLock", () => {
  it("locks, runs the body on one client, then unlocks and releases", async () => {
    const queries: RecordedCall[] = [];
    const releases = { count: 0 };
    const result = await withArtifactAdvisoryLock(
      fakePool(queries, releases),
      deriveIdempotencyKey(INPUT),
      async () => "receipt",
    );
    expect(result).toBe("receipt");
    expect(queries.map((q) => q.text)).toEqual([
      "BEGIN",
      "SELECT set_config('lock_timeout', $1, true)",
      "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
      "SELECT set_config('lock_timeout', '0', true)",
      "COMMIT",
      "SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)",
    ]);
    expect(queries[1]!.params).toEqual(["3000ms"]);
    expect(queries[2]!.params).toEqual([deriveIdempotencyKey(INPUT).slice(0, 16)]);
    expect(releases.count).toBe(1);
  });

  it("unlocks when the body throws and rethrows the error", async () => {
    const queries: RecordedCall[] = [];
    const releases = { count: 0 };
    await expect(
      withArtifactAdvisoryLock(fakePool(queries, releases), deriveIdempotencyKey(INPUT), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(queries.map((q) => q.text)).toEqual([
      "BEGIN",
      "SELECT set_config('lock_timeout', $1, true)",
      "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
      "SELECT set_config('lock_timeout', '0', true)",
      "COMMIT",
      "SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)",
    ]);
    expect(releases.count).toBe(1);
  });

  it("handles idle pool errors without an unhandled EventEmitter error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = createArtifactsPool({ host: "unused", port: 1, user: "test", password: "test", database: "test" });
    try {
      const error = Object.assign(new Error("idle connection lost"), { client: { password: "test-sensitive" } });
      expect(() => pool.emit("error", error)).not.toThrow();
      expect(log).toHaveBeenCalledWith("artifact pool idle client error");
    } finally { log.mockRestore(); await pool.end(); }
  });

  it("refuses a non-hex key without touching the pool", async () => {
    const queries: RecordedCall[] = [];
    await expect(
      withArtifactAdvisoryLock(fakePool(queries, { count: 0 }), "not-hex!!", async () => undefined),
    ).rejects.toThrow("keyHex must be hex");
    expect(queries).toEqual([]);
  });
  it("rolls back a timed out acquisition without invoking the body", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_lock(")) throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: async () => Object.assign(new EventEmitter(), { query, release }) } as unknown as pg.Pool;
    const body = vi.fn();
    await expect(withArtifactAdvisoryLock(pool, deriveIdempotencyKey(INPUT), body))
      .rejects.toThrow("artifact advisory lock timeout conflict");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(body).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith();
  });

  it("maps a connection-open timeout to a typed pool timeout", async () => {
    const pool = {
      connect: async () => { throw new Error("Connection terminated due to connection timeout"); },
    } as unknown as pg.Pool;
    await expect(withArtifactAdvisoryLock(pool, deriveIdempotencyKey(INPUT), async () => undefined))
      .rejects.toMatchObject({ code: "artifact_pool_timeout" });
  });
});
