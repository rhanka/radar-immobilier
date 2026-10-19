import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MAX_XML_CELLS, MAX_XML_ELEMENTS } from "./xml.js";

describe("XML allocation budgets", () => {
  it.each([
    ["elements", "<a/>", MAX_XML_ELEMENTS - 1, `${String(MAX_XML_ELEMENTS)}-element`],
    ["cells", "<c/>", MAX_XML_CELLS, `${String(MAX_XML_CELLS)}-cell`],
  ])("accepts the %s boundary and rejects overflow under a 512 MiB heap", (_name, unit, count, message) => {
    const parserUrl = new URL("./xml.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, [
      "--max-old-space-size=488", "--max-semi-space-size=8", "--import", "tsx", "--input-type=module", "-e", `
        import { strict as assert } from "node:assert";
        import { getHeapStatistics } from "node:v8";
        import { parseXml } from ${JSON.stringify(parserUrl)};
        assert.ok(getHeapStatistics().heap_size_limit <= 512 * 1024 * 1024);
        const unit = ${JSON.stringify(unit)};
        const count = ${String(count)};
        assert.doesNotThrow(() => parseXml('<root>' + unit.repeat(count) + '</root>'));
        assert.throws(() => parseXml('<root>' + unit.repeat(count + 1) + '</root>'),
          { name: 'SteveCaptureError', message: 'XML capture exceeds the ${message} limit' }
        );
        assert.doesNotThrow(() => parseXml('<root><c/></root>'));
      `], { timeout: 5000, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects compressed worksheet and shared-string element bombs before heap exhaustion", () => {
    const inventoryUrl = new URL("./inventory.ts", import.meta.url).href;
    const fixtureUrl = new URL("./workbook.fixture.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, [
      "--max-old-space-size=488", "--max-semi-space-size=8", "--import", "tsx", "--input-type=module", "-e", `
        import { strict as assert } from "node:assert";
        import { getHeapStatistics } from "node:v8";
        import { captureWorkbookInventory } from ${JSON.stringify(inventoryUrl)};
        import { buildSyntheticWorkbook } from ${JSON.stringify(fixtureUrl)};
        assert.ok(getHeapStatistics().heap_size_limit <= 512 * 1024 * 1024);
        for (const part of ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']) {
          const bytes = buildSyntheticWorkbook({ [part]: '<root>' + '<a/>'.repeat(3000000) + '</root>' });
          assert.ok(bytes.length < 20000);
          assert.throws(() => captureWorkbookInventory(bytes),
            { name: 'SteveCaptureError', message: 'XML capture exceeds the 500000-element limit' });
        }
      `], { timeout: 5000, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
