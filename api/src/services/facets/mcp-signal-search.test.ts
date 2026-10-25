import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import { getSignalNodesForCity } from "../graph/graph-store.js";
import { toGraphSignalCard, toDegradedSignalCard } from "../../routes/graph-signals.js";
import { readWorkspaceArchiveCity } from "./workspace-reader.js";
import { resolveMcpSignalWorkspace, revalidateMcpSignalWorkspace } from "./mcp-signal-workspace.js";
import { readMcpSignalCards } from "./mcp-signal-search.js";

vi.mock("../graph/graph-store.js", () => ({ getSignalNodesForCity: vi.fn() }));
vi.mock("./workspace-reader.js", () => ({ readWorkspaceArchiveCity: vi.fn() }));
vi.mock("./mcp-signal-workspace.js", () => ({
  resolveMcpSignalWorkspace: vi.fn(), revalidateMcpSignalWorkspace: vi.fn(),
}));
vi.mock("./projection-revisions.js", () => ({ readCoherentProjection: async (
  _db: unknown, _sub: unknown, _workspace: unknown, _city: unknown, _mode: unknown,
  read: () => Promise<unknown>,
) => ({ payload: await read() }) }));
vi.mock("../../routes/graph-signals.js", () => ({
  createDocEnrichmentContext: () => ({ cache: new Map(), deadlineAt: Date.now() + 2_000, exceeded: false }),
  toGraphSignalCard: vi.fn(async (_store, node) => node),
  toDegradedSignalCard: vi.fn((node) => node),
}));
const db = {} as Database, store = {} as ObjectStore;
const args = { city: "city", limit: 20, showDiscarded: false };
const nodes = ["hidden", "visible"].map((id) => ({ id, type: "Signal", citySlug: "city",
  label: id, props: {}, sourceRef: null, createdAt: new Date("2026-01-01Z") }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveMcpSignalWorkspace).mockResolvedValue("workspace");
  vi.mocked(revalidateMcpSignalWorkspace).mockResolvedValue();
  vi.mocked(getSignalNodesForCity).mockResolvedValue(nodes);
  vi.mocked(readWorkspaceArchiveCity).mockResolvedValue([{
    target: { citySlug: "city", type: "Signal", id: "hidden" }, effectiveDiscarded: true,
    personal: null, workspace: null, capabilities: { discardPersonally: true, moderateArchive: false },
  }]);
});
describe("MCP coherent card read authority and masking", () => {
  it("never enriches a masked target", async () => {
    const result = await readMcpSignalCards({ db, store }, "human", args);
    expect(result.cards.map((node) => node.id)).toEqual(["visible"]);
    expect(toGraphSignalCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toGraphSignalCard).mock.calls[0]![1].id).toBe("visible");
  });
  it("reveals only after authority and archive guards", async () => {
    expect((await readMcpSignalCards({ db, store }, "human", { ...args, showDiscarded: true })).cards)
      .toHaveLength(2);
    vi.mocked(resolveMcpSignalWorkspace).mockRejectedValueOnce(new Error("workspace_missing"));
    vi.mocked(toGraphSignalCard).mockClear();
    await expect(readMcpSignalCards({ db, store }, "human", { ...args, showDiscarded: true }))
      .rejects.toThrow("workspace_missing");
    expect(toGraphSignalCard).not.toHaveBeenCalled();
  });
  it("propagates archive authority errors even when revealing", async () => {
    vi.mocked(readWorkspaceArchiveCity).mockRejectedValueOnce(new Error("personal_history_unresolved"));
    await expect(readMcpSignalCards({ db, store }, "human", { ...args, showDiscarded: true }))
      .rejects.toThrow("personal_history_unresolved");
    expect(toGraphSignalCard).not.toHaveBeenCalled();
  });
  it("degrades a failed card while retaining final authority checks", async () => {
    vi.mocked(toGraphSignalCard).mockRejectedValueOnce(new Error("synthetic document fault"));
    expect((await readMcpSignalCards({ db, store }, "human", args)).cards).toHaveLength(1);
    expect(toDegradedSignalCard).toHaveBeenCalledTimes(1);
    vi.mocked(revalidateMcpSignalWorkspace).mockRejectedValueOnce(new Error("workspace_context_changed"));
    await expect(readMcpSignalCards({ db, store }, "human", args)).rejects.toThrow("workspace_context_changed");
  });
});
