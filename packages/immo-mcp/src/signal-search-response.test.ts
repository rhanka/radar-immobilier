import { describe, expect, it } from "vitest";
import { parseSignalSearchResponse } from "./signal-search-response.js";

const response = (workspaceId: string) => ({
  ok: true, workspaceId, citySlug: "longueuil", signals: [],
});
describe("signal response workspace identifiers", () => {
  for (const workspaceId of ["11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222", "aaaaaaaa-aaaa-0000-0000-aaaaaaaaaaaa"]) {
    it("accepts historical identifier " + workspaceId, () => {
      expect(parseSignalSearchResponse(response(workspaceId), {
        city: "longueuil", limit: 20, workspaceId,
      })).toEqual([]);
    });
  }
  for (const workspaceId of ["radar/default", "11111111-1111-1111-1111-11111111111g",
    "AAAAAAAA-AAAA-0000-0000-AAAAAAAAAAAA"]) {
    it("refuses malformed or noncanonical upstream identifier " + workspaceId, () => {
      expect(() => parseSignalSearchResponse(response(workspaceId), {
        city: "longueuil", limit: 20,
      })).toThrow("The signal API response is invalid.");
    });
  }
});
