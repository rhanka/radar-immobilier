import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  computeParamsHash,
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

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("deriveIdempotencyKey", () => {
  it("is sha256(scope|sub|op|artifactId|clientKey) over UTF-8 bytes", () => {
    expect(deriveIdempotencyKey(INPUT)).toBe(
      sha256Hex("scope-1|user-sub-1|publish|123e4567-e89b-12d3-a456-426614174000|client-key-1"),
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
      sha256Hex(
        `scope-1|user-sub-1|publish|123e4567-e89b-12d3-a456-426614174000|Été 🏠`,
      ),
    );
    expect(withAccent).not.toBe(deriveIdempotencyKey(INPUT));
  });
});

describe("computeParamsHash", () => {
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
      return {
        async query(text: string, params: unknown[] = []) {
          queries.push({ text, params });
          return { rows: [] };
        },
        release() {
          releases.count += 1;
        },
      };
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
      "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
      "SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)",
    ]);
    expect(queries[0]!.params).toEqual([deriveIdempotencyKey(INPUT).slice(0, 16)]);
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
      "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
      "SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)",
    ]);
    expect(releases.count).toBe(1);
  });

  it("refuses a non-hex key without touching the pool", async () => {
    const queries: RecordedCall[] = [];
    await expect(
      withArtifactAdvisoryLock(fakePool(queries, { count: 0 }), "not-hex!!", async () => undefined),
    ).rejects.toThrow("keyHex must be hex");
    expect(queries).toEqual([]);
  });
});
