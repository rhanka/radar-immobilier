import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { rawObjectKey } from "../../src/storage/object-store.js";
import { createObjectStore } from "../../src/storage/s3-object-store.js";

const store = createObjectStore(loadConfig());

beforeAll(async () => {
  await store.ensureBucket();
});

describe("object store integration", () => {
  it("round-trips put / get / head", async () => {
    const key = rawObjectKey({
      source: "avis-publics",
      date: new Date("2024-05-18T00:00:00Z"),
      sha256: "deadbeef",
      ext: "txt",
    });
    expect(key).toBe("raw/avis-publics/2024/05/18/deadbeef.txt");

    const body = "Règlement 2024-58 — densité augmentée";
    await store.put(key, body, "text/plain");

    const head = await store.head(key);
    expect(head).not.toBeNull();
    expect(head?.key).toBe(key);

    const fetched = await store.get(key);
    expect(new TextDecoder().decode(fetched)).toBe(body);
  });

  it("returns null heading a missing key", async () => {
    const head = await store.head("raw/does/not/exist.txt");
    expect(head).toBeNull();
  });
});
