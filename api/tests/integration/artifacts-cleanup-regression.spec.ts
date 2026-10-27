import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { loadConfig } from "../../src/config.js";
import { awaitWithPump, cleanupArtifactRace, closeArtifactWorker, assertPurgeEffects } from "./artifacts-race-cleanup.helpers.js";

const bucket = "artifacts-fix1-cleanup";
let pool: pg.Pool;
let s3: S3Client;
let blobs: ReturnType<typeof createS3BlobStore>;
beforeAll(async () => {
  const env = loadConfig();
  pool = new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB, max: 1 });
  s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  blobs = createS3BlobStore({ client: s3, bucket });
});
afterAll(async () => {
  try {
    for (const key of await blobs.listKeys("artifacts/")) await blobs.deleteBlob(key);
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  } finally { s3?.destroy(); await pool?.end(); }
});

describe("artifact acceptance cleanup regression", () => {
  it("preserves a winner failure and drains a loser holding a SQL connection", async () => {
    const client = await pool.connect();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loser = gate.then(() => client.query("SELECT 1")).finally(() => client.release());
    const pump = loser.then(() => {});
    const closeWorker = vi.fn(async () => {});
    const barrier = { observer: undefined, waitUntilReached: async () => {},
      release: (point: string) => { if (point === "before_key_lock") release(); } };
    const winner = Promise.reject(new Error("injected winner failure"));
    try {
      const run = async () => {
        try { await winner; }
        finally { await cleanupArtifactRace([{ barrier, invocationId: "loser" }], ["before_key_lock"],
          [winner, loser, pump], () => {}, closeWorker); }
      };
      await expect(run()).rejects.toThrow("injected winner failure");
      expect(closeWorker).toHaveBeenCalledOnce();
      expect(pool.idleCount).toBe(1);
      expect(pool.waitingCount).toBe(0);
    } finally { release(); await Promise.allSettled([winner, loser, pump]); }
  });

  it.each(["cooperative", "stuck"])("reaps a %s SQL worker before returning", async (mode) => {
    const child = fork(fileURLToPath(new URL("./artifacts-cleanup-worker.helpers.ts", import.meta.url)),
      ["--cleanup-worker", mode], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    try {
      const [pid] = await once(child, "message");
      const started = performance.now();
      await closeArtifactWorker(child, () => {
        const closed = once(child, "message");
        child.send("close");
        return closed;
      });
      expect(performance.now() - started).toBeLessThan(8000);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE pid = $1", [pid])).rows[0].count).toBe("0");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      }
    }
  }, 15000);

  it.each(["valid", "delete-protected", "retain-exclusive"])("discriminates %s purge effects on S3", async (mode) => {
    const texts = ["shared", "exclusive", "unrelated-preparation"].map(kind => `${mode}/${kind}`);
    const keys = texts.map(text => `artifacts/fix1/blobs/sha256/${createHash("sha256").update(text).digest("hex")}`);
    const [protectedKey, exclusiveKey, abandonedKey] = keys as [string, string, string];
    for (const [index, key] of keys.entries()) await blobs.putBlob(key, Buffer.from(texts[index]!));
    await blobs.deleteBlob(abandonedKey);
    if (mode !== "retain-exclusive") await blobs.deleteBlob(exclusiveKey);
    if (mode === "delete-protected") await blobs.deleteBlob(protectedKey);
    const check = () => assertPurgeEffects([protectedKey], [exclusiveKey], after);
    const after = new Set(await blobs.listKeys("artifacts/"));
    if (mode === "valid") {
      expect(check).not.toThrow();
      expect(new TextDecoder().decode(await blobs.getBlob(protectedKey))).toBe(texts[0]);
    } else expect(check).toThrow(mode === "delete-protected" ? "referenced blob" : "exclusive blob");
  });

  it("bounds a stalled progression while the operation stays pending", async () => {
    let releaseStalled!: () => void;
    const gate = new Promise<void>((resolve) => { releaseStalled = resolve; });
    const stalled = gate.then(() => "late success");
    void stalled.catch(() => {});
    const failingPump = (async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      throw new Error("[contract-violation] commit barrier B did not progress");
    })();
    void failingPump.catch(() => {});
    const started = performance.now();
    await expect(awaitWithPump(stalled, failingPump, "before_key_lock/B", 2000)).rejects.toThrow(
      "commit barrier B did not progress",
    );
    expect(performance.now() - started).toBeLessThan(2000);
    releaseStalled();
    await expect(stalled).resolves.toBe("late success");
    const hangingBarrier = new Promise<void>(() => {});
    const hangingOperation = new Promise<unknown>(() => {});
    void hangingBarrier.catch(() => {});
    void hangingOperation.catch(() => {});
    const idlePump = new Promise<void>(() => {});
    void idlePump.catch(() => {});
    await expect(awaitWithPump(hangingBarrier, idlePump, "stalled-barrier", 100)).rejects.toThrow(
      "stalled-barrier did not settle",
    );
    await expect(awaitWithPump(hangingOperation, idlePump, "stalled-operation", 100)).rejects.toThrow(
      "stalled-operation did not settle",
    );
  });

  it.each(["before_key_lock/B", "publish/A", "publish/B"])("reaches SQL cleanup after a pump fails during %s", async (label) => {
    const client = await pool.connect();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const operation = gate.then(() => client.query("SELECT 1")).finally(() => client.release());
    let pumpFailed = false;
    const pump = client.query("SELECT 1").then(() => {
      pumpFailed = true;
      throw new Error(`stalled ${label}`);
    });
    void pump.catch(() => {});
    const barrier = { observer: undefined, waitUntilReached: () => gate, release: () => release() };
    const closeWorker = vi.fn(async () => {});
    const started = performance.now();
    const run = async () => {
      try { await awaitWithPump(operation, pump, label, 1000); }
      finally {
        expect(pumpFailed).toBe(true);
        await cleanupArtifactRace([{ barrier, invocationId: label }], ["before_key_lock"],
          [operation, pump], () => {}, closeWorker);
      }
    };
    try {
      await expect(run()).rejects.toThrow(`stalled ${label}`);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(closeWorker).toHaveBeenCalledOnce();
      expect(pool.idleCount).toBe(1);
      expect(pool.waitingCount).toBe(0);
    } finally { release(); await Promise.allSettled([operation, pump]); }
  });

  it.each(["idle", "finished"])("bounds an operation after an %s pump without hiding success", async (mode) => {
    const pump = mode === "idle" ? new Promise<void>(() => {}) : Promise.resolve();
    const stalled = new Promise<void>(() => {});
    await expect(awaitWithPump(stalled, pump, mode, 100)).rejects.toThrow(`${mode} did not settle`);
    const receipt = { status: 200, body: { releaseId: "synthetic-release" } };
    await expect(awaitWithPump(Promise.resolve(receipt), pump, mode, 100)).resolves.toBe(receipt);
  });
});
