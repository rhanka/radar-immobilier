import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client.js";
import { listWorkspacesForAccount } from "../workspaces/store.js";
import { resolveMcpSignalWorkspace } from "./mcp-signal-workspace.js";

vi.mock("../workspaces/store.js", () => ({ listWorkspacesForAccount: vi.fn() }));
const first = "11111111-1111-4111-9111-111111111111";
const second = "22222222-2222-4222-9222-222222222222";
const db = {} as Database;
function memberships(ids: string[]) {
  vi.mocked(listWorkspacesForAccount).mockResolvedValue(ids.map((id) => ({
    workspace: { id, slug: id, label: id, scope: "all-municipalities" },
    accountId: "account", moderateArchive: false, manageMembers: false,
  })));
}
describe("MCP workspace resolution", () => {
  it("requires an active singleton when the selector is omitted", async () => {
    memberships([]);
    await expect(resolveMcpSignalWorkspace(db, "human")).rejects.toThrow("workspace_missing");
    memberships([first]);
    expect(await resolveMcpSignalWorkspace(db, "human")).toBe(first);
    expect(listWorkspacesForAccount).toHaveBeenLastCalledWith(db, "human");
    memberships([first, second]);
    await expect(resolveMcpSignalWorkspace(db, "human")).rejects.toThrow("workspace_ambiguous");
  });
  it("never substitutes another workspace for a selector", async () => {
    memberships([first]);
    await expect(resolveMcpSignalWorkspace(db, "human", second))
      .rejects.toThrow("workspace_not_authorized");
    expect(await resolveMcpSignalWorkspace(db, "human", first)).toBe(first);
    await expect(resolveMcpSignalWorkspace(db, "human", "default"))
      .rejects.toThrow("workspace_malformed");
  });
  it("propagates an account refusal without treating it as missing memberships", async () => {
    vi.mocked(listWorkspacesForAccount).mockRejectedValueOnce(new Error("account_not_approved"));
    await expect(resolveMcpSignalWorkspace(db, "human")).rejects.toThrow("account_not_approved");
  });
});
