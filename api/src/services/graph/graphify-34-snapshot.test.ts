import { describe, expect, it, vi } from "vitest";
import { applyGraphify34Snapshots, buildGraphify34Manifest } from "./graphify-34-snapshot.js";

describe("Graphify 3.4 S3 snapshot backup", () => {
  it("refuses canonical snapshot writes when the pre-apply backup is unavailable", async () => {
    const writes: string[] = [];
    const project = vi.fn(async () => undefined);
    const snapshot = {
      municipality: "witness",
      graphify_pass: "3.4" as const,
      ontology_version: "2.3" as const,
      nodes: [],
    };
    const target = {
      municipality: "witness",
      snapshot,
      manifest: buildGraphify34Manifest("witness", snapshot),
    };
    const store = {
      list: async () => ["graph/witness/latest.json"],
      get: async () => { throw new Error("backup source unavailable"); },
      put: async (key: string) => {
        writes.push(key);
        return { key };
      },
    };

    await expect(applyGraphify34Snapshots(store, [target], "20260728T120000Z", project))
      .rejects.toThrow("backup source unavailable");
    expect(writes).toEqual([]);
    expect(project).not.toHaveBeenCalled();
  });
});
