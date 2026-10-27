import { describe, expect, it } from "vitest";
import { WorkspaceId } from "../services/facets/classification-query.js";
import { Head } from "../services/facets/classification-contracts.js";
import { McpWorkspaceId, McpSignalSearchResponse } from "./mcp-signal-search.js";

describe("signal schemas retain the Zod 3 identifier contract", () => {
  for (const id of ["11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222", "aaaaaaaa-aaaa-0000-0000-aaaaaaaaaaaa"]) {
    it("accepts historical identifier " + id + " and retains normalization", () => {
      for (const schema of [WorkspaceId, McpWorkspaceId]) {
        expect(schema.parse(id.toUpperCase())).toBe(id);
      }
      expect(Head.parse({ id, state: "active", createdAt: "2026-10-27T00:00:00Z", reason: null }).id).toBe(id);
      expect(McpSignalSearchResponse.parse({
        ok: true, workspaceId: id, citySlug: "longueuil", signals: [],
      }).workspaceId).toBe(id);
    });
  }
  for (const id of ["", "radar/default", "11111111-1111-1111-1111-11111111111g"]) {
    it("rejects malformed identifier " + JSON.stringify(id), () => {
      expect(WorkspaceId.safeParse(id).success).toBe(false);
      expect(McpWorkspaceId.safeParse(id).success).toBe(false);
      expect(Head.safeParse({ id, state: "active", createdAt: "2026-10-27T00:00:00Z", reason: null }).success).toBe(false);
    });
  }
});
