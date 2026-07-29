import { describe, expect, it } from "vitest";
import {
  ArchiveIdAlreadyUsed,
  ArchiveVerificationFailed,
  archiveCityGraphPrefix,
  archiveDigest,
  backupMarkerKey,
  captureCanonicalReadAnchor,
  ConcurrentCanonicalWrite,
  readCanonicalCityGraph,
  readCityGraphArchive,
  verifyCityGraphArchive,
  writeCanonicalCityGraph,
} from "./canonical-graph-writer.js";
import { canonicalGraphKey, isCanonicalGraphKey } from "../../storage/object-store.js";
import { CanonicalGraphWriteRefused } from "../../storage/s3-object-store.js";
import { FakeGraphStore } from "./canonical-graph-store.fixture.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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
    const anchor = await captureCanonicalReadAnchor(store, "newville");
    const receipt = await archiveCityGraphPrefix(store, "newville", "b1");

    expect(receipt.object_count).toBe(0);
    expect(receipt.canonical_etag).toBeNull();
    expect(anchor.etag).toBeNull();

    await writeCanonicalCityGraph(store, {
      citySlug: "newville",
      body: encoder.encode('{"nodes":[]}'),
      archive: receipt,
      readAnchor: anchor,
    });
    expect(store.objects.has("graph/newville/latest.json")).toBe(true);
  });

  it("never records a version it did not read the bytes of", async () => {
    // The review probe. A rival writer publishes V1 the instant the archive
    // reads the object. With a `get()` then a separate `head()`, the inventory
    // holds V0's bytes labelled with V1's ETag; the write-time check then finds
    // the live ETag equal to the recorded one and publishes V2 — V1 destroyed,
    // archive holding only V0. Reading bytes and ETag together is what makes
    // the recorded version describe the archived bytes.
    const key = canonicalGraphKey("sutton");
    const store = new FakeGraphStore();
    store.seed(key, '{"version":"V0"}');
    const v0 = store.etagOf(key);
    const anchor = await captureCanonicalReadAnchor(store, "sutton");

    store.publishOnNextReadOf(key, '{"version":"V1"}');
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    expect(decoder.decode(await store.get(`${archive.backup_prefix}latest.json`)))
      .toBe('{"version":"V0"}');
    expect(archive.canonical_etag).toBe(v0);
    expect(archive.entries[0]?.etag).toBe(v0);

    await expect(writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: encoder.encode('{"version":"V2"}'),
      archive,
      readAnchor: anchor,
    })).rejects.toThrow(ConcurrentCanonicalWrite);
    // V1 survives: it was never archived, so it must never be overwritten.
    expect(decoder.decode(await store.get(key))).toBe('{"version":"V1"}');
  });

  it("refuses to archive an object that vanished between the listing and the read", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"nodes":[]}');
    store.seed("graph/sutton/graphify-3.4.manifest.json", "{}");
    const original = store.getWithEtag.bind(store);
    store.getWithEtag = async (key: string) => {
      store.objects.delete("graph/sutton/latest.json");
      return original(key);
    };

    await expect(archiveCityGraphPrefix(store, "sutton", "b1"))
      .rejects.toThrow(/disappeared before it could be read/);
  });
});

describe("TOCTOU between a prepared snapshot and its publication", () => {
  it("refuses to erase a version published after the archive was taken", async () => {
    // The exact break scenario from review: phase A archives V0, another
    // writer (filet-auto-link-pv) publishes V1, phase A then publishes its
    // prepared V2. A blind PUT loses V1 for good — the archive only holds V0.
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"version":"V0"}');
    const anchor = await captureCanonicalReadAnchor(store, "sutton");
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    await store.putCanonicalGraph(
      "graph/sutton/latest.json",
      '{"version":"V1"}',
      "application/json",
      { ifMatch: archive.canonical_etag },
    );

    await expect(writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: encoder.encode('{"version":"V2"}'),
      archive,
      readAnchor: anchor,
    })).rejects.toThrow(ConcurrentCanonicalWrite);

    expect(decoder.decode(await store.get("graph/sutton/latest.json"))).toBe('{"version":"V1"}');
    expect(decoder.decode(await store.get(`${archive.backup_prefix}latest.json`)))
      .toBe('{"version":"V0"}');
  });

  it("publishes when the canonical object has not moved", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/sutton/latest.json", '{"version":"V0"}');
    const anchor = await captureCanonicalReadAnchor(store, "sutton");
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    await writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: encoder.encode('{"version":"V2"}'),
      archive,
      readAnchor: anchor,
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
      body: encoder.encode("{}"),
      archive,
      readAnchor: await captureCanonicalReadAnchor(store, "levis"),
    })).rejects.toThrow(/archive is for sutton/);
  });

  it("refuses a read anchor taken for another city", async () => {
    const store = new FakeGraphStore();
    const archive = await archiveCityGraphPrefix(store, "levis", "b1");

    await expect(writeCanonicalCityGraph(store, {
      citySlug: "levis",
      body: encoder.encode("{}"),
      archive,
      readAnchor: await captureCanonicalReadAnchor(store, "sutton"),
    })).rejects.toThrow(/read anchor is for sutton/);
  });
});

describe("the protected window starts at the read that produced the body", () => {
  it("refuses a body derived from a version a rival replaced before the archive", async () => {
    // filet-auto-link-pv's measured shape: it reads `latest.json`, then probes
    // S3 once per Signal node — minutes — and only then archives. A rival that
    // publishes inside that interval IS captured by the archive, so an
    // archive-anchored check finds the ETags equal and lets the write through,
    // publishing a body derived from bytes that no longer exist. The anchor
    // taken at the read is what makes that interval observable.
    const key = canonicalGraphKey("sutton");
    const store = new FakeGraphStore();
    store.seed(key, '{"version":"V0"}');

    const read = await readCanonicalCityGraph(store, "sutton");
    expect(decoder.decode(read!.body)).toBe('{"version":"V0"}');

    await store.putCanonicalGraph(key, '{"version":"V1"}', "application/json", {
      ifMatch: read!.anchor.etag,
    });

    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");
    // The archive is perfectly up to date — and that is precisely why it cannot
    // be the anchor: it describes V1, while the body describes V0's successor.
    expect(archive.canonical_etag).toBe(store.etagOf(key));
    expect(decoder.decode(await store.get(`${archive.backup_prefix}latest.json`)))
      .toBe('{"version":"V1"}');

    await expect(writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: encoder.encode('{"version":"V0+filet"}'),
      archive,
      readAnchor: read!.anchor,
    })).rejects.toThrow(/changed since it was read/);
    expect(decoder.decode(await store.get(key))).toBe('{"version":"V1"}');
  });

  it("reports the refusal as a read-anchor mismatch, not as a stale archive", async () => {
    const key = canonicalGraphKey("sutton");
    const store = new FakeGraphStore();
    store.seed(key, '{"version":"V0"}');
    const read = await readCanonicalCityGraph(store, "sutton");
    await store.putCanonicalGraph(key, '{"version":"V1"}', "application/json", {
      ifMatch: read!.anchor.etag,
    });
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    const error: unknown = await writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: encoder.encode("{}"),
      archive,
      readAnchor: read!.anchor,
    }).then(() => null, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConcurrentCanonicalWrite);
    expect((error as ConcurrentCanonicalWrite).reason).toBe("read-anchor");
  });

  it("refuses when the archive does not cover the version it would destroy", async () => {
    // The resume shape: the archive was taken by an earlier run, a rival
    // published since, and the resumed run re-reads the object. The read anchor
    // now agrees with the live object — but the archive holds the older bytes,
    // so publishing would destroy a version nothing can restore.
    const key = canonicalGraphKey("sutton");
    const store = new FakeGraphStore();
    store.seed(key, '{"version":"V0"}');
    const archive = await archiveCityGraphPrefix(store, "sutton", "b1");

    await store.putCanonicalGraph(key, '{"version":"V1"}', "application/json", {
      ifMatch: archive.canonical_etag,
    });
    const anchor = await captureCanonicalReadAnchor(store, "sutton");

    const error: unknown = await writeCanonicalCityGraph(store, {
      citySlug: "sutton",
      body: encoder.encode('{"version":"V2"}'),
      archive,
      readAnchor: anchor,
    }).then(() => null, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConcurrentCanonicalWrite);
    expect((error as ConcurrentCanonicalWrite).reason).toBe("archive-out-of-date");
    expect(decoder.decode(await store.get(key))).toBe('{"version":"V1"}');
  });
});
