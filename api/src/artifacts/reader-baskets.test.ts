import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassificationError } from "../services/facets/classification-errors.js";
import type { ApiReaderContext } from "./reader-context.js";
import { createBasketReadOperation } from "./reader-baskets.js";

vi.mock("../services/facets/classification-context.js", () => ({ readFacetContext: vi.fn() }));
vi.mock("../services/facets/classification-search.js", () => ({ searchSignalClassifications: vi.fn() }));
vi.mock("../services/facets/classification-state.js", () => ({ readSignalClassification: vi.fn() }));

import { readFacetContext } from "../services/facets/classification-context.js";
import { searchSignalClassifications } from "../services/facets/classification-search.js";
import { readSignalClassification } from "../services/facets/classification-state.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

function context(sub: string): ApiReaderContext {
  return {
    readerSub: sub, sessionId: "session-1", artifactId: "artifact-1", releaseId: "release-1",
    profileName: "demo", policyRevision: "pol-001",
    capabilities: ["signals.protected-read"], source: "h5-grant",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("basket bridge reader isolation", () => {
  it("should call services with the verified reader and return per-reader baskets", async () => {
    vi.mocked(readFacetContext).mockImplementation(async (_db, sub, workspaceId) => (
      { workspaceId, marker: sub } as never));
    const bridge = createBasketReadOperation({ db: {} as never, store: {} as never });
    const alice = await bridge("baskets.context.v1", { workspaceId: WORKSPACE }, context("reader-alice"));
    const bob = await bridge("baskets.context.v1", { workspaceId: WORKSPACE }, context("reader-bob"));
    expect(vi.mocked(readFacetContext).mock.calls.map((call) => call[1])).toEqual(["reader-alice", "reader-bob"]);
    expect((alice as { context: { marker: string } }).context.marker).toBe("reader-alice");
    expect((bob as { context: { marker: string } }).context.marker).toBe("reader-bob");
  });

  it("should refuse foreign, revoked or empty workspaces without a default", async () => {
    vi.mocked(searchSignalClassifications).mockRejectedValue(new ClassificationError("workspace_not_authorized"));
    const bridge = createBasketReadOperation({ db: {} as never, store: {} as never });
    await expect(bridge("baskets.search.v1",
      { workspaceId: WORKSPACE, citySlug: "valleyfield" }, context("reader-alice")))
      .rejects.toThrow("workspace_not_authorized");
    expect(vi.mocked(searchSignalClassifications).mock.calls[0]?.[1]).toBe("reader-alice");
  });

  it("should refuse a service response for another workspace", async () => {
    vi.mocked(readSignalClassification).mockResolvedValue({ workspaceId: "22222222-2222-4222-8222-222222222222" } as never);
    const bridge = createBasketReadOperation({ db: {} as never, store: {} as never });
    await expect(bridge("baskets.state.v1",
      { workspaceId: WORKSPACE, citySlug: "city", type: "Signal", id: "id" }, context("reader-alice")))
      .rejects.toThrow("Workspace mismatch");
  });
});
