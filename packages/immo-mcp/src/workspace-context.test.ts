/**
 * 6H MCP workspace context: explicit per-call resolution, no defaults.
 * Synthetic workspace ids only.
 */
import { describe, expect, it } from "vitest";
import { HttpDataSource } from "./data-source.js";
import { resolveWorkspaceContext, WorkspaceContextError } from "./workspace-context.js";

const first = "11111111-1111-1111-1111-111111111111";
const second = "22222222-2222-2222-2222-222222222222";

describe("resolveWorkspaceContext", () => {
  it("resolves the single authorized workspace without a request", () => {
    expect(resolveWorkspaceContext([first])).toBe(first);
  });

  it("resolves an explicit request inside the authorized set", () => {
    expect(resolveWorkspaceContext([first, second], second)).toBe(second);
  });

  it("refuses a requested workspace outside the authorized set", () => {
    expect(() => resolveWorkspaceContext([first], second))
      .toThrowError(WorkspaceContextError);
    try {
      resolveWorkspaceContext([first], second);
    } catch (error) {
      expect((error as WorkspaceContextError).code).toBe("workspace_not_authorized");
    }
  });

  it("fails when several workspaces share one ambiguous call", () => {
    try {
      resolveWorkspaceContext([first, second]);
      expect.unreachable();
    } catch (error) {
      expect((error as WorkspaceContextError).code).toBe("workspace_ambiguous");
    }
  });

  it("fails when no workspace is authorized", () => {
    expect(() => resolveWorkspaceContext([])).toThrowError(WorkspaceContextError);
  });

  it("never substitutes a transport default", () => {
    expect(() => resolveWorkspaceContext(["radar/default"]))
      .toThrowError("workspace_missing");
    expect(() => resolveWorkspaceContext([], null)).toThrowError("workspace_missing");
    expect(() => resolveWorkspaceContext([first], "radar/default"))
      .toThrowError(WorkspaceContextError);
  });

  it("treats case variants of one authorized UUID as one workspace", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(resolveWorkspaceContext([id, id.toUpperCase()])).toBe(id);
  });
});

describe("HttpDataSource workspace forwarding", () => {
  const baseUrl = "http://radar-api:3000";
  it.each([undefined, first])("forwards reserved workspace %s without a transport default", async (workspaceId) => {
    const seen: string[] = [];
    const source = new HttpDataSource({ baseUrl, fetchImpl: async (input) => {
      seen.push(String(input));
      return Response.json({ ok: true, workspaceId: first, citySlug: "longueuil", signals: [] });
    } });
    await source.searchSignals({ city: "longueuil", limit: 20, workspaceId });
    const url = new URL(seen[0]!);
    expect(url.pathname).toBe("/api/v1/mcp/facets/signals/search");
    expect(url.searchParams.get("workspaceId")).toBe(workspaceId ?? null);
    expect(seen).toHaveLength(1);
  });
});
