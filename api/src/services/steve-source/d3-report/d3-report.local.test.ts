/**
 * Local read-only check against the real Triage workbook copy.
 *
 * Skipped when `tmp/steve/radar-triage-signaux.xlsx` is absent. The copy
 * lives under git-ignored `tmp/steve/`, is never committed and is removed
 * after the run. Only counts are asserted, never row values. The synthetic
 * graph below uses synthetic values only.
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import { buildTestGraphSet } from "./fixtures.js";
import { buildD3Report } from "./report.js";
import { readTriageRows } from "./triage-rows.js";

const workbookPath = fileURLToPath(
  new URL("../../../../../tmp/steve/radar-triage-signaux.xlsx", import.meta.url),
);
const hasWorkbook = existsSync(workbookPath);

describe("d3-report local workbook", () => {
  it.skipIf(!hasWorkbook)("verifies real counts read-only", () => {
    const bytes = Uint8Array.from(readFileSync(workbookPath));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe("c7e19f46feb78c245fcd04b3e64fd4ac6f174f2d30ff1d4c77aa5a2bf0dc1bb8");
    const inventory = captureWorkbookInventory(bytes);
    const rows = readTriageRows(inventory);
    expect(rows.length).toBe(124);
    const graphSet = buildTestGraphSet([
      {
        slug: "ville-synth-a",
        nodes: [
          { id: "gn-1", type: "Signal", props: { reglement_number: "SYN-101" } },
        ],
      },
    ]);
    const report = buildD3Report(inventory, graphSet);
    expect(report.lines).toBe(124);
    expect(
      report.statuses.unavailable +
        report.statuses.ambiguous +
        report.statuses.fully_resolved +
        report.statuses.partially_resolved +
        report.statuses.unresolved,
    ).toBe(124);
    expect(report.byClassement["Pertinent"]).toBe(40);
    expect(report.byClassement["À surveiller"]).toBe(29);
    expect(report.byClassement["Non pertinent"]).toBe(55);
    console.info(JSON.stringify({
      sha256, lines: report.lines, statuses: report.statuses,
      classementCounts: [
        report.byClassement["Pertinent"], report.byClassement["À surveiller"],
        report.byClassement["Non pertinent"],
      ],
      targetedReferences: report.targetedReferences,
      ignoredTokens: report.ignoredTokens, resolvedTriplets: report.resolvedTriplets,
    }));
  });
});
