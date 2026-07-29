import { describe, expect, it } from "vitest";
import {
  ArchiveIdAlreadyUsed,
  ArchiveVerificationFailed,
  archiveCityGraphPrefix,
  archiveDigest,
  backupMarkerKey,
  ConcurrentCanonicalWrite,
  readCityGraphArchive,
  verifyCityGraphArchive,
  writeCanonicalCityGraph,
} from "./canonical-graph-writer.js";
import { canonicalGraphKey, isCanonicalGraphKey } from "../../storage/object-store.js";
import { CanonicalGraphWriteRefused } from "../../storage/s3-object-store.js";
import { FakeGraphStore } from "./canonical-graph-store.fixture.js";

const decoder = new TextDecoder();

describe("canonical graph key guard", () => {
  it("recognises the canonical key and nothing that merely looks like it", () => {
    expect(isCanonicalGraphKey("graph/sutton/latest.json")).toBe(true);
    expect(isCanonicalGraphKey(canonicalGraphKey("levis"))).toBe(true);
    expect(isCanonicalGraphKey("graph/sutton/history/pre-v23.json")).toBe(false);
    expect(isCanonicalGraphKey("graphify-34-backups/id/graph/sutton/latest.json")).toBe(false);
    expect(isCanonicalGraphKey("parsed/sutton/latest.candidate.json")).toBe(false);
  });

  it("makes even the in-memory store refuse an unguarded canonical put", async () => {
    // The guard belongs to the write path, so every store that stands in for
    // S3 reproduces it. (`S3ObjectStore` itself is covered behaviourally in
    // `storage/s3-object-store.test.ts`.)
    const store = new FakeGraphStore();

    await expect(store.put("graph/sutton/latest.json", new Uint8Array([1])))
      .rejects.toThrow(CanonicalGraphWriteRefused);
  });
});

describe("pre-apply archive", () => {
  it("inventories every archived object with a sha256 and a digest", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"nodes":[]}');
    store.seed("graph/sutton/graphify-3.4.manifest.json", '{"node_count":0}');

    const receipt = await archiveCityGraphPrefix(store, "sutton", "b1");

    expect(receipt.object_count).toBe(2);
    expect(receipt.entries.map((entry) => entry.key)).toEqual([
      "graph/sutton/graphify-3.4.manifest.json",
      "graph/sutton/latest.json",
    ]);
    expect(receipt.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    expect(receipt.canonical_etag).toBe(store.etagOf("graph/sutton/latest.json"));
    expect(receipt.digest).toBe(archiveDigest(receipt.entries));

    const marker = JSON.parse(decoder.decode(await store.get(backupMarkerKey("b1", "sutton"))));
    expect(marker.digest).toBe(receipt.digest);
    expect(await verifyCityGraphArchive(store, receipt)).toBeUndefined();
  });

  it("refuses to reuse an archive id instead of overwriting the archive", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"nodes":[]}');
    await archiveCityGraphPrefix(store, "sutton", "b1");

    await expect(archiveCityGraphPrefix(store, "sutton", "b1"))
      .rejects.toThrow(ArchiveIdAlreadyUsed);
  });

  it("detects an archive that lost or corrupted an object", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"nodes":[]}');
    store.seed("graph/sutton/graphify-3.4.manifest.json", '{"node_count":0}');
    const receipt = await archiveCityGraphPrefix(store, "sutton", "b1");

    store.objects.delete(`${receipt.backup_prefix}latest.json`);
    await expect(verifyCityGraphArchive(store, receipt)).rejects.toThrow(ArchiveVerificationFailed);

    store.seed(`${receipt.backup_prefix}latest.json`, '{"nodes":["tampered"]}');
    await expect(verifyCityGraphArchive(store, receipt)).rejects.toThrow(/corrupt archived object/);
  });

  it("archives an absent canonical object as absent, and the write expects absence", async () => {
    const store = new FakeGraphStore();
    const receipt = await archiveCityGraphPrefix(store, "newville", "b1");

    expect(receipt.object_count).toBe(0);
    expect(receipt.canonical_etag).toBeNull();

    await writeCanonicalCityGraph(store, {
      citySlug: "newville",
      body: new TextEncoder().encode('{"nodes":[]}'),
      archive: receipt,
    });
    expect(store.objects.has("graph/newville/latest.json")).toBe(true);
  });
});

describe("TOCTOU between a prepared snapshot and its publication", () => {
  it("refuses to erase a version published after the archive was taken", async () => {
    // The exact break scenario from review: phase A archives V0, another
    // writer (filet-auto-link-pv) publishes V1, phase A then publishes its
    // prepared V2. A blind PUT loses V1 for good — the archive only holds V0.
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"version":"V0"}');
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    await store.putCanonicalGraph(
      "graph/sutton/latest.json",
      '{"version":"V1"}',
      "application/json",
      { ifMatch: archive.canonical_etag },
    );

    await expect(writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: new TextEncoder().encode('{"version":"V2"}'),
      archive,
    })).rejects.toThrow(ConcurrentCanonicalWrite);

    expect(decoder.decode(await store.get("graph/sutton/latest.json"))).toBe('{"version":"V1"}');
    expect(decoder.decode(await store.get(`${archive.backup_prefix}latest.json`)))
      .toBe('{"version":"V0"}');
  });

  it("publishes when the canonical object has not moved", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"version":"V0"}');
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    await writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: new TextEncoder().encode('{"version":"V2"}'),
      archive,
    });

    expect(decoder.decode(await store.get("graph/sutton/latest.json"))).toBe('{"version":"V2"}');
    const reread = await readCityGraphArchive(store, "sutton", "b1");
    expect(reread?.digest).toBe(archive.digest);
  });

  it("refuses an archive taken for another city", async () => {
    const store = new FakeGraphStore();
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    await expect(writeCanonicalCityGraph(store, {
      citySlug: "levis",
      body: new TextEncoder().encode("{}"),
      archive,
    })).rejects.toThrow(/archive is for sutton/);
  });
});
