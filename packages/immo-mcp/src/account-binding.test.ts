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
