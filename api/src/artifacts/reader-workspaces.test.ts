import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceError } from "../services/workspaces/types.js";
import { createBasketReadOperation } from "./reader-baskets.js";
import { isReaderOperation, operationMethod, validateOperationParams } from "./reader-operations.js";
import { validateReaderResponse } from "./reader-responses.js";
import type { ApiReaderContext } from "./reader-context.js";

vi.mock("../services/workspaces/store.js", () => ({ listWorkspacesForAccount: vi.fn() }));
vi.mock("../services/facets/classification-context.js", () => ({ readFacetContext: vi.fn() }));
import { listWorkspacesForAccount } from "../services/workspaces/store.js";
import { readFacetContext } from "../services/facets/classification-context.js";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const context = (readerSub: string) => ({ readerSub } as ApiReaderContext);
const bridge = () => createBasketReadOperation({ db: {} as never, store: {} as never });
const membership = (id: string) => ({ workspace: { id, slug: "team", label: "Team", scope: "all-municipalities" as const },
  accountId: "private-account", moderateArchive: true, manageMembers: true });
beforeEach(() => { vi.resetAllMocks(); });
/** Published v1 row (starter pages) + the app parser row (§3.3), never account details. */
const row = (id: string, availability: unknown = { state: "open" }) => ({
  id, slug: "team", label: "Team", signals: { availability },
  workspace: { id, slug: "team", label: "Team" }, moderateArchive: false, manageMembers: false });

describe("reader workspace discovery", () => {
  it("should expose a strict read-only operation without caller-supplied identity", () => {
    expect(isReaderOperation("workspaces.list.v1")).toBe(true);
    expect(operationMethod("workspaces.list.v1")).toBe("GET");
    expect(validateOperationParams("workspaces.list.v1", {}).ok).toBe(true);
    for (const params of [{ readerSub: "publisher" }, { workspaceId: ids[0] }, { limit: 10 }]) {
      expect(validateOperationParams("workspaces.list.v1", params).ok).toBe(false);
    }
  });

  it("should list only the verified reader's workspaces without account details", async () => {
    vi.mocked(listWorkspacesForAccount).mockImplementation(async (_db, sub) => [membership(sub === "alice" ? ids[0]! : ids[1]!)]);
    vi.mocked(readFacetContext).mockImplementation(async (_db, _sub, workspaceId) => ({ workspaceId,
      signals: { availability: { state: "open" } } } as never));
    const read = bridge();
    for (const [index, sub] of ["alice", "bob"].entries()) {
      const result = await read("workspaces.list.v1", {}, context(sub));
      expect(result).toEqual({ ok: true, workspaces: [row(ids[index]!)] });
      expect(readFacetContext).toHaveBeenCalledWith(expect.anything(), sub, ids[index]);
      expect(validateReaderResponse("workspaces.list.v1", result, sub)).toEqual(result);
    }
    expect(vi.mocked(listWorkspacesForAccount).mock.calls.map((call) => call[1])).toEqual(["alice", "bob"]);
  });

  it.each([
    { state: "closed", reason: "maintenance" }, { state: "closed", reason: "not_activated" },
    { state: "unavailable", reason: "unresolved_history" },
  ])("should keep the published signal/basket availability $reason", async (availability) => {
    vi.mocked(listWorkspacesForAccount).mockResolvedValue([membership(ids[0]!)]);
    vi.mocked(readFacetContext).mockResolvedValue({ workspaceId: ids[0], signals: { availability } } as never);
    const result = await bridge()("workspaces.list.v1", {}, context("alice"));
    expect(result).toEqual({ ok: true, workspaces: [row(ids[0]!, availability)] });
    expect(() => validateReaderResponse("workspaces.list.v1", result, "alice")).not.toThrow();
  });

  it("should serve constant read-only capabilities even for a real moderator", async () => {
    vi.mocked(listWorkspacesForAccount).mockResolvedValue([membership(ids[0]!)]);
    vi.mocked(readFacetContext).mockResolvedValue({ workspaceId: ids[0],
      signals: { availability: { state: "open" } } } as never);
    const result = await bridge()("workspaces.list.v1", {}, context("alice")) as {
      workspaces: Array<{ moderateArchive: boolean; manageMembers: boolean }>;
    };
    expect(result.workspaces[0]).toMatchObject({ moderateArchive: false, manageMembers: false });
  });

  it("should return an empty list without selecting a default workspace", async () => {
    vi.mocked(listWorkspacesForAccount).mockResolvedValue([]);
    expect(await bridge()("workspaces.list.v1", {}, context("alice"))).toEqual({ ok: true, workspaces: [] });
    expect(readFacetContext).not.toHaveBeenCalled();
  });

  it("should refuse membership revoked during discovery instead of returning stale labels", async () => {
    vi.mocked(listWorkspacesForAccount).mockResolvedValue([membership(ids[0]!)]);
    vi.mocked(readFacetContext).mockRejectedValue(new WorkspaceError(403, "workspace_membership_required"));
    await expect(bridge()("workspaces.list.v1", {}, context("alice"))).rejects.toThrow("workspace_membership_required");
  });

  it("should refuse a mismatched context and reject accidental PII in the wire contract", async () => {
    vi.mocked(listWorkspacesForAccount).mockResolvedValue([membership(ids[0]!)]);
    vi.mocked(readFacetContext).mockResolvedValue({ workspaceId: ids[1] } as never);
    await expect(bridge()("workspaces.list.v1", {}, context("alice"))).rejects.toThrow("Workspace mismatch");
    for (const leaked of [{ accountId: "private" }, { scope: "all-municipalities" },
      { moderateArchive: true }, { manageMembers: true },
      { workspace: { id: ids[1], slug: "team", label: "Team" } }]) {
      expect(() => validateReaderResponse("workspaces.list.v1", { ok: true,
        workspaces: [{ ...row(ids[0]!), ...leaked }] }, "alice")).toThrow();
    }
    expect(() => validateReaderResponse("workspaces.list.v1", { ok: true, workspaces: [{
      ...row(ids[0]!), workspace: { id: ids[0], slug: "team", label: "Team", scope: "all-municipalities" },
    }] }, "alice")).toThrow();
  });
});
