import { spawnSync } from "node:child_process";
import { expect } from "vitest";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";

/** Synthetic parts only; repeated XML is compressed independently per sheet. */
export function repeatedSheetWorkbook(count: number, sheet: string, declarations = ""): Uint8Array {
  const ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const parts: Record<string, string> = {};
  let sheets = "";
  let rels = "";
  for (let id = 1; id <= count; id++) {
    sheets += `<sheet name="Synthetic ${String(id)}" sheetId="${String(id)}" r:id="r${String(id)}"/>`;
    rels += `<Relationship Id="r${String(id)}" Target="worksheets/sheet${String(id)}.xml"/>`;
    parts[`xl/worksheets/sheet${String(id)}.xml`] = sheet;
  }
  const overrides = {
    ...parts,
    "xl/workbook.xml": `<workbook xmlns:r="${ns}" ${declarations}><sheets>${sheets}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${rels}</Relationships>`,
    "xl/sharedStrings.xml": "<sst/>",
  };
  const extra = Object.fromEntries(Object.entries(parts).filter((_, index) => index >= 3));
  return buildSyntheticWorkbook(overrides, extra);
}

/** A hard deadline bounds synchronous CPU regressions; V8's total heap is capped. */
export function runCaptureProbe(source: string, timeout = 5000): void {
  const result = spawnSync(process.execPath, [
    "--max-old-space-size=488", "--max-semi-space-size=8", "--import", "tsx", "--input-type=module", "-e", `
      import { strict as assert } from "node:assert";
      import { getHeapStatistics } from "node:v8";
      import { captureWorkbookInventory } from ${JSON.stringify(new URL("./inventory.ts", import.meta.url).href)};
      import { repeatedSheetWorkbook } from ${JSON.stringify(import.meta.url)};
      assert.ok(getHeapStatistics().heap_size_limit <= 512 * 1024 * 1024);
      ${source}
      assert.equal(captureWorkbookInventory(repeatedSheetWorkbook(1, '<worksheet/>')).sheets.length, 1);
    `], { timeout, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
}
