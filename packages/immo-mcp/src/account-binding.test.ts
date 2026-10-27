import { describe, expect, it, vi } from "vitest";
import { AccountBindingUnavailable, accountAuthorizer, createAccountBinding } from "./account-binding.js";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";

const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request = (workspaces = ["default"]): VerifiedMcpRequest => ({
  principal: { issuer: "synthetic", sub: "alice", scopes: ["immo:read"], claims: [], attributes: { workspaces } },
  resource: "synthetic:mcp", correlationId: "test", signal: new AbortController().signal,
});
describe("trusted account bindings", () => {
  it("should requery approval for each invocation and preserve parameterized identity", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "id", status: "approved" }] })
      .mockResolvedValueOnce({ rows: [{ id: "id", status: "suspended" }] });
    const authorize = accountAuthorizer({ query });
    expect(await authorize("get_zones_geojson", request())).toBe(true);
    expect(await authorize("get_zones_geojson", request())).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![1]).toEqual(["alice"]);
  });
  it("should require every explicit membership to remain active", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "id", status: "approved" }] })
      .mockResolvedValueOnce({ rows: [{ workspace_id: workspace }] })
      .mockResolvedValueOnce({ rows: [{ id: "id", status: "approved" }] })
      .mockResolvedValueOnce({ rows: [] });
    const authorize = accountAuthorizer({ query });
    expect(await authorize("get_lots_geojson", request([workspace]))).toBe(true);
    expect(await authorize("get_lots_geojson", request([workspace]))).toBe(false);
    expect(query.mock.calls[1]![1]).toEqual(["id", [workspace]]);
    expect(query.mock.calls[1]![0]).toContain("revoked_at IS NULL");
  });
  it("should leave a missing binding unavailable", () => {
    expect(createAccountBinding({})).toBeUndefined();
  });
});
describe("artifact tools in the general opening", () => {
  it("should exempt stale workspace claims only in general mode", async () => {
    for (const mode of ["general", "validation", "off"] as const) {
      const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "id", status: "approved" }] })
        .mockResolvedValueOnce({ rows: [] });
      const authorize = accountAuthorizer({ query }, { ARTIFACTS_CONTROL_MODE: mode });
      expect(await authorize("artifacts_ensure", request([workspace]))).toBe(mode === "general");
      expect(query).toHaveBeenCalledTimes(mode === "general" ? 1 : 2);
    }
  });
  it("should admit an approved account whatever the workspace claims carry", async () => {
    for (const workspaces of [["default"], [], ["stale-workspace"],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      "not-an-array", undefined, [42]] as unknown[]) {
      const query = vi.fn().mockResolvedValue({ rows: [{ id: "id", status: "approved" }] });
      const authorize = accountAuthorizer({ query }, { ARTIFACTS_CONTROL_MODE: "general" });
      for (const tool of ["artifacts_ensure", "artifacts_publish", "artifacts_list", "artifacts_get"]) {
        expect(await authorize(tool, request(workspaces as never)), `${tool} ${String(workspaces)}`)
          .toBe(true);
      }
      // Approval is the only query; stale claims never reach the membership check.
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls[0]![1]).toEqual(["alice"]);
    }
  });

  it("should still refuse suspended, pending and unknown accounts on artifact tools", async () => {
    for (const [stored, calls] of [["suspended", 1], ["pending", 1], [undefined, 1]] as const) {
      const query = vi.fn().mockResolvedValueOnce(
        stored === undefined ? { rows: [] } : { rows: [{ id: "id", status: stored }] });
      const authorize = accountAuthorizer({ query });
      expect(await authorize("artifacts_publish", request(["stale-workspace"]))).toBe(false);
      expect(query).toHaveBeenCalledTimes(calls);
    }
  });

  it("should keep the membership controls on business tools", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "id", status: "approved" }] })
      .mockResolvedValueOnce({ rows: [] });
    const authorize = accountAuthorizer({ query });
    expect(await authorize("search_signals",
      request(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]))).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("should expose a sanitized retriable error when the approval query fails on artifact tools", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("postgres://private:secret@db.invalid/account"));
    const error = await accountAuthorizer({ query })("artifacts_ensure", request(["stale"])).catch((cause) => cause);
    expect(error).toBeInstanceOf(AccountBindingUnavailable);
    expect(error).toMatchObject({ message: "account_binding_unavailable", retriable: true });
    expect(String(error)).not.toContain("private");
  });
});

describe("trusted account bindings", () => {
  it("should expose a sanitized retriable error for either database query failure", async () => {
    for (const membership of [false, true]) {
      const query = vi.fn();
      if (membership) query.mockResolvedValueOnce({ rows: [{ id: "id", status: "approved" }] });
      query.mockRejectedValueOnce(new Error("postgres://private:secret@database.invalid/account"));
      const error = await accountAuthorizer({ query })("get_lots_geojson", request([workspace])).catch((cause) => cause);
      expect(error).toBeInstanceOf(AccountBindingUnavailable);
      expect(error).toMatchObject({ message: "account_binding_unavailable", retriable: true });
      expect(String(error)).not.toContain("private");
      expect(error.cause).toBeUndefined();
    }
  });
});
