import { describe, expect, it, vi } from "vitest";
import { FakeGraphStore } from "./canonical-graph-store.fixture.js";
import { captureCanonicalReadAnchor } from "./canonical-graph-writer.js";
import type { Graphify34Snapshot } from "./graphify-34-enrichment.js";
import {
  appliedMarkerKey,
  applyGraphify34Snapshots,
  applyPlanKey,
  buildGraphify34Manifest,
  Graphify34ApplyInterrupted,
  type Graphify34SnapshotTarget,
} from "./graphify-34-snapshot.js";

const decoder = new TextDecoder();

/**
 * Build a target the way the producer does: the read anchor is captured at the
 * moment the city's Postgres source is read, which here is this call.
 */
async function targetFor(
  store: FakeGraphStore,
  city: string,
  marker = "v2",
): Promise<Graphify34SnapshotTarget> {
  const readAnchor = await captureCanonicalReadAnchor(store, city);
  const snapshot: Graphify34Snapshot = {
    municipality: city,
    graphify_pass: "3.4",
    ontology_version: "2.3",
    nodes: [{ id: `${city}:signal:${marker}`, type: "Signal", label: marker, properties: {} }],
  };
  return {
    municipality: city,
    snapshot,
    manifest: buildGraphify34Manifest(city, snapshot),
    readAnchor,
  };
}

describe("Graphify 3.4 S3 snapshot backup", () => {
  it("refuses canonical snapshot writes when the pre-apply backup is unavailable", async () => {
    const project = vi.fn(async () => undefined);
    const store = new FakeGraphStore();
    store.seed("graph/witness/latest.json", '{"version":"V0"}');
    vi.spyOn(store, "getWithEtag").mockRejectedValue(new Error("backup source unavailable"));

    await expect(
      applyGraphify34Snapshots(store, [await targetFor(store, "witness")], "b1", project),
    ).rejects.toThrow("backup source unavailable");

    expect(decoder.decode(store.objects.get("graph/witness/latest.json")!.body))
      .toBe('{"version":"V0"}');
    expect(project).not.toHaveBeenCalled();
    expect(store.puts).toEqual([]);
  });

  it("archives every target city before it publishes the first canonical byte", async () => {
    const order: string[] = [];
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');
    store.seed("graph/b/latest.json", '{"version":"B0"}');
    const original = store.putCanonicalGraph.bind(store);
    vi.spyOn(store, "putCanonicalGraph").mockImplementation(
      async (key, body, contentType, options) => {
        order.push(`canonical:${key}`);
        return original(key, body, contentType, options);
      },
    );

    const report = await applyGraphify34Snapshots(
      store,
      [await targetFor(store, "a"), await targetFor(store, "b")],
      "b1",
      async (target) => { order.push(`project:${target.municipality}`); },
    );

    expect(report.applied).toEqual(["a", "b"]);
    expect(report.archives.map((archive) => archive.city)).toEqual(["a", "b"]);
    // Both archives complete before the first canonical write appears in `order`.
    expect(store.objects.has("graphify-34-backups/b1/graph/a/_backup-complete.json")).toBe(true);
    expect(store.objects.has("graphify-34-backups/b1/graph/b/_backup-complete.json")).toBe(true);
    expect(order).toEqual([
      "canonical:graph/a/latest.json",
      "project:a",
      "canonical:graph/b/latest.json",
      "project:b",
    ]);
  });

  it("refuses to publish a snapshot derived from state read before a rival published", async () => {
    // Phase A reads Postgres for all 724 cities, then archives them one by one:
    // a city's archive can be taken minutes after its source was read. A rival
    // publishing in that window is faithfully archived, so an archive-anchored
    // check sees matching ETags and publishes anyway — losing the rival's
    // version behind a snapshot derived from state that predates it.
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');
    const target = await targetFor(store, "a");

    await store.putCanonicalGraph("graph/a/latest.json", '{"version":"RIVAL"}', undefined, {
      ifMatch: store.etagOf("graph/a/latest.json"),
    });

    const project = vi.fn(async () => undefined);
    await expect(applyGraphify34Snapshots(store, [target], "b1", project))
      .rejects.toThrow(Graphify34ApplyInterrupted);

    expect(decoder.decode(await store.get("graph/a/latest.json"))).toBe('{"version":"RIVAL"}');
    expect(project).not.toHaveBeenCalled();
    expect(store.objects.has(appliedMarkerKey("b1", "a"))).toBe(false);
  });

  it("refuses a second run under an already-used backup id", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');
    await applyGraphify34Snapshots(store, [await targetFor(store, "a")], "b1", async () => undefined);

    await expect(applyGraphify34Snapshots(store, [await targetFor(store, "a")], "b1", async () => undefined))
      .rejects.toThrow(/already used/);
  });
});

describe("Graphify 3.4 apply is resumable, not atomic", () => {
  it("names the applied cities, the half-written one and the resume command", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');
    store.seed("graph/b/latest.json", '{"version":"B0"}');
    store.seed("graph/c/latest.json", '{"version":"C0"}');

    let caught: unknown;
    try {
      await applyGraphify34Snapshots(
        store,
        [await targetFor(store, "a"), await targetFor(store, "b"), await targetFor(store, "c")],
        "b1",
        async (target) => {
          if (target.municipality === "b") throw new Error("projection blew up");
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Graphify34ApplyInterrupted);
    const failure = caught as Graphify34ApplyInterrupted;
    expect(failure.applied).toEqual(["a"]);
    expect(failure.interruptedCity).toBe("b");
    expect(failure.stage).toBe("projection");
    expect(failure.restoreFrom).toBe("graphify-34-backups/b1/graph/b/");
    expect(failure.message).toContain("--backup-id=b1 --resume b c");
    // City `c` was never touched: an interrupted run leaves behind no
    // half-written city beyond the one it names.
    expect(decoder.decode(store.objects.get("graph/c/latest.json")!.body)).toBe('{"version":"C0"}');
    expect(store.objects.has(appliedMarkerKey("b1", "a"))).toBe(true);
    expect(store.objects.has(appliedMarkerKey("b1", "b"))).toBe(false);
  });

  it("resumes without re-applying a city that already completed", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');
    store.seed("graph/b/latest.json", '{"version":"B0"}');
    const targets = [await targetFor(store, "a"), await targetFor(store, "b")];

    await applyGraphify34Snapshots(store, targets, "b1", async (target) => {
      if (target.municipality === "b") throw new Error("interrupted");
    }).catch(() => undefined);

    const projected: string[] = [];
    const report = await applyGraphify34Snapshots(
      store,
      targets,
      "b1",
      async (target) => { projected.push(target.municipality); },
      { resume: true },
    );

    // `a` is skipped on its marker; only `b` finishes. No second archive is
    // taken, so the pre-run state stays recoverable from the original one.
    expect(report.skipped_already_applied).toEqual(["a"]);
    expect(report.applied).toEqual(["b"]);
    expect(projected).toEqual(["b"]);
    expect(decoder.decode(await store.get("graphify-34-backups/b1/graph/b/latest.json")))
      .toBe('{"version":"B0"}');
    expect(store.objects.has(appliedMarkerKey("b1", "b"))).toBe(true);
  });

  it("refuses to resume over a version another writer published meanwhile", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');
    const targets = [await targetFor(store, "a")];

    await applyGraphify34Snapshots(store, targets, "b1", async () => {
      throw new Error("interrupted before the applied marker");
    }).catch(() => undefined);

    // Between the interruption and the resume, filet-auto-link-pv publishes.
    await store.putCanonicalGraph("graph/a/latest.json", '{"version":"FILET"}', undefined, {
      ifMatch: store.etagOf("graph/a/latest.json"),
    });

    await expect(
      applyGraphify34Snapshots(store, targets, "b1", async () => undefined, { resume: true }),
    ).rejects.toThrow(/changed since it was read/);
    expect(decoder.decode(await store.get("graph/a/latest.json"))).toBe('{"version":"FILET"}');
  });

  it("refuses to resume a backup id that never planned a run", async () => {
    const store = new FakeGraphStore();
    store.seed("graph/a/latest.json", '{"version":"A0"}');

    await expect(
      applyGraphify34Snapshots(store, [await targetFor(store, "a")], "never", async () => undefined, {
        resume: true,
      }),
    ).rejects.toThrow(/cannot resume/);
    expect(store.objects.has(applyPlanKey("never"))).toBe(false);
  });
});
