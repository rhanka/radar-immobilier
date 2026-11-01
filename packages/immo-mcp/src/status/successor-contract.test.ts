import { describe, expect, it } from "vitest";
import {
  CURRENT_SEARCH_SIGNALS_HAS_WORKSPACE,
  H4_CHECKPOINT_TOOL_COUNT,
  SUCCESSOR_SEARCH_ENDPOINT,
  isAuthorizedEmptyResult,
  resolveSuccessorSearchWorkspace,
  validateSuccessorManifest,
} from "./successor-contract.js";

const W1 = "11111111-2222-4333-8444-555555555555";
const W2 = "22222222-3333-4444-8555-666666666666";

describe("successor and search_signals contract", () => {
  it("freezes the 12 / 16 / 22 milestone counts", () => {
    expect(validateSuccessorManifest(12, H4_CHECKPOINT_TOOL_COUNT, 22)).toBe(true);
    expect(validateSuccessorManifest(12, 16, 21)).toBe(false);
    expect(CURRENT_SEARCH_SIGNALS_HAS_WORKSPACE).toBe(false);
    expect(SUCCESSOR_SEARCH_ENDPOINT).toEqual({
      method: "GET",
      path: "/api/v1/mcp/facets/signals/search",
    });
  });

  it("resolves the successor workspace only from explicit or single membership", () => {
    expect(resolveSuccessorSearchWorkspace([], null)).toEqual({ error: "workspace_missing" });
    expect(resolveSuccessorSearchWorkspace([W1, W2], null)).toEqual({ error: "workspace_ambiguous" });
    expect(resolveSuccessorSearchWorkspace([W1], undefined)).toEqual({ workspaceId: W1.toLowerCase() });
    expect(resolveSuccessorSearchWorkspace([W1], W2)).toEqual({ error: "workspace_not_authorized" });
    expect(resolveSuccessorSearchWorkspace([W1], W1)).toEqual({ workspaceId: W1.toLowerCase() });
    expect(resolveSuccessorSearchWorkspace(["not-a-uuid"], null)).toEqual({
      error: "workspace_malformed",
    });
  });

  it("never turns refusal states into an authorized empty result", () => {
    expect(isAuthorizedEmptyResult(true, false, false)).toBe(true);
    expect(isAuthorizedEmptyResult(false, false, false)).toBe(false);
    expect(isAuthorizedEmptyResult(true, true, false)).toBe(false);
    expect(isAuthorizedEmptyResult(true, false, true)).toBe(false);
  });
});
