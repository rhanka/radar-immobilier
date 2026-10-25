import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCoherentProjection, readProjectionScope, type ProjectionRead } from "./projection-revisions.js";
import { readClassificationCatalog } from "./classification-catalog.js";
import { readClassificationProjection } from "./classification-projection.js";
import { ScopeError } from "./scope.js";

vi.mock("./projection-revisions.js", () => ({ readCoherentProjection: vi.fn(), readProjectionScope: vi.fn() }));
vi.mock("./classification-catalog.js", async (original) => ({
  ...await original<typeof import("./classification-catalog.js")>(), readClassificationCatalog: vi.fn(),
}));
const db = {} as Parameters<typeof readClassificationProjection>[0];
const scope: ProjectionRead = { workspaceId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222", citySlug: "city", mode: "signal",
  personalRevision: 0, workspaceRevision: 0, sourceRevision: 0, sourceDigest: "", membershipRevision: 1,
  moderateArchive: false, manageMembers: false, token: "a".repeat(64) };
const catalog = (digest: string) => ({ availability: { state: "open" as const }, profileId: "test", digest, entries: [] });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readProjectionScope).mockResolvedValue(scope);
  vi.mocked(readClassificationCatalog).mockResolvedValue(catalog("b".repeat(64)));
  vi.mocked(readCoherentProjection).mockImplementation(async (_db, _sub, _workspace, _city, _mode, read) => ({ scope, payload: await read() }));
});
describe("classification coherence and catalog versions", () => {
  it("should limit all unstable scope attempts to three and preserve signal mode", async () => {
    vi.mocked(readCoherentProjection).mockRejectedValue(new ScopeError(503, "projection_revision_unstable"));
    await expect(readClassificationProjection(db, "reader", scope.workspaceId, "city", {}, async () => 1))
      .rejects.toThrow("projection_revision_unstable");
    expect(readCoherentProjection).toHaveBeenCalledTimes(3);
    for (const args of vi.mocked(readCoherentProjection).mock.calls) {
      expect(args[4]).toBe("signal");
      expect(args[6]).toBe(1);
    }
  });
  it("should retry a catalog-only change and bind the stable version into query tokens", async () => {
    vi.mocked(readClassificationCatalog).mockResolvedValueOnce(catalog("b".repeat(64)))
      .mockResolvedValueOnce(catalog("c".repeat(64)));
    const payload = vi.fn(async () => "ready");
    const result = await readClassificationProjection(db, "reader", scope.workspaceId, "city", { citySlug: "city" }, payload);
    expect(payload).toHaveBeenCalledTimes(2);
    expect(result.snapshot.catalogVersion).toBe("b".repeat(64));
    const first = result.snapshot.queryToken;
    vi.mocked(readClassificationCatalog).mockResolvedValue(catalog("d".repeat(64)));
    const changed = await readClassificationProjection(db, "reader", scope.workspaceId, "city", { citySlug: "city" }, payload);
    expect(changed.snapshot.baseToken).toBe(result.snapshot.baseToken);
    expect(changed.snapshot.queryToken).not.toBe(first);
  });
});
