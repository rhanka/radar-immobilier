import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { ArtifactOperationError, classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { createArtifactReadMetadata } from "./read-metadata.js";

const row = { id: "123e4567-e89b-12d3-a456-426614174000", binding_name: "summer",
  created_at: new Date("2026-10-01T00:00:00Z"), lifecycle_state: "active",
  release_id: "123e4567-e89b-12d3-a456-426614174001", published_at: new Date("2026-10-02T00:00:00Z") };
const ok = (body: unknown) => ({ ok: true as const, result: { status: 200, body },
  invocationId: "test", commitState: "not_committed" as const, replayed: false });
const request = (path: string) => ({ method: path === "/list" ? "POST" : "GET", path, actorId: "alice", body: undefined });
type FixtureRow = Omit<typeof row, "release_id" | "published_at"> & { release_id: string | null; published_at: Date | null };
function setup(rows: FixtureRow[] = [row]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const reads = createArtifactReadMetadata({ query } as unknown as Pick<pg.Pool, "query">, "scope",
    (artifactId, releaseId) => ({ stableUrl: `https://${artifactId}.pages.test/`, pinnedUrl: `https://${releaseId}.pinned.pages.test/` }));
  return { reads, query };
}

describe("IMMO artifact read metadata", () => {
  it("should enrich only the authorized page and retain the upstream result fields", async () => {
    const { reads, query } = setup();
    const result = await reads.project(request("/list"), async () => {
      const ids = await reads.listArtifactIds();
      return ok({ total: 1, artifacts: ids.map((artifactId) => ({ artifactId, ownerId: "alice" })) });
    });
    expect(result).toMatchObject({ ok: true, result: { body: { total: 1, artifacts: [{ artifactId: row.id,
      bindingName: "summer", ownerId: "alice", currentReleaseId: row.release_id, state: "active", published: true,
      stableUrl: `https://${row.id}.pages.test/`, pinnedUrl: `https://${row.release_id}.pinned.pages.test/`,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" }] } } });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toEqual(["scope", null]);
  });

  it("should return explicit null publication fields for an unpublished artifact", async () => {
    const { reads, query } = setup([{ ...row, release_id: null, published_at: null }]);
    expect(await reads.project(request(`/meta/${row.id}`), async () => ok({ artifactId: row.id })))
      .toMatchObject({ result: { body: { bindingName: "summer", currentReleaseId: null,
        pinnedUrl: null, updatedAt: null, published: false, state: "active", stableUrl: `https://${row.id}.pages.test/` } } });
    expect(query.mock.calls[0]![1]).toEqual(["scope", [row.id]]);
  });

  it("should preserve lifecycle independently of publication and isolate concurrent list snapshots", async () => {
    const { reads, query } = setup();
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ ...row, binding_name: "other", lifecycle_state: "withdrawn" }] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = reads.project(request("/list"), async () => {
      await reads.listArtifactIds(); await gate;
      return ok({ artifacts: [{ artifactId: row.id }], total: 1 });
    });
    const second = await reads.project(request("/list"), async () => {
      await reads.listArtifactIds(); release();
      return ok({ artifacts: [{ artifactId: row.id }], total: 1 });
    });
    expect(second).toMatchObject({ result: { body: { artifacts: [{ bindingName: "other", state: "withdrawn", published: true }] } } });
    expect(await first).toMatchObject({ result: { body: { artifacts: [{ bindingName: "summer", state: "active" }] } } });
  });

  it("should leave refused reads and writes untouched without querying metadata", async () => {
    const { reads, query } = setup();
    const refused = { ok: false as const, failure: classifyArtifactFailure(new ArtifactOperationError("not_found"),
      { invocationId: "test", operation: "get", phase: "dispatch", commitState: "not_committed" }) };
    expect(await reads.project(request(`/meta/${row.id}`), async () => refused)).toBe(refused);
    const published = ok({ releaseId: row.release_id });
    expect(await reads.project(request("/publish"), async () => published)).toBe(published);
    expect(query).not.toHaveBeenCalled();
  });
});
