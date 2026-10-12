import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { CommentRevisionRecord } from "@sentropic/comments";
import { createAnnotationHostPorts } from "./host-ports.js";
import { inventorySyntheticWorkbook, type SyntheticWorkbookCapture } from "./workbook-inventory.js";
import { prepareSyntheticWorkbook } from "./prepare-workbook.js";
const syntheticWorkbook = JSON.parse(readFileSync(new URL("../../../tests/fixtures/annotations-workbook.json", import.meta.url), "utf8")) as SyntheticWorkbookCapture;
import { SYNTHETIC_CAPACITY, SYNTHETIC_SCOPE } from "./fixtures.js";

const raw = JSON.stringify(syntheticWorkbook);
const options = { scope: SYNTHETIC_SCOPE, expectedSheetIds: ["native-tab", "missing-tab"],
  registration: { principal: "synthetic-importer", registeredAt: 1_791_792_000_000 },
  mappingVersion: "immo-workbook-v1", conversionVersion: "synthetic-conversion-v1",
  executorService: "synthetic-immo-import", executorRun: "frozen-synthetic-run" };
function host(allow = true) {
  const inventory = inventorySyntheticWorkbook(raw, SYNTHETIC_SCOPE, options.expectedSheetIds);
  return createAnnotationHostPorts({ hasCapability: async () => allow,
    resources: async (ref) => inventory.resources.filter((resource) => resource.ref.id === ref.id) });
}

describe("synthetic workbook preparation without UI or canonical storage", () => {
  it("should prepare independent same-row attributions through common builders and replay identically", async () => {
    const prepared = await prepareSyntheticWorkbook(raw, options, host(), SYNTHETIC_CAPACITY);
    expect(await prepareSyntheticWorkbook(raw, options, host(), SYNTHETIC_CAPACITY)).toEqual(prepared);
    expect(prepared.status).toBe("prepared-not-committed");
    expect(prepared.counts).toEqual({ sourceContributions: 2, prepared: 2, blocked: 0 });
    expect(prepared.manifest.sourceUnitCount).toBe(2);
    const comments = prepared.candidates.flatMap((candidate) => candidate.records)
      .filter((r): r is CommentRevisionRecord => r.kind === "comment-revision");
    expect(comments.map((r) => r.provenance.attribution.variant)).toEqual(["human", "unknown"]);
    expect(comments[0]!.body).toEqual(syntheticWorkbook.sheets[0]!.contributions[0]!.body);
    const structures = prepared.candidates.map((candidate) => candidate.records[0]!);
    expect(structures[0]!.kind).toBe("thread-structure-revision");
    if (structures[0]!.kind !== "thread-structure-revision" || structures[1]!.kind !== "thread-structure-revision") throw new Error("Unexpected candidate");
    expect(structures[0]!.primary).toEqual(structures[1]!.primary);
    expect(prepared.inventory.issues).toContain("sheet-absent:missing-tab");
  });
  it("should report each denied unit separately and never claim it committed or complete", async () => {
    const denied = await prepareSyntheticWorkbook(raw, options, host(false), SYNTHETIC_CAPACITY);
    expect(denied.counts).toEqual({ sourceContributions: 2, prepared: 0, blocked: 2 });
    expect(denied.manifest.sourceUnitCount).toBe(0);
    expect(denied.candidates).toEqual([]);
  });
});
