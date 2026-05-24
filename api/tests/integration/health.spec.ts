import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createDb, makeDbProbe } from "../../src/db/client.js";
import {
  createObjectStore,
  makeObjectStoreProbe,
} from "../../src/storage/s3-object-store.js";

const config = loadConfig();
const dbHandle = createDb(config);
const store = createObjectStore(config);

beforeAll(async () => {
  await store.ensureBucket();
});

afterAll(async () => {
  await dbHandle.pool.end();
});

describe("/health integration", () => {
  it("reports ok when db and object store are reachable", async () => {
    const app = createApp({
      checkDb: makeDbProbe(dbHandle),
      checkObjectStore: makeObjectStoreProbe(store),
    });

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      db: { ok: boolean };
      objectStore: { ok: boolean };
    };
    expect(body.status).toBe("ok");
    expect(body.db.ok).toBe(true);
    expect(body.objectStore.ok).toBe(true);
  });

  it("reports degraded (503) when a probe fails", async () => {
    const app = createApp({
      checkDb: async () => ({ ok: false, detail: "boom" }),
      checkObjectStore: makeObjectStoreProbe(store),
    });

    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("degraded");
  });
});
